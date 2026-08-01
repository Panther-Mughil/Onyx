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
use tokio::process::Command;
use command_group::AsyncCommandGroup;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tower_http::cors::CorsLayer;
use sysinfo::System;
use std::collections::HashMap;
use rust_embed::RustEmbed;
use axum::http::{header, StatusCode, Uri};
use mime_guess::from_path;

fn base_dir() -> String {
    let current_dir = std::env::current_dir().unwrap_or_default();
    if current_dir.ends_with("backend") {
        "..".to_string()
    } else {
        ".".to_string()
    }
}

#[derive(RustEmbed)]
#[folder = "../frontend/dist"]
struct Asset;

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() {
        path = "index.html".to_string();
    }

    match Asset::get(path.as_str()) {
        Some(content) => {
            let mime = from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if let Some(index) = Asset::get("index.html") {
                ([(header::CONTENT_TYPE, "text/html")], index.data).into_response()
            } else {
                (StatusCode::NOT_FOUND, "404 Not Found").into_response()
            }
        }
    }
}


#[derive(Serialize)]
struct HealthResponse {
    status: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct CachedModelMetadata {
    context_length: u32,
    block_count: u32,
    architecture: String,
    quantization: String,
}

#[derive(Serialize)]
struct Model {
    id: String,
    name: String,
    quantization: String,
    size_gb: f32,
    context_length: u32,
    block_count: u32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RpcServer {
    address: String,
    active: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct LocalGpu {
    index: usize,
    active: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ServerConfig {
    model_id: String,
    ctx_size: u32,
    gpu_layers: u32,
    layer_allocations: Option<std::collections::HashMap<String, u32>>,
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
    local_gpus: Option<Vec<LocalGpu>>,
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
    physical_cores: Option<usize>,
    ram_used_gb: f32,
    ram_total_gb: f32,
    gpus: Vec<GpuTelemetry>,
}

struct ActiveServer {
    process: Option<command_group::AsyncGroupChild>,
    model_id: String,
    port: u16,
    is_ready: bool,
    logs: Vec<String>,
    progress: f32,
}

struct AppState {
    active_servers: Mutex<HashMap<String, ActiveServer>>,
    telemetry_cache: Arc<Mutex<TelemetryResponse>>,
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
    let settings_path = format!("{}/data/settings.json", base_dir());
    if let Ok(data) = fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str(&data) {
            return Json(json);
        }
    }
    Json(serde_json::json!({}))
}

async fn save_settings(Json(payload): Json<serde_json::Value>) -> Json<StartResponse> {
    let data_dir = format!("{}/data", base_dir());
    let _ = fs::create_dir_all(&data_dir);
    if let Ok(json_str) = serde_json::to_string_pretty(&payload) {
        let settings_path = format!("{}/data/settings.json", base_dir());
        let _ = fs::write(&settings_path, json_str);
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
    let models_dir_str = format!("{}/models", base_dir());
    let models_dir = Path::new(&models_dir_str);

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

                // Try to load from cache first
                let cache_path_str = format!("{}/models/metadata_cache.json", base_dir());
                let cache_path = std::path::Path::new(&cache_path_str);
                let mut cache: std::collections::HashMap<String, CachedModelMetadata> = if cache_path.exists() {
                    if let Ok(cache_str) = fs::read_to_string(cache_path) {
                        serde_json::from_str(&cache_str).unwrap_or_default()
                    } else {
                        std::collections::HashMap::new()
                    }
                } else {
                    std::collections::HashMap::new()
                };

                let mut context_length = 0;
                let mut block_count = 0;
                let mut architecture = String::new();
                let mut quantization;

                if let Some(cached_data) = cache.get(&filename) {
                    context_length = cached_data.context_length;
                    block_count = cached_data.block_count;
                    architecture = cached_data.architecture.clone();
                    quantization = cached_data.quantization.clone();
                } else {
                    // Extract quantization from filename
                    let filename_lower = filename.to_lowercase();
                    quantization = "Unknown".to_string();
                    let q_patterns = ["q2_", "q3_", "q4_", "q5_", "q6_", "q8_", "iq1_", "iq2_", "iq3_", "iq4_", "f16", "f32"];
                    for p in q_patterns.iter() {
                        if let Some(idx) = filename_lower.find(p) {
                            let sub = &filename[idx..];
                            let end_idx = sub.find('.').unwrap_or(sub.len());
                            quantization = sub[..end_idx].to_uppercase();
                            break;
                        }
                    }

                    // Full reliable parser using gguf crate
                    if let Ok(mut file) = fs::File::open(&path) {
                        use std::io::Read;
                        let mut buffer = vec![0u8; 1024 * 1024 * 5]; // Read first 5MB to ensure full header
                        if let Ok(bytes_read) = file.read(&mut buffer) {
                            buffer.truncate(bytes_read);
                            if let Ok(Some(gguf_file)) = gguf::GGUFFile::read(&buffer) {
                                for md in gguf_file.header.metadata {
                                    if md.key.ends_with(".context_length") || md.key.ends_with(".n_ctx_train") {
                                        if let gguf::GGUFMetadataValue::Uint32(v) = md.value {
                                            if context_length == 0 { context_length = v; }
                                        }
                                    }
                                    if md.key.ends_with(".block_count") {
                                        if let gguf::GGUFMetadataValue::Uint32(v) = md.value {
                                            block_count = v;
                                        }
                                    }
                                    if md.key == "general.architecture" {
                                        if let gguf::GGUFMetadataValue::String(v) = &md.value {
                                            architecture = v.clone();
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Fallback to substring binary search if full parser fails (e.g. header > 5MB)
                    if context_length == 0 || block_count == 0 {
                        if let Ok(mut file) = fs::File::open(&path) {
                            use std::io::Read;
                            let mut buffer = vec![0u8; 1024 * 1024]; 
                            if let Ok(bytes_read) = file.read(&mut buffer) {
                                buffer.truncate(bytes_read);
                                let ctx_needle = b".context_length";
                                if let Some(pos) = buffer.windows(ctx_needle.len()).position(|w| w == ctx_needle) {
                                    let type_pos = pos + ctx_needle.len();
                                    if type_pos + 8 <= buffer.len() {
                                        let val_type = u32::from_le_bytes(buffer[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            context_length = u32::from_le_bytes(buffer[type_pos+4..type_pos+8].try_into().unwrap());
                                        }
                                    }
                                }
                                let ctx_train_needle = b".n_ctx_train";
                                if context_length == 0 {
                                    if let Some(pos) = buffer.windows(ctx_train_needle.len()).position(|w| w == ctx_train_needle) {
                                        let type_pos = pos + ctx_train_needle.len();
                                        if type_pos + 8 <= buffer.len() {
                                            let val_type = u32::from_le_bytes(buffer[type_pos..type_pos+4].try_into().unwrap());
                                            if val_type == 4 {
                                                context_length = u32::from_le_bytes(buffer[type_pos+4..type_pos+8].try_into().unwrap());
                                            }
                                        }
                                    }
                                }
                                let blk_needle = b".block_count";
                                if let Some(pos) = buffer.windows(blk_needle.len()).position(|w| w == blk_needle) {
                                    let type_pos = pos + blk_needle.len();
                                    if type_pos + 8 <= buffer.len() {
                                        let val_type = u32::from_le_bytes(buffer[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            block_count = u32::from_le_bytes(buffer[type_pos+4..type_pos+8].try_into().unwrap());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Update cache with the new CachedModelMetadata
                    let new_metadata = CachedModelMetadata {
                        context_length,
                        block_count,
                        architecture: architecture.clone(),
                        quantization: quantization.clone(),
                    };
                    cache.insert(filename.clone(), new_metadata);
                    if let Ok(cache_str) = serde_json::to_string_pretty(&cache) {
                        let _ = fs::write(cache_path, cache_str);
                    }
                }

                let name = if filename.ends_with(".gguf") {
                    filename[..filename.len() - 5].to_string()
                } else {
                    filename.clone()
                };

                models.push(Model {
                    id: filename,
                    name,
                    quantization,
                    size_gb,
                    context_length,
                    block_count,
                });
            }
        }
    }

    models.sort_by(|a, b| a.name.cmp(&b.name));
    Json(models)
}

async fn proxy_models_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let servers = state.active_servers.lock().await;
    let mut data = Vec::new();
    
    for (model_id, _) in servers.iter() {
        data.push(serde_json::json!({
            "id": model_id,
            "object": "model",
            "created": chrono::Utc::now().timestamp(),
            "owned_by": "onyx"
        }));
    }
    
    Json(serde_json::json!({
        "object": "list",
        "data": data
    }))
}

async fn proxy_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    req: Request,
) -> Response {
    let (parts, body) = req.into_parts();
    
    const MAX_BODY_SIZE: usize = 100 * 1024 * 1024; // 100 MB
    let body_bytes = match axum::body::to_bytes(body, MAX_BODY_SIZE).await {
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
    
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    state.system_logs.lock().await.push(format!("[{}] Network gateway configured: {} (Port: {}, Network Host: {})", timestamp, bind_addr, payload.port, payload.network_host));
    
    if let Some(task) = proxy_lock.take() {
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    
    let app = Router::new()
        .route("/v1/models", axum::routing::get(proxy_models_handler))
        .route("/models", axum::routing::get(proxy_models_handler))
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
    
    let mut to_remove = Vec::new();
    for (model_id, server) in servers_map.iter_mut() {
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

fn spawn_log_reader<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    reader: R,
    state: Arc<AppState>,
    model_id: String,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut servers = state.active_servers.lock().await;
            if let Some(server) = servers.get_mut(&model_id) {
                server.logs.push(line.clone());
                if server.logs.len() > 1000 { server.logs.remove(0); }

                if line.contains("model loaded") || line.contains("listening on") || line.contains("HTTP server listening") {
                    server.is_ready = true;
                }

                if line.contains("llm_load_tensors:") {
                    if let Some(idx) = line.find('%') {
                        if let Some(start) = line[..idx].rfind(' ') {
                            if let Ok(pct) = line[start+1..idx].trim().parse::<f32>() {
                                server.progress = pct;
                            }
                        }
                    }
                }

                if line.to_lowercase().contains("error") {
                    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                    state.system_logs.lock().await.push(format!("[{}] {} Error: {}", timestamp, model_id, line));
                }
            } else {
                break;
            }
        }
    });
}

fn compute_gpu_offloads(payload: &ServerConfig, delimiter: &str) -> (u32, Option<String>) {
    let mut actual_gpu_layers = payload.gpu_layers;
    let mut ts_arg = None;

    if let Some(allocs) = &payload.layer_allocations {
        let mut total_offloaded = 0;
        let mut splits = Vec::new();
        
        if let Some(gpus) = &payload.local_gpus {
            if !gpus.is_empty() {
                let max_gpu_index = gpus.iter().map(|g| g.index).max().unwrap_or(0);
                for i in 0..=max_gpu_index {
                    let key = format!("gpu_{}", i);
                    let layers = allocs.get(&key).copied().unwrap_or(0);
                    splits.push(layers.to_string());
                    total_offloaded += layers;
                }
            }
        }
        
        if let Some(rpcs) = &payload.rpc_servers {
            for (idx, rpc) in rpcs.iter().enumerate() {
                if rpc.active {
                    let key = format!("rpc_{}", idx);
                    let layers = allocs.get(&key).copied().unwrap_or(0);
                    splits.push(layers.to_string());
                    total_offloaded += layers;
                }
            }
        }
        
        actual_gpu_layers = total_offloaded;
        if splits.len() > 1 {
            ts_arg = Some(splits.join(delimiter));
        }
    } else {
        if let Some(gpus) = &payload.local_gpus {
            if !gpus.is_empty() {
                let max_index = gpus.iter().map(|g| g.index).max().unwrap_or(0);
                let mut splits = vec!["0"; max_index + 1];
                let mut any_active = false;
                let mut all_active = true;
                for g in gpus.iter() {
                    if g.active {
                        splits[g.index] = "1";
                        any_active = true;
                    } else {
                        all_active = false;
                    }
                }
                if !any_active {
                    actual_gpu_layers = 0;
                } else if !all_active {
                    ts_arg = Some(splits.join(delimiter));
                }
            }
        }
    }
    
    (actual_gpu_layers, ts_arg)
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
    
    let port = {
        let mut p = 8080;
        while servers_map.values().any(|s| s.port == p) {
            p += 1;
        }
        p
    };
    
    let model_path = format!("{}/models/{}", base_dir(), payload.model_id);
    let binary_path = if cfg!(windows) {
        format!("{}/bin/llama-server.exe", base_dir())
    } else {
        format!("{}/bin/llama-server", base_dir())
    };

    if !Path::new(&binary_path).exists() {
        return Json(StartResponse {
            success: false,
            message: format!("Binary not found at {}", binary_path),
        });
    }

    let (actual_gpu_layers, ts_arg) = compute_gpu_offloads(&payload, ",");

    let mut args = vec![
        "-m".to_string(), model_path.clone(),
        "-c".to_string(), payload.ctx_size.to_string(),
        "-ngl".to_string(), actual_gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-np".to_string(), payload.concurrency.to_string(),
        "--cache-type-k".to_string(), payload.k_cache_quant.clone(),
        "--cache-type-v".to_string(), payload.v_cache_quant.clone(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--port".to_string(), port.to_string(),
    ];

    if let Some(ts) = ts_arg {
        args.push("-ts".to_string());
        args.push(ts);
    }

    if let Some(servers) = &payload.rpc_servers {
        let active_servers: Vec<String> = servers.iter()
            .filter(|s| s.active)
            .map(|s| {
                if s.address.contains(':') {
                    s.address.clone()
                } else {
                    format!("{}:50052", s.address)
                }
            })
            .collect();
            
        if !active_servers.is_empty() {
            args.push("--rpc".to_string());
            args.push(active_servers.join(","));
        }
    }

    if !payload.offload_kv { args.push("--no-kv-offload".to_string()); }
    if !payload.unified_kv { args.push("--no-kv-unified".to_string()); }
    if payload.cpu_moe { args.push("--cpu-moe".to_string()); }
    
    if payload.keep_in_memory { 
        args.push("--load-mode".to_string()); 
        args.push("mlock".to_string()); 
    } else if !payload.mmap { 
        args.push("--load-mode".to_string()); 
        args.push("none".to_string()); 
    }
    
    args.push("--flash-attn".to_string());
    args.push(if payload.flash_attention { "on".to_string() } else { "off".to_string() });

    let full_command = format!("{} {}", binary_path, args.join(" "));
    state.system_logs.lock().await.push(format!("I [SYSTEM] Booting llama-server with parameters:"));
    state.system_logs.lock().await.push(format!("I [SYSTEM] {}", full_command));

    let mut child = match Command::new(binary_path.clone())
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .group_spawn()
    {
        Ok(child) => child,
        Err(e) => {
            return Json(StartResponse {
                success: false,
                message: format!("Failed to start llama-server: {}", e),
            });
        }
    };
    
    let stdout = child.inner().stdout.take().unwrap();
    let stderr = child.inner().stderr.take().unwrap();
    
    let mut initial_logs = Vec::new();
    initial_logs.push(format!("I [SYSTEM] Booting llama-server with exact parameters:"));
    initial_logs.push(format!("I [SYSTEM] {}", full_command));

    let server_state = ActiveServer {
        process: Some(child),
        model_id: payload.model_id.clone(),
        port,
        is_ready: false,
        logs: initial_logs,
        progress: 0.0,
    };
    
    servers_map.insert(payload.model_id.clone(), server_state);
    drop(servers_map); 

    spawn_log_reader(stdout, state.clone(), payload.model_id.clone());
    spawn_log_reader(stderr, state.clone(), payload.model_id.clone());

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

    let model_path = format!("{}/models/{}", base_dir(), payload.model_id);
    let binary_path = if cfg!(windows) {
        format!("{}/bin/llama-bench.exe", base_dir())
    } else {
        format!("{}/bin/llama-bench", base_dir())
    };
    
    let (actual_gpu_layers, ts_arg) = compute_gpu_offloads(&payload, "/");

    let mut args = vec![
        "-m".to_string(), model_path,
        "-ngl".to_string(), actual_gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-ctk".to_string(), payload.k_cache_quant.clone(),
        "-ctv".to_string(), payload.v_cache_quant.clone(),
        "-p".to_string(), "512".to_string(),
        "-n".to_string(), "128".to_string(),
        "--progress".to_string(),
    ];

    if let Some(ts) = ts_arg {
        args.push("-ts".to_string());
        args.push(ts);
    }

    if let Some(servers) = &payload.rpc_servers {
        let active_servers: Vec<String> = servers.iter()
            .filter(|s| s.active)
            .map(|s| {
                if s.address.contains(':') {
                    s.address.clone()
                } else {
                    format!("{}:50052", s.address)
                }
            })
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
    
    let full_command = format!("{} {}", binary_path, args.join(" "));
    state.benchmark_logs.lock().await.push(format!("I [SYSTEM] Booting llama-bench with exact parameters:"));
    state.benchmark_logs.lock().await.push(format!("I [SYSTEM] {}", full_command));
    
    tokio::spawn(async move {
        let mut child = match Command::new(binary_path.clone())
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .group_spawn()
        {
            Ok(child) => child,
            Err(e) => {
                eprintln!("Failed to start llama-bench: {}", e);
                *shared_state.benchmark_running.lock().await = false;
                return;
            }
        };

        let stdout = child.inner().stdout.take().expect("Failed to open stdout");
        let stderr = child.inner().stderr.take().expect("Failed to open stderr");

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
    let data = state.telemetry_cache.lock().await.clone();
    Json(data)
}

async fn clear_system_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StartResponse> {
    state.system_logs.lock().await.clear();
    Json(StartResponse {
        success: true,
        message: "System logs cleared".to_string(),
    })
}

#[tokio::main]
async fn main() {
    let models_dir = format!("{}/models", base_dir());
    let _ = fs::create_dir_all(&models_dir);

    let telemetry_cache = Arc::new(Mutex::new(TelemetryResponse {
        cpu_name: "Loading...".to_string(),
        cpu_usage_pct: 0.0,
        cpu_temp_c: 0.0,
        physical_cores: None,
        ram_used_gb: 0.0,
        ram_total_gb: 0.0,
        gpus: vec![],
    }));

    let cache_clone = telemetry_cache.clone();
    tokio::spawn(async move {
        let mut sys = System::new_all();
        let mut components = sysinfo::Components::new();
        let mut nvml_opt = nvml_wrapper::Nvml::init().ok();
        
        loop {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            components.refresh_list();
            
            let cpu_name = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_else(|| "Unknown CPU".to_string());
            let cpu_usage_pct = sys.global_cpu_info().cpu_usage();
            let physical_cores = sys.physical_core_count();
            
            let mut cpu_temp_c = 0.0; 
            for component in &components {
                let label = component.label().to_lowercase();
                if label.contains("cpu") || label.contains("core") || label.contains("tctl") {
                    let temp = component.temperature();
                    if temp > cpu_temp_c {
                        cpu_temp_c = temp;
                    }
                }
            }

            let ram_used_gb = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
            let ram_total_gb = sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0);

            let mut gpus = Vec::new();
            
            if let Some(nvml) = &mut nvml_opt {
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

            {
                let mut cache = cache_clone.lock().await;
                cache.cpu_name = cpu_name;
                cache.cpu_usage_pct = cpu_usage_pct;
                cache.cpu_temp_c = cpu_temp_c;
                cache.physical_cores = physical_cores;
                cache.ram_used_gb = ram_used_gb;
                cache.ram_total_gb = ram_total_gb;
                cache.gpus = gpus;
            }
            
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
    });

    let shared_state = Arc::new(AppState {
        active_servers: Mutex::new(HashMap::new()),
        telemetry_cache,
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
        .route("/api/system/logs/clear", post(clear_system_logs))
        .fallback(static_handler)
        .with_state(shared_state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    println!("Backend middleware starting on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
