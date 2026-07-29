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
}

#[derive(Serialize)]
struct StartResponse {
    success: bool,
    message: String,
}

#[derive(Serialize)]
struct StatusResponse {
    is_running: bool,
    model_id: Option<String>,
}

struct AppState {
    server_process: Mutex<Option<Child>>,
    active_model_id: Mutex<Option<String>>,
    server_logs: Mutex<Vec<String>>,
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

async fn get_server_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StatusResponse> {
    let process_lock = state.server_process.lock().await;
    let model_lock = state.active_model_id.lock().await;
    
    let is_running = process_lock.is_some();
    
    Json(StatusResponse {
        is_running,
        model_id: model_lock.clone(),
    })
}

async fn get_server_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<Vec<String>> {
    let logs = state.server_logs.lock().await;
    Json(logs.clone())
}

async fn start_server(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<ServerConfig>,
) -> Json<StartResponse> {
    
    let mut process_lock = state.server_process.lock().await;
    
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
            
            let logs_clone = state.server_logs.clone();
            
            // Clear old logs
            {
                let mut logs = logs_clone.lock().await;
                logs.clear();
            }

            // Spawn tasks to capture logs
            let logs_clone1 = logs_clone.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut logs = logs_clone1.lock().await;
                    logs.push(line);
                    if logs.len() > 1000 { logs.remove(0); } // Retain last 1000 lines
                }
            });

            let logs_clone2 = logs_clone.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut logs = logs_clone2.lock().await;
                    logs.push(line);
                    if logs.len() > 1000 { logs.remove(0); }
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

#[tokio::main]
async fn main() {
    let _ = fs::create_dir_all("../models");

    let shared_state = Arc::new(AppState {
        server_process: Mutex::new(None),
        active_model_id: Mutex::new(None),
        server_logs: Mutex::new(Vec::new()),
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/models", get(get_local_models))
        .route("/api/server/status", get(get_server_status))
        .route("/api/server/logs", get(get_server_logs))
        .route("/api/server/start", post(start_server))
        .route("/api/server/stop", post(stop_server))
        .with_state(shared_state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    println!("Backend middleware starting on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
