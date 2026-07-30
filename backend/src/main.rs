use axum::{
    routing::{get, post},
    Router,
    Json,
    extract::Request,
    response::{Response, IntoResponse},
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
use std::collections::HashMap;

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

#[derive(Serialize)]
struct BenchmarkStatus {
    is_running: bool,
    logs: Vec<String>,
    pp: Option<f32>,
    tg: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkConfig {
    port: u16,
    network_host: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    model_id: String,
    port: u16,
    is_ready: bool,
    progress: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    servers: Vec<ServerInfo>,
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

struct ActiveServer {
    process: Option<Child>,
    model_id: String,
    port: u16,
    is_ready: bool,
    logs: Vec<String>,
    baseline_vram_mb: u64,
    size_gb: f32,
    progress: f32,
}

struct AppState {
    active_servers: Mutex<HashMap<String, ActiveServer>>,
    next_port: Mutex<u16>,
    sys: Mutex<System>,
    proxy_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    proxy_addr: Mutex<Option<String>>,
    benchmark_running: Mutex<bool>,
    benchmark_logs: Mutex<Vec<String>>,
    benchmark_pp: Mutex<Option<f32>>,
    benchmark_tg: Mutex<Option<f32>>,
    system_logs: Mutex<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogsQuery {
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopRequest {
    model_id: String,
}


async fn get_settings() -> Json<serde_json::Value> {
    if let Ok(data) = fs::read_to_string("../data/settings.json") {
        if let Ok(json) = serde_json::from_str(&data) {
            return Json(json);
        }
    }
    Json(serde_json::json!({}))
}

async fn save_settings(Json(payload): Json<serde_json::Value>) -> Json<StartResponse> {
    let _ = fs::create_dir_all("../data");
    if let Ok(json_str) = serde_json::to_string_pretty(&payload) {
        let _ = fs::write("../data/settings.json", json_str);
    }
    Json(StartResponse { success: true, message: "Settings saved".to_string() })
}

async fn stop_proxy(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StartResponse> {
    let mut proxy_lock = state.proxy_task.lock().await;
    let mut proxy_addr_lock = state.proxy_addr.lock().await;
    
    if let Some(task) = proxy_lock.take() {
        task.abort();
        *proxy_addr_lock = None;
        let mut logs = state.system_logs.lock().await;
        logs.push("[System] Gateway stopped.".to_string());
        return Json(StartResponse { success: true, message: "Gateway stopped".to_string() });
    }
    Json(StartResponse { success: false, message: "Gateway not running".to_string() })
}

async fn get_system_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<Vec<String>> {
    let logs = state.system_logs.lock().await;
    Json(logs.clone())
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

async fn proxy_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    req: Request,
) -> Response {
    let (parts, body) = req.into_parts();
    
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (axum::http::StatusCode::BAD_REQUEST, "Failed to read body").into_response(),
    };
    
    let mut target_port = 8080;
    let mut found_target = false;
    
    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body_bytes) {
        if let Some(model_str) = json.get("model").and_then(|m| m.as_str()) {
            let servers = state.active_servers.lock().await;
            if let Some(server) = servers.get(model_str) {
                target_port = server.port;
                found_target = true;
            }
            if !found_target {
                for (id, server) in servers.iter() {
                    if id.starts_with(model_str) {
                        target_port = server.port;
                        found_target = true;
                        break;
                    }
                }
            }
        }
    }
    
    if !found_target {
        let servers = state.active_servers.lock().await;
        if let Some(first) = servers.values().next() {
            target_port = first.port;
        } else {
            return (axum::http::StatusCode::SERVICE_UNAVAILABLE, "No active models").into_response();
        }
    }

    let client = reqwest::Client::new();
    let uri = format!("http://127.0.0.1:{}{}", target_port, parts.uri.path_and_query().map(|pq| pq.as_str()).unwrap_or(""));
    
    let mut req_builder = client.request(parts.method, uri);
    for (k, v) in parts.headers.iter() {
        if k != axum::http::header::HOST {
            req_builder = req_builder.header(k, v);
        }
    }
    req_builder = req_builder.body(reqwest::Body::from(body_bytes));

    match req_builder.send().await {
        Ok(response) => {
            let mut axum_res = Response::builder().status(response.status());
            if let Some(headers) = axum_res.headers_mut() {
                for (k, v) in response.headers().iter() {
                    headers.insert(k.clone(), v.clone());
                }
            }
            let stream = response.bytes_stream();
            let body = axum::body::Body::from_stream(stream);
            axum_res.body(body).unwrap_or_else(|_| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response())
        }
        Err(e) => {
            (axum::http::StatusCode::BAD_GATEWAY, format!("Bad Gateway: {}", e)).into_response()
        }
    }
}

async fn update_network_config(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<NetworkConfig>,
) -> Json<StartResponse> {
    let bind_ip = if payload.network_host { "0.0.0.0" } else { "127.0.0.1" };
    let bind_addr = format!("{}:{}", bind_ip, payload.port);
    
    let mut proxy_addr_lock = state.proxy_addr.lock().await;
    
    if let Some(current_addr) = proxy_addr_lock.as_ref() {
        if current_addr == &bind_addr {
            return Json(StartResponse {
                success: true,
                message: format!("Proxy already running on {}", bind_addr),
            });
        }
    }
    
    let mut proxy_lock = state.proxy_task.lock().await;
    
    if let Some(task) = proxy_lock.take() {
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    
    let app = Router::new()
        .fallback(proxy_handler)
        .with_state(state.clone());
    
    let listener_result = tokio::net::TcpListener::bind(&bind_addr).await;
    
    match listener_result {
        Ok(listener) => {
            let task = tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            *proxy_lock = Some(task);
            *proxy_addr_lock = Some(bind_addr.clone());
            state.system_logs.lock().await.push(format!("[System] Gateway started on {}", bind_addr));
            
            Json(StartResponse {
                success: true,
                message: format!("Proxy running on {}", bind_addr),
            })
        },
        Err(e) => {
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
    let mut servers_map = state.active_servers.lock().await;
    
    let mut current_vram = 0;
    if let Ok(nvml) = nvml_wrapper::Nvml::init() {
        if let Ok(device) = nvml.device_by_index(0) {
            if let Ok(mem) = device.memory_info() {
                current_vram = mem.used / (1024 * 1024);
            }
        }
    }

    let mut to_remove = Vec::new();
    for (model_id, server) in servers_map.iter_mut() {
        if !server.is_ready && server.size_gb > 0.0 && current_vram > server.baseline_vram_mb {
            let loaded_mb = current_vram - server.baseline_vram_mb;
            let loaded_gb = loaded_mb as f32 / 1024.0;
            let mut pct = (loaded_gb / server.size_gb) * 100.0;
            if pct > 99.0 { pct = 99.0; }
            if pct > server.progress {
                server.progress = pct;
            }
        }

        if let Some(child) = server.process.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                to_remove.push(model_id.clone());
            }
        }
    }
    
    for id in to_remove {
        servers_map.remove(&id);
    }
    
    let servers: Vec<ServerInfo> = servers_map.values().map(|s| {
        ServerInfo {
            model_id: s.model_id.clone(),
            port: s.port,
            is_ready: s.is_ready,
            progress: s.progress,
        }
    }).collect();
    
    Json(StatusResponse { servers })
}

async fn get_server_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Query(query): axum::extract::Query<LogsQuery>,
) -> Json<Vec<String>> {
    let servers = state.active_servers.lock().await;
    if let Some(server) = servers.get(&query.model_id) {
        Json(server.logs.clone())
    } else {
        Json(Vec::new())
    }
}

async fn clear_server_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<StopRequest>,
) -> Json<StartResponse> {
    let mut servers = state.active_servers.lock().await;
    if let Some(server) = servers.get_mut(&payload.model_id) {
        server.logs.clear();
    }
    Json(StartResponse {
        success: true,
        message: "Logs cleared".to_string(),
    })
}

async fn start_server(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<ServerConfig>,
) -> Json<StartResponse> {
    
    let mut servers_map = state.active_servers.lock().await;
    
    if servers_map.contains_key(&payload.model_id) {
        if let Some(mut existing) = servers_map.remove(&payload.model_id) {
            if let Some(mut child) = existing.process.take() {
                let _ = child.kill().await;
            }
        }
    }
    
    let mut next_port_lock = state.next_port.lock().await;
    let port = *next_port_lock;
    *next_port_lock += 1;
    
    let model_path = format!("../models/{}", payload.model_id);
    let binary_path = "../bin/llama-server.exe";

    if !Path::new(binary_path).exists() {
        return Json(StartResponse {
            success: false,
            message: format!("Binary not found at {}", binary_path),
        });
    }

    let mut args = vec![
        "-m".to_string(), model_path.clone(),
        "-c".to_string(), payload.ctx_size.to_string(),
        "-ngl".to_string(), payload.gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-np".to_string(), payload.concurrency.to_string(),
        "--cache-type-k".to_string(), payload.k_cache_quant.clone(),
        "--cache-type-v".to_string(), payload.v_cache_quant.clone(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--port".to_string(), port.to_string(),
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

    let mut child = Command::new(binary_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to start llama-server");
    
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    
    let mut baseline_vram = 0;
    if let Ok(nvml) = nvml_wrapper::Nvml::init() {
        if let Ok(device) = nvml.device_by_index(0) {
            if let Ok(mem) = device.memory_info() {
                baseline_vram = mem.used / (1024 * 1024);
            }
        }
    }

    let size_gb = if let Ok(metadata) = std::fs::metadata(&model_path) {
        (metadata.len() as f32) / (1024.0 * 1024.0 * 1024.0)
    } else {
        0.0
    };

    let server_state = ActiveServer {
        process: Some(child),
        model_id: payload.model_id.clone(),
        port,
        is_ready: false,
        logs: Vec::new(),
        baseline_vram_mb: baseline_vram,
        size_gb,
        progress: 0.0,
    };
    
    servers_map.insert(payload.model_id.clone(), server_state);
    drop(servers_map); 

    let model_id_clone = payload.model_id.clone();
    let state1 = state.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut servers = state1.active_servers.lock().await;
            if let Some(server) = servers.get_mut(&model_id_clone) {
                server.logs.push(line.clone());
                if server.logs.len() > 1000 { server.logs.remove(0); }
                
                if line.contains("model loaded") || line.contains("listening on") || line.contains("HTTP server listening") {
                    server.is_ready = true;
                }
            } else {
                break;
            }
        }
    });

    let model_id_clone2 = payload.model_id.clone();
    let state2 = state.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut servers = state2.active_servers.lock().await;
            if let Some(server) = servers.get_mut(&model_id_clone2) {
                server.logs.push(line.clone());
                if server.logs.len() > 1000 { server.logs.remove(0); }
                
                if line.contains("model loaded") || line.contains("listening on") || line.contains("HTTP server listening") {
                    server.is_ready = true;
                }
            } else {
                break;
            }
        }
    });

    Json(StartResponse {
        success: true,
        message: "llama-server started".to_string(),
    })
}

