use axum::{
    routing::{get, post},
    Router,
    Json,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::Path;
use std::fs;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::{Child, Command};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tower_http::cors::CorsLayer;
use sysinfo::System;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    message: String,
}

#[derive(Serialize)]
struct Model {
    id: String,
    name: String,
    quantization: String,
    size_gb: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RpcServer {
    address: String,
    active: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ServerConfig {
    model_id: String,
    ctx_size: u32,
    gpu_layers: u32,
    threads: u32,
    eval_batch_size: u32,
    physical_batch_size: u32,
    concurrency: u32,
    unified_kv: bool,
    offload_kv: bool,
    keep_in_memory: bool,
    mmap: bool,
    flash_attention: bool,
    k_cache_quant: String,
    v_cache_quant: String,
    cpu_moe: bool,
    rpc_servers: Option<Vec<RpcServer>>,
}

#[derive(Serialize)]
struct StartResponse {
    success: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkConfig {
    port: u16,
    network_host: bool,
}

#[derive(Serialize)]
struct StatusResponse {
    is_running: bool,
    model_id: Option<String>,
    is_ready: bool,
}

#[derive(Serialize, Clone)]
struct GpuTelemetry {
    name: String,
    gpu_usage_pct: u32,
    temp_c: u32,
    vram_used_mb: u64,
    vram_total_mb: u64,
}

#[derive(Serialize, Clone)]
struct TelemetryResponse {
    cpu_name: String,
    cpu_usage_pct: f32,
    cpu_temp_c: f32,
    ram_used_gb: f32,
    ram_total_gb: f32,
    gpus: Vec<GpuTelemetry>,
}

struct AppState {
    server_process: Mutex<Option<Child>>,
    active_model_id: Mutex<Option<String>>,
    server_logs: Mutex<Vec<String>>,
    is_model_ready: Mutex<bool>,
    sys: Mutex<System>,
    proxy_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    proxy_addr: Mutex<Option<String>>,
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        message: "LocalLLM Rust Backend is running natively!".to_string(),
    })
}

async fn get_local_models() -> Json<Vec<Model>> {
    let mut models = Vec::new();
    let models_dir = Path::new("../models");

    if let Ok(entries) = fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "gguf") {
                let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                
                let size_gb = if let Ok(metadata) = entry.metadata() {
                    (metadata.len() as f32) / (1024.0 * 1024.0 * 1024.0)
                } else {
                    0.0
                };

                let parts: Vec<&str> = filename.split('.').collect();
                let quantization = if parts.len() >= 3 {
                    parts[parts.len() - 2].to_string() 
                } else {
                    "Unknown".to_string()
                };
                
                let name = parts[0].to_string();

                models.push(Model {
                    id: filename,
                    name,
                    quantization,
                    size_gb,
                });
            }
        }
    }

    models.sort_by(|a, b| a.name.cmp(&b.name));
    Json(models)
}

async fn update_network_config(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<NetworkConfig>,
) -> Json<StartResponse> {
    let bind_ip = if payload.network_host { "0.0.0.0" } else { "127.0.0.1" };
    let bind_addr = format!("{}:{}", bind_ip, payload.port);
    
    let mut proxy_addr_lock = state.proxy_addr.lock().await;
    
    // Check if already bound to the requested address
    if let Some(current_addr) = proxy_addr_lock.as_ref() {
        if current_addr == &bind_addr {
            return Json(StartResponse {
                success: true,
                message: format!("Proxy already running on {}", bind_addr),
            });
        }
    }
    
    let mut proxy_lock = state.proxy_task.lock().await;
    
    // Abort existing proxy if it exists and allow OS to reclaim socket
    if let Some(task) = proxy_lock.take() {
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    
    let target_addr = "127.0.0.1:8080".to_string();
    
    let listener_result = tokio::net::TcpListener::bind(&bind_addr).await;
    
    match listener_result {
        Ok(listener) => {
            let task = tokio::spawn(async move {
                while let Ok((mut inbound, _)) = listener.accept().await {
                    let target = target_addr.clone();
                    tokio::spawn(async move {
                        if let Ok(mut outbound) = tokio::net::TcpStream::connect(target).await {
                            let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await;
                        }
                    });
                }
            });
            *proxy_lock = Some(task);
            *proxy_addr_lock = Some(bind_addr.clone());
            
            {
                let mut logs = state.server_logs.lock().await;
                logs.push(format!(" I  TCP Reverse Proxy dynamically re-routed: now serving on {}", bind_addr));
            }
            
            Json(StartResponse {
                success: true,
                message: format!("Proxy running on {}", bind_addr),
            })
        },
        Err(e) => {
            {
                let mut logs = state.server_logs.lock().await;
                logs.push(format!(" E  Failed to bind TCP proxy to {}: {}", bind_addr, e));
            }
            Json(StartResponse {
                success: false,
                message: format!("Failed to bind {}: {}", bind_addr, e),
            })
        }
    }
}

async fn get_server_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StatusResponse> {
    let mut process_lock = state.server_process.lock().await;
    let mut model_lock = state.active_model_id.lock().await;
    let mut ready_lock = state.is_model_ready.lock().await;
    
    let mut is_running = false;
    
    if let Some(child) = process_lock.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            // Process crashed or exited (e.g. Out of Memory error)
            // Auto-eject and clean up the state
            *process_lock = None;
            *model_lock = None;
            *ready_lock = false;
        } else {
            is_running = true;
        }
    }
    
    Json(StatusResponse {
        is_running,
        model_id: model_lock.clone(),
        is_ready: *ready_lock,
    })
}

async fn get_server_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<Vec<String>> {
    let logs = state.server_logs.lock().await;
    Json(logs.clone())
}

async fn clear_server_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StartResponse> {
    let mut logs = state.server_logs.lock().await;
    logs.clear();
    Json(StartResponse {
        success: true,
        message: "Logs cleared".to_string(),
    })
}

async fn start_server(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<ServerConfig>,
) -> Json<StartResponse> {
    
    let mut process_lock = state.server_process.lock().await;
    *state.is_model_ready.lock().await = false;
    
    // Aggressive Windows cleanup for zombie processes
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "llama-server.exe", "/T"])
        .output();

    if let Some(mut child) = process_lock.take() {
        let _ = child.kill().await;
    }

    let model_path = format!("../models/{}", payload.model_id);
    let binary_path = "../bin/llama-server.exe";

    if !Path::new(binary_path).exists() {
        return Json(StartResponse {
            success: false,
            message: format!("Binary not found at {}", binary_path),
        });
    }

    let mut args = vec![
        "-m".to_string(), model_path,
        "-c".to_string(), payload.ctx_size.to_string(),
        "-ngl".to_string(), payload.gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-np".to_string(), payload.concurrency.to_string(),
        "--cache-type-k".to_string(), payload.k_cache_quant.clone(),
        "--cache-type-v".to_string(), payload.v_cache_quant.clone(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--port".to_string(), "8080".to_string(),
    ];

    if let Some(servers) = &payload.rpc_servers {
        let active_servers: Vec<String> = servers.iter()
            .filter(|s| s.active)
            .map(|s| s.address.clone())
            .collect();
            
        if !active_servers.is_empty() {
            args.push("--rpc".to_string());
            args.push(active_servers.join(","));
        }
    }

    if !payload.offload_kv { args.push("--no-kv-offload".to_string()); }
    if payload.keep_in_memory { args.push("--mlock".to_string()); }
    if !payload.mmap { args.push("--no-mmap".to_string()); }
    
    args.push("--flash-attn".to_string());
    args.push(if payload.flash_attention { "on".to_string() } else { "off".to_string() });

    // Spawn natively and pipe outputs
    let mut cmd = Command::new(binary_path);
    cmd.args(&args)
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());

    match cmd.spawn() {
        Ok(mut child) => {
            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap();
            
            // Clear old logs
            {
                let mut logs = state.server_logs.lock().await;
                logs.clear();
            }

            // Spawn tasks to capture logs
            let state1 = state.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut logs = state1.server_logs.lock().await;
                    logs.push(line.clone());
                    if logs.len() > 1000 { logs.remove(0); }
                    
                    if line.contains("model loaded") || line.contains("listening on") || line.contains("HTTP server listening") {
                        let mut ready = state1.is_model_ready.lock().await;
                        *ready = true;
                    }
                }
            });

            let state2 = state.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut logs = state2.server_logs.lock().await;
                    logs.push(line.clone());
                    if logs.len() > 1000 { logs.remove(0); }
                    
                    if line.contains("model loaded") || line.contains("listening on") || line.contains("HTTP server listening") {
                        let mut ready = state2.is_model_ready.lock().await;
                        *ready = true;
                    }
                }
            });

            *process_lock = Some(child);
            let mut active_model = state.active_model_id.lock().await;
            *active_model = Some(payload.model_id);
            
            Json(StartResponse {
                success: true,
                message: "llama-server started".to_string(),
            })
        }
        Err(e) => {
            Json(StartResponse {
                success: false,
                message: format!("Failed to spawn llama-server: {}", e),
            })
        }
    }
}