async fn stop_server(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<StopRequest>,
) -> Json<StartResponse> {
    let mut servers_map = state.active_servers.lock().await;
    
    if let Some(mut server) = servers_map.remove(&payload.model_id) {
        if let Some(mut child) = server.process.take() {
            let _ = child.kill().await;
        }
        Json(StartResponse {
            success: true,
            message: "Server stopped successfully".to_string(),
        })
    } else {
        Json(StartResponse {
            success: false,
            message: "Server not running".to_string(),
        })
    }
}

async fn get_benchmark_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<BenchmarkStatus> {
    Json(BenchmarkStatus {
        is_running: *state.benchmark_running.lock().await,
        logs: state.benchmark_logs.lock().await.clone(),
        pp: *state.benchmark_pp.lock().await,
        tg: *state.benchmark_tg.lock().await,
    })
}

async fn clear_benchmark_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StartResponse> {
    state.benchmark_logs.lock().await.clear();
    *state.benchmark_pp.lock().await = None;
    *state.benchmark_tg.lock().await = None;
    Json(StartResponse {
        success: true,
        message: "Benchmark logs and metrics cleared".to_string(),
    })
}

async fn run_benchmark(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<ServerConfig>,
) -> Json<StartResponse> {
    
    {
        let mut is_running = state.benchmark_running.lock().await;
        if *is_running {
            return Json(StartResponse {
                success: false,
                message: "Benchmark is already running".to_string(),
            });
        }
        *is_running = true;
    }
    
    state.benchmark_logs.lock().await.clear();
    *state.benchmark_pp.lock().await = None;
    *state.benchmark_tg.lock().await = None;

    {
        let mut servers_map = state.active_servers.lock().await;
        for (_, server) in servers_map.iter_mut() {
            if let Some(mut child) = server.process.take() {
                let _ = child.kill().await;
            }
        }
        servers_map.clear();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "llama-server.exe", "/T"])
            .output();
    }

    let model_path = format!("../models/{}", payload.model_id);
    let binary_path = "../bin/llama-bench.exe";
    
    let mut args = vec![
        "-m".to_string(), model_path,
        "-ngl".to_string(), payload.gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-ctk".to_string(), payload.k_cache_quant.clone(),
        "-ctv".to_string(), payload.v_cache_quant.clone(),
        "-p".to_string(), "512".to_string(),
        "-n".to_string(), "128".to_string(),
        "--progress".to_string(),
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

    if !payload.offload_kv { args.push("-nkvo".to_string()); args.push("1".to_string()); }
    if payload.keep_in_memory { args.push("-lm".to_string()); args.push("mlock".to_string()); }
    else if !payload.mmap { args.push("-lm".to_string()); args.push("none".to_string()); }
    if payload.flash_attention { args.push("-fa".to_string()); args.push("1".to_string()); }

    let shared_state = state.clone();
    
    tokio::spawn(async move {
        let mut child = Command::new(binary_path)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Failed to start llama-bench");

        let stdout = child.stdout.take().expect("Failed to open stdout");
        let stderr = child.stderr.take().expect("Failed to open stderr");

        let state_clone_out = shared_state.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let mut logs = state_clone_out.benchmark_logs.lock().await;
                logs.push(line.clone());
                
                if line.contains("|") && (line.contains("pp512") || line.contains("tg128")) {
                    let parts: Vec<&str> = line.split('|').collect();
                    if parts.len() > 6 {
                        let val_str = parts[parts.len()-2].trim();
                        let clean_val = val_str.split_whitespace().next().unwrap_or("");
                        if let Ok(val) = clean_val.parse::<f32>() {
                            if line.contains("pp512") {
                                *state_clone_out.benchmark_pp.lock().await = Some(val);
                            } else if line.contains("tg128") {
                                *state_clone_out.benchmark_tg.lock().await = Some(val);
                            }
                        }
                    }
                }
            }
        });

        let state_clone_err = shared_state.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let mut logs = state_clone_err.benchmark_logs.lock().await;
                logs.push(line);
            }
        });

        let _ = child.wait().await;
        *shared_state.benchmark_running.lock().await = false;
    });

    Json(StartResponse {
        success: true,
        message: "Benchmark started".to_string(),
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
    sys.refresh_all();

    let shared_state = Arc::new(AppState {
        active_servers: Mutex::new(HashMap::new()),
        next_port: Mutex::new(8080),
        sys: Mutex::new(sys),
        proxy_task: Mutex::new(None),
        proxy_addr: Mutex::new(None),
        benchmark_running: Mutex::new(false),
        benchmark_logs: Mutex::new(Vec::new()),
        benchmark_pp: Mutex::new(None),
        benchmark_tg: Mutex::new(None),
        system_logs: Mutex::new(Vec::new()),
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
        .route("/api/server/benchmark/start", post(run_benchmark))
        .route("/api/server/benchmark/status", get(get_benchmark_status))
        .route("/api/server/benchmark/clear", post(clear_benchmark_logs))
        .route("/api/settings", get(get_settings))
        .route("/api/settings/save", post(save_settings))
        .route("/api/server/proxy/stop", post(stop_proxy))
        .route("/api/system/logs", get(get_system_logs))
        .with_state(shared_state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    println!("Backend middleware starting on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