async fn stop_server(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StartResponse> {
    let mut process_lock = state.server_process.lock().await;
    let mut active_model = state.active_model_id.lock().await;
    *state.is_model_ready.lock().await = false;
    
    // Aggressive Windows cleanup
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "llama-server.exe", "/T"])
        .output();

    if let Some(mut child) = process_lock.take() {
        let _ = child.kill().await;
    }
    
    *active_model = None;
    
    Json(StartResponse {
        success: true,
        message: "llama-server forcefully stopped.".to_string(),
    })
}

async fn get_telemetry(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<TelemetryResponse> {
    let mut sys = state.sys.lock().await;
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    
    let cpu_name = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_else(|| "Unknown CPU".to_string());
    let cpu_usage_pct = sys.global_cpu_info().cpu_usage();
    
    let cpu_temp_c = 0.0; 

    let ram_used_gb = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    let ram_total_gb = sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0);

    let mut gpus = Vec::new();
    
    if let Ok(nvml) = nvml_wrapper::Nvml::init() {
        if let Ok(device_count) = nvml.device_count() {
            for i in 0..device_count {
                if let Ok(device) = nvml.device_by_index(i) {
                    let name = device.name().unwrap_or_else(|_| "Unknown GPU".to_string());
                    let util = device.utilization_rates().unwrap_or(nvml_wrapper::struct_wrappers::device::Utilization { gpu: 0, memory: 0 });
                    let temp = device.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu).unwrap_or(0);
                    let memory = device.memory_info().unwrap_or(nvml_wrapper::struct_wrappers::device::MemoryInfo { free: 0, total: 0, used: 0 });
                    
                    gpus.push(GpuTelemetry {
                        name,
                        gpu_usage_pct: util.gpu,
                        temp_c: temp,
                        vram_used_mb: memory.used / (1024 * 1024),
                        vram_total_mb: memory.total / (1024 * 1024),
                    });
                }
            }
        }
    }

    Json(TelemetryResponse {
        cpu_name,
        cpu_usage_pct,
        cpu_temp_c,
        ram_used_gb,
        ram_total_gb,
        gpus,
    })
}

#[tokio::main]
async fn main() {
    let _ = fs::create_dir_all("../models");

    let mut sys = System::new_all();
    sys.refresh_all(); // Initial warm-up for accurate usage

    let shared_state = Arc::new(AppState {
        server_process: Mutex::new(None),
        active_model_id: Mutex::new(None),
        server_logs: Mutex::new(Vec::new()),
        is_model_ready: Mutex::new(false),
        sys: Mutex::new(sys),
        proxy_task: Mutex::new(None),
        proxy_addr: Mutex::new(None),
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/models", get(get_local_models))
        .route("/api/server/status", get(get_server_status))
        .route("/api/server/logs", get(get_server_logs))
        .route("/api/server/logs/clear", post(clear_server_logs))
        .route("/api/server/telemetry", get(get_telemetry))
        .route("/api/server/network", post(update_network_config))
        .route("/api/server/start", post(start_server))
        .route("/api/server/stop", post(stop_server))
        .with_state(shared_state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    println!("Backend middleware starting on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
