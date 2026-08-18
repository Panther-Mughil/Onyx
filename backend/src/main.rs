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

#[cfg(target_os = "macos")]
fn get_macos_used_memory() -> Option<f32> {
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicUsize, Ordering};
    
    static PAGE_SIZE: AtomicUsize = AtomicUsize::new(0);
    
    let mut page_size = PAGE_SIZE.load(Ordering::SeqCst);
    if page_size == 0 {
        if let Ok(out) = StdCommand::new("pagesize").output() {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(size) = s.trim().parse::<usize>() {
                    page_size = size;
                    PAGE_SIZE.store(size, Ordering::SeqCst);
                }
            }
        }
        if page_size == 0 {
            page_size = 16384; // Default fallback for M1
        }
    }

    let output = StdCommand::new("vm_stat").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut active = 0.0;
    let mut wired = 0.0;
    let mut compressed = 0.0;
    
    for line in stdout.lines() {
        if line.starts_with("Pages active:") {
            if let Some(val) = line.split(':').nth(1) {
                active = val.trim().trim_end_matches('.').parse::<f32>().unwrap_or(0.0);
            }
        } else if line.starts_with("Pages wired down:") {
            if let Some(val) = line.split(':').nth(1) {
                wired = val.trim().trim_end_matches('.').parse::<f32>().unwrap_or(0.0);
            }
        } else if line.starts_with("Pages occupied by compressor:") {
            if let Some(val) = line.split(':').nth(1) {
                compressed = val.trim().trim_end_matches('.').parse::<f32>().unwrap_or(0.0);
            }
        }
    }
    
    let total_pages = active + wired + compressed;
    if total_pages > 0.0 {
        return Some((total_pages * page_size as f32) / (1024.0 * 1024.0 * 1024.0));
    }
    None
}

use rust_embed::RustEmbed;
use axum::http::{header, StatusCode, Uri};
use mime_guess::from_path;

pub fn app_dir() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            if parent.join("scripts").exists() {
                return parent.to_str().unwrap().to_string();
            }
        }
    }
    let cwd = std::env::current_dir().unwrap();
    let cwd_str = cwd.to_str().unwrap();
    if cwd_str.ends_with("backend") {
        cwd.parent().unwrap().to_str().unwrap().to_string()
    } else {
        cwd_str.to_string()
    }
}

/// Returns (base_directory, is_packaged).
/// is_packaged == true when running from exe-dir or APPIMAGE mode.
pub fn base_dir() -> (String, bool) {
    if let Ok(appliance) = std::env::var("APPIMAGE") {
        if !appliance.is_empty() {
            let data_dir = if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
                std::path::PathBuf::from(xdg_data_home)
            } else if let Ok(home) = std::env::var("HOME") {
                std::path::PathBuf::from(home).join(".local/share")
            } else {
                eprintln!("Warning: APPIMAGE set but XDG_DATA_HOME/HOME not set — falling back to exe mode");
                return (app_dir(), true);
            };
            let onyx_dir = data_dir.join("onyx");
            let _ = std::fs::create_dir_all(&onyx_dir);
            return (onyx_dir.to_str().unwrap().to_string(), true);
        }
    }
    let exe_dir = app_dir();
    if std::path::Path::new(&exe_dir).join("scripts").exists() {
        (exe_dir, true)
    } else {
        let cwd = std::env::current_dir().unwrap();
        let cwd_str = cwd.to_str().unwrap();
        if cwd_str.ends_with("backend") {
            (cwd.parent().unwrap().to_str().unwrap().to_string(), false)
        } else {
            (cwd_str.to_string(), false)
        }
    }
}

/// Returns true when running in packaged mode (exe-dir or APPIMAGE).
pub fn is_packaged() -> bool {
    base_dir().1
}

/// Returns a tokio Command configured to use bundled node.exe/node if available, else system node from PATH.
fn node_command(base_path: &str) -> tokio::process::Command {
    let node_bin = if cfg!(windows) {
        format!("{}/node.exe", base_path)
    } else {
        format!("{}/node", base_path)
    };
    if std::path::Path::new(&node_bin).exists() {
        tokio::process::Command::new(node_bin)
    } else {
        eprintln!("Warning: bundled node not found at '{}'; falling back to PATH", node_bin);
        tokio::process::Command::new("node")
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
    expert_count: Option<u32>,
    embedding_length: Option<u32>,
    feed_forward_length: Option<u32>,
}

#[derive(Serialize)]
struct Model {
    id: String,
    name: String,
    quantization: String,
    size_gb: f32,
    context_length: u32,
    block_count: u32,
    architecture: String,
    expert_count: Option<u32>,
    embedding_length: Option<u32>,
    feed_forward_length: Option<u32>,
    mmproj: Option<String>,
    mmproj_size_gb: Option<f32>,
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
    #[serde(default)]
    identifier: Option<String>,
    #[serde(default)]
    engine_id: Option<String>,
    ctx_size: u32,
    gpu_layers: u32,
    #[serde(default)]
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
    #[serde(default)]
    spec_type: String,
    #[serde(default)]
    spec_draft_n_max: u32,
    #[serde(default)]
    enable_vision: bool,
    #[serde(default)]
    moe_cpu_layers: u32,
    rpc_servers: Option<Vec<RpcServer>>,
    #[serde(default)]
    local_gpus: Option<Vec<LocalGpu>>,
    #[serde(default)]
    device_order: Option<Vec<String>>,
    #[serde(default)]
    mmproj: Option<String>,
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
    logs: std::collections::VecDeque<String>,
    progress: f32,
    instance_id: uuid::Uuid,
}

#[derive(Clone, Serialize)]
struct DownloadState {
    repo_id: String,
    filename: String,
    progress: f32,
    status: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct DownloadRequest {
    repo_id: String,
    filename: String,
}

struct AppState {
    http_client: reqwest::Client,
    active_servers: Mutex<HashMap<String, ActiveServer>>,
    telemetry_cache: Arc<Mutex<TelemetryResponse>>,
    proxy_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    proxy_addr: Mutex<Option<String>>,
    benchmark_running: Mutex<bool>,
    benchmark_logs: Mutex<Vec<String>>,
    benchmark_pp: Mutex<Option<f32>>,
    benchmark_tg: Mutex<Option<f32>>,
    system_logs: Mutex<std::collections::VecDeque<String>>,
    hf_downloads: Mutex<std::collections::HashMap<String, DownloadState>>,
    engine_setup_killer: Mutex<Option<(String, tokio::sync::oneshot::Sender<()>)>>,
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
    let settings_path = format!("{}/data/settings.json", base_dir().0);
    if let Ok(data) = fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str(&data) {
            return Json(json);
        }
    }
    Json(serde_json::json!({}))
}

async fn get_model_settings() -> Json<serde_json::Value> {
    let settings_path = format!("{}/data/model_settings.json", base_dir().0);
    if let Ok(data) = fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str(&data) {
            return Json(json);
        }
    }
    Json(serde_json::json!({}))
}

async fn save_settings(Json(payload): Json<serde_json::Value>) -> Json<StartResponse> {
    let (base_dir, _) = base_dir();
let data_dir = format!("{}/data", base_dir);
    let _ = fs::create_dir_all(&data_dir);
    if let Ok(json_str) = serde_json::to_string_pretty(&payload) {
        let settings_path = format!("{}/data/settings.json", base_dir);
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
        logs.push_back("[System] Gateway stopped.".to_string());
        return Json(StartResponse { success: true, message: "Gateway stopped".to_string() });
    }
    Json(StartResponse { success: false, message: "Gateway not running".to_string() })
}

async fn get_system_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<Vec<String>> {
    let logs = state.system_logs.lock().await;
    Json(logs.iter().cloned().collect())
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        message: "LocalLLM Rust Backend is running natively!".to_string(),
    })
}

#[derive(Deserialize)]
struct DeleteModelQuery {
    id: String,
}

async fn delete_local_model(axum::extract::Query(query): axum::extract::Query<DeleteModelQuery>) -> Json<StartResponse> {
    let (base, _) = base_dir();
    let models_dir = std::path::Path::new(&base).join("models");
    
    // Safety check to prevent escaping models_dir
    let clean_id = query.id.replace("..", "");
    let target_path = models_dir.join(&clean_id);
    
    if target_path.exists() && target_path.starts_with(&models_dir) {
        if target_path.is_file() {
            if let Err(e) = std::fs::remove_file(&target_path) {
                return Json(StartResponse { success: false, message: e.to_string() });
            }
            if let Some(parent) = target_path.parent() {
                if parent != models_dir && parent.starts_with(&models_dir) {
                    let _ = std::fs::remove_dir(parent); // will only succeed if empty
                }
            }
        } else if target_path.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&target_path) {
                return Json(StartResponse { success: false, message: e.to_string() });
            }
        }
        Json(StartResponse { success: true, message: "Model deleted".to_string() })
    } else {
        Json(StartResponse { success: false, message: "Model not found".to_string() })
    }
}

async fn get_local_models() -> Response {
    let mut models = Vec::new();
    let (base_dir_root, _) = base_dir();
let models_dir_str = format!("{}/models", base_dir_root);
    let models_dir = Path::new(&models_dir_str);

    let mut files_to_process = Vec::new();
    let mut mmprojs_by_dir: std::collections::HashMap<String, (String, f32)> = std::collections::HashMap::new();

    if let Ok(entries) = fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "gguf") {
                let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if filename.contains("mmproj") {
                    let size = std::fs::metadata(&path).map(|m| m.len() as f32 / (1024.0 * 1024.0 * 1024.0)).unwrap_or(0.0);
                    mmprojs_by_dir.insert("".to_string(), (filename, size));
                } else {
                    files_to_process.push((path, filename.clone(), filename));
                }
            } else if path.is_dir() {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if let Ok(sub_entries) = fs::read_dir(&path) {
                    for sub_entry in sub_entries.flatten() {
                        let sub_path = sub_entry.path();
                        if sub_path.is_file() && sub_path.extension().is_some_and(|ext| ext == "gguf") {
                            let filename = sub_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            let rel_path = format!("{}/{}", dir_name, filename);
                            if filename.contains("mmproj") {
                                let size = std::fs::metadata(&sub_path).map(|m| m.len() as f32 / (1024.0 * 1024.0 * 1024.0)).unwrap_or(0.0);
                                mmprojs_by_dir.insert(dir_name.clone(), (rel_path, size));
                            } else {
                                files_to_process.push((sub_path, filename, rel_path));
                            }
                        }
                    }
                }
            }
        }
    }

    let mut header_buffer = vec![0u8; 1024 * 1024 * 64];

    for (path, filename, rel_path) in files_to_process {
        let size_gb = if let Ok(metadata) = fs::metadata(&path) {
            (metadata.len() as f32) / (1024.0 * 1024.0 * 1024.0)
        } else {
            0.0
        };

                // Try to load from cache first
                let (base_dir_cache, _) = base_dir();
                let cache_path_str = format!("{}/models/metadata_cache.json", base_dir_cache);
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
                let mut expert_count = None;
                let mut embedding_length = None;
                let mut feed_forward_length = None;

                if let Some(cached_data) = cache.get(&filename) {
                    context_length = cached_data.context_length;
                    block_count = cached_data.block_count;
                    architecture = cached_data.architecture.clone();
                    quantization = cached_data.quantization.clone();
                    expert_count = cached_data.expert_count;
                    embedding_length = cached_data.embedding_length;
                    feed_forward_length = cached_data.feed_forward_length;
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
                        if let Ok(bytes_read) = file.read(&mut header_buffer) {
                            match gguf::GGUFFile::read(&header_buffer[..bytes_read]) {
                                Ok(Some(gguf_file)) => {
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
                                    if md.key.ends_with(".expert_count") {
                                        if let gguf::GGUFMetadataValue::Uint32(v) = md.value {
                                            expert_count = Some(v);
                                        }
                                    }
                                    if md.key.ends_with(".embedding_length") {
                                        if let gguf::GGUFMetadataValue::Uint32(v) = md.value {
                                            embedding_length = Some(v);
                                        }
                                    }
                                    if md.key.ends_with(".feed_forward_length") {
                                        if let gguf::GGUFMetadataValue::Uint32(v) = md.value {
                                            feed_forward_length = Some(v);
                                        }
                                    }
                                }
                            }
                            Ok(None) => {
                                println!("gguf parser returned None for {}", filename);
                            }
                            Err(_) => {
                                println!("gguf parser failed for {}", filename);
                            }
                        }
                        }
                    }
                    
                    // Fallback to substring binary search if full parser fails (e.g. header > 5MB)
                    if context_length == 0 || block_count == 0 {
                        if let Ok(mut file) = fs::File::open(&path) {
                            use std::io::Read;
                            if let Ok(bytes_read) = file.read(&mut header_buffer) {
                                let buffer_slice = &header_buffer[..bytes_read];
                                let ctx_needle = b".context_length";
                                if let Some(pos) = buffer_slice.windows(ctx_needle.len()).position(|w| w == ctx_needle) {
                                    let type_pos = pos + ctx_needle.len();
                                    if type_pos + 8 <= buffer_slice.len() {
                                        let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            context_length = u32::from_le_bytes(buffer_slice[type_pos+4..type_pos+8].try_into().unwrap());
                                        }
                                    }
                                }
                                let ctx_train_needle = b".n_ctx_train";
                                if context_length == 0 {
                                    if let Some(pos) = buffer_slice.windows(ctx_train_needle.len()).position(|w| w == ctx_train_needle) {
                                        let type_pos = pos + ctx_train_needle.len();
                                        if type_pos + 8 <= buffer_slice.len() {
                                            let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                            if val_type == 4 {
                                                context_length = u32::from_le_bytes(buffer_slice[type_pos+4..type_pos+8].try_into().unwrap());
                                            }
                                        }
                                    }
                                }
                                let blk_needle = b".block_count";
                                if let Some(pos) = buffer_slice.windows(blk_needle.len()).position(|w| w == blk_needle) {
                                    let type_pos = pos + blk_needle.len();
                                    if type_pos + 8 <= buffer_slice.len() {
                                        let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            block_count = u32::from_le_bytes(buffer_slice[type_pos+4..type_pos+8].try_into().unwrap());
                                        }
                                    }
                                }
                                
                                let exp_needle = b".expert_count";
                                if let Some(pos) = buffer_slice.windows(exp_needle.len()).position(|w| w == exp_needle) {
                                    let type_pos = pos + exp_needle.len();
                                    if type_pos + 8 <= buffer_slice.len() {
                                        let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            expert_count = Some(u32::from_le_bytes(buffer_slice[type_pos+4..type_pos+8].try_into().unwrap()));
                                        }
                                    }
                                }
                                let emb_needle = b".embedding_length";
                                if let Some(pos) = buffer_slice.windows(emb_needle.len()).position(|w| w == emb_needle) {
                                    let type_pos = pos + emb_needle.len();
                                    if type_pos + 8 <= buffer_slice.len() {
                                        let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            embedding_length = Some(u32::from_le_bytes(buffer_slice[type_pos+4..type_pos+8].try_into().unwrap()));
                                        }
                                    }
                                }
                                let ffn_needle = b".feed_forward_length";
                                if let Some(pos) = buffer_slice.windows(ffn_needle.len()).position(|w| w == ffn_needle) {
                                    let type_pos = pos + ffn_needle.len();
                                    if type_pos + 8 <= buffer_slice.len() {
                                        let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 4 {
                                            feed_forward_length = Some(u32::from_le_bytes(buffer_slice[type_pos+4..type_pos+8].try_into().unwrap()));
                                        }
                                    }
                                }
                                let arch_needle = b"general.architecture";
                                if let Some(pos) = buffer_slice.windows(arch_needle.len()).position(|w| w == arch_needle) {
                                    let type_pos = pos + arch_needle.len();
                                    if type_pos + 12 <= buffer_slice.len() {
                                        let val_type = u32::from_le_bytes(buffer_slice[type_pos..type_pos+4].try_into().unwrap());
                                        if val_type == 8 {
                                            let str_len = u64::from_le_bytes(buffer_slice[type_pos+4..type_pos+12].try_into().unwrap()) as usize;
                                            if type_pos + 12 + str_len <= buffer_slice.len() {
                                                if let Ok(s) = std::str::from_utf8(&buffer_slice[type_pos+12..type_pos+12+str_len]) {
                                                    architecture = s.to_string();
                                                }
                                            }
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
                        expert_count,
                        embedding_length,
                        feed_forward_length,
                    };
                    cache.insert(filename.clone(), new_metadata);
                    if let Ok(cache_str) = serde_json::to_string_pretty(&cache) {
                        let temp_cache_path = cache_path.with_extension("tmp");
                        let _ = fs::write(&temp_cache_path, cache_str);
                        let _ = fs::rename(&temp_cache_path, cache_path);
                    }
                }

                let name = if filename.ends_with(".gguf") {
                    filename[..filename.len() - 5].to_string()
                } else {
                    filename.clone()
                };

                let parent_dir = path.parent().and_then(|p| p.file_name()).unwrap_or_default().to_string_lossy().to_string();
                let is_root = path.parent().is_none_or(|p| p == models_dir);
                let dir_key = if is_root { "".to_string() } else { parent_dir };
                let mmproj_data = mmprojs_by_dir.get(&dir_key);
                let mmproj = mmproj_data.map(|d| d.0.clone());
                let mmproj_size_gb = mmproj_data.map(|d| d.1);

                models.push(Model {
                    id: rel_path.clone(),
                    name,
                    quantization,
                    size_gb,
                    context_length,
                    block_count,
                    architecture,
                    expert_count,
                    embedding_length,
                    feed_forward_length,
                    mmproj,
                    mmproj_size_gb,
                });
    }

    models.sort_by(|a, b| a.name.cmp(&b.name));
    
    let pretty = serde_json::to_string_pretty(&models).unwrap_or_else(|_| "[]".to_string());
    axum::response::Response::builder()
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(pretty))
        .unwrap()
}

async fn proxy_models_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Response {
    let servers = state.active_servers.lock().await;
    let mut data = Vec::new();
    
    let settings_path = format!("{}/data/model_settings.json", base_dir().0);
    let model_settings: std::collections::HashMap<String, String> = if Path::new(&settings_path).exists() {
        if let Ok(file_data) = fs::read_to_string(&settings_path) {
            serde_json::from_str(&file_data).unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };
    
    for model_id in servers.keys() {
        let clean_id = model_id.strip_suffix(".gguf").unwrap_or(model_id).to_string();
        let display_id = model_settings.get(model_id).cloned().unwrap_or(clean_id);
        data.push(serde_json::json!({
            "id": display_id,
            "object": "model",
            "created": chrono::Utc::now().timestamp(),
            "owned_by": "onyx"
        }));
    }
    
    let payload = serde_json::json!({
        "object": "list",
        "data": data
    });
    
    let pretty = serde_json::to_string_pretty(&payload).unwrap();
    axum::response::Response::builder()
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(pretty))
        .unwrap()
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

    let client = &state.http_client;
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
    state.system_logs.lock().await.push_back(format!("[{}] Network gateway configured: {} (Port: {}, Network Host: {})", timestamp, bind_addr, payload.port, payload.network_host));
    
    if let Some(task) = proxy_lock.take() {
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    
    let app = Router::new()
        .route("/v1/models", axum::routing::get(proxy_models_handler))
        .route("/models", axum::routing::get(proxy_models_handler))
        .fallback(proxy_handler)
        .with_state(state.clone())
        .layer(CorsLayer::permissive());
    
    let mut listener_result = tokio::net::TcpListener::bind(&bind_addr).await;
    for _ in 0..10 {
        if listener_result.is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        listener_result = tokio::net::TcpListener::bind(&bind_addr).await;
    }
    
    match listener_result {
        Ok(listener) => {
            let task = tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            *proxy_lock = Some(task);
            *proxy_addr_lock = Some(bind_addr.clone());
            state.system_logs.lock().await.push_back(format!("[System] Gateway started on {}", bind_addr));
            
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
        Json(server.logs.iter().cloned().collect())
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
    instance_id: uuid::Uuid,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if model_id == "engine_setup" || model_id == "system" {
                let mut sys_logs = state.system_logs.lock().await;
                sys_logs.push_back(line.clone());
                if sys_logs.len() > 1000 { sys_logs.pop_front(); }
            } else {
                let mut servers = state.active_servers.lock().await;
                if let Some(server) = servers.get_mut(&model_id) {
                    if server.instance_id != instance_id {
                        break;
                    }
                    server.logs.push_back(line.clone());
                    if server.logs.len() > 1000 { server.logs.pop_front(); }

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
                        state.system_logs.lock().await.push_back(format!("[{}] {} Error: {}", timestamp, model_id, line));
                    }
                } else {
                    break;
                }
            }
        }
    });
}

fn compute_gpu_offloads(payload: &ServerConfig, delimiter: &str) -> (u32, Option<String>, Option<String>) {
    let mut actual_gpu_layers = payload.gpu_layers;
    let mut ts_arg = None;
    let mut dev_arg = None;

    if let Some(allocs) = &payload.layer_allocations {
        let mut total_offloaded = 0;
        let mut splits = Vec::new();
        let mut devices = Vec::new();

        let prefix = if let Some(e) = &payload.engine_id {
            if e.to_lowercase().contains("metal") { "MTL" }
            else if e.to_lowercase().contains("vulkan") { "Vulkan" }
            else { "CUDA" }
        } else {
            "CUDA"
        };

        if let Some(order) = &payload.device_order {
            if !order.is_empty() {
                for dev_id in order {
                    let mut is_active = true;
                    if dev_id.starts_with("rpc_") {
                        if let Ok(idx) = dev_id[4..].parse::<usize>() {
                            if let Some(rpcs) = &payload.rpc_servers {
                                if let Some(rpc) = rpcs.get(idx) {
                                    is_active = rpc.active;
                                } else {
                                    is_active = false;
                                }
                            }
                        }
                    } else if dev_id.starts_with("gpu_") {
                        if let Ok(idx) = dev_id[4..].parse::<usize>() {
                            if let Some(gpus) = &payload.local_gpus {
                                if let Some(gpu) = gpus.iter().find(|g| g.index == idx) {
                                    is_active = gpu.active;
                                } else {
                                    is_active = false;
                                }
                            }
                        }
                    }

                    if !is_active {
                        continue;
                    }

                    let layers = allocs.get(dev_id).copied().unwrap_or(0);
                    splits.push(layers.to_string());
                    total_offloaded += layers;
                    
                    if dev_id.starts_with("rpc_") {
                        if let Ok(idx) = dev_id[4..].parse::<usize>() {
                            devices.push(format!("RPC{}", idx));
                        }
                    } else if dev_id.starts_with("gpu_") {
                        if let Ok(idx) = dev_id[4..].parse::<usize>() {
                            devices.push(format!("{}{}", prefix, idx));
                        }
                    }
                }
            } else {
                if let Some(gpus) = &payload.local_gpus {
                    if !gpus.is_empty() {
                        let max_gpu_index = gpus.iter().map(|g| g.index).max().unwrap_or(0);
                        for i in 0..=max_gpu_index {
                            let key = format!("gpu_{}", i);
                            let layers = allocs.get(&key).copied().unwrap_or(0);
                            splits.push(layers.to_string());
                            devices.push(format!("{}{}", prefix, i));
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
                            devices.push(format!("RPC{}", idx));
                            total_offloaded += layers;
                        }
                    }
                }
            }
        } else {
            if let Some(gpus) = &payload.local_gpus {
                if !gpus.is_empty() {
                    let max_gpu_index = gpus.iter().map(|g| g.index).max().unwrap_or(0);
                    for i in 0..=max_gpu_index {
                        let key = format!("gpu_{}", i);
                        let layers = allocs.get(&key).copied().unwrap_or(0);
                        splits.push(layers.to_string());
                        devices.push(format!("{}{}", prefix, i));
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
                        devices.push(format!("RPC{}", idx));
                        total_offloaded += layers;
                    }
                }
            }
        }
        
        actual_gpu_layers = total_offloaded;
        if splits.len() > 1 {
            ts_arg = Some(splits.join(delimiter));
            dev_arg = Some(devices.join(delimiter));
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
    
    (actual_gpu_layers, ts_arg, dev_arg)
}

async fn start_server(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<ServerConfig>,
) -> Json<StartResponse> {
    
    let settings_path = format!("{}/data/model_settings.json", base_dir().0);
    let mut model_settings: std::collections::HashMap<String, String> = if Path::new(&settings_path).exists() {
        if let Ok(data) = fs::read_to_string(&settings_path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };
    
    if let Some(ref custom_id) = payload.identifier {
        if !custom_id.is_empty() {
            model_settings.insert(payload.model_id.clone(), custom_id.clone());
        } else {
            let clean_id = payload.model_id.strip_suffix(".gguf").unwrap_or(&payload.model_id).to_string();
            model_settings.insert(payload.model_id.clone(), clean_id);
        }
    } else {
        let clean_id = payload.model_id.strip_suffix(".gguf").unwrap_or(&payload.model_id).to_string();
        model_settings.insert(payload.model_id.clone(), clean_id);
    }
    
    if let Ok(json_str) = serde_json::to_string_pretty(&model_settings) {
        let _ = fs::create_dir_all(format!("{}/data", base_dir().0));
        let _ = fs::write(&settings_path, json_str);
    }

    let (port, old_process) = {
        let mut servers_map = state.active_servers.lock().await;
        let old_proc = servers_map.remove(&payload.model_id).and_then(|mut s| s.process.take());
        let mut p = 8080;
        while servers_map.values().any(|s| s.port == p) {
            p += 1;
        }
        (p, old_proc)
    };

    if let Some(mut child) = old_process {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    
    let model_path = format!("{}/models/{}", base_dir().0, payload.model_id);
    let (base, _) = base_dir();
    let engine_dir = if let Some(e) = &payload.engine_id {
        if e.is_empty() {
            format!("{}/llama-cpp", base)
        } else {
            format!("{}/engines/{}", base, e)
        }
    } else {
        format!("{}/llama-cpp", base)
    };
    
    let binary_path = if cfg!(windows) {
        format!("{}/llama-server.exe", engine_dir)
    } else {
        format!("{}/llama-server", engine_dir)
    };

    if !Path::new(&binary_path).exists() {
        return Json(StartResponse {
            success: false,
            message: format!("Binary not found at {}", binary_path),
        });
    }

    let (actual_gpu_layers, ts_arg, dev_arg) = compute_gpu_offloads(&payload, ",");

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

    if !payload.spec_type.is_empty() && payload.spec_type != "none" {
        args.push("--spec-type".to_string());
        args.push(payload.spec_type.clone());
        
        if payload.spec_draft_n_max > 0 {
            args.push("--spec-draft-n-max".to_string());
            args.push(payload.spec_draft_n_max.to_string());
        }
    }

    if payload.enable_vision {
        let model_path_obj = std::path::Path::new(&model_path);
        if let Some(parent) = model_path_obj.parent() {
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let fname = entry.file_name().to_string_lossy().to_lowercase();
                    if fname.contains("mmproj") && fname.ends_with(".gguf") {
                        args.push("--mmproj".to_string());
                        args.push(entry.path().to_string_lossy().to_string());
                        break;
                    }
                }
            }
        }
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

    if let Some(ts) = ts_arg {
        args.push("-ts".to_string());
        args.push(ts);
    }
    if let Some(dev) = dev_arg {
        args.push("-dev".to_string());
        args.push(dev);
    }

    if !payload.offload_kv { args.push("--no-kv-offload".to_string()); }
    if !payload.unified_kv { args.push("--no-kv-unified".to_string()); }
    if payload.moe_cpu_layers > 0 { 
        args.push("--n-cpu-moe".to_string()); 
        args.push(payload.moe_cpu_layers.to_string());
    }
    
    if payload.keep_in_memory { 
        args.push("--load-mode".to_string()); 
        args.push("mlock".to_string()); 
    } else if !payload.mmap { 
        args.push("--load-mode".to_string()); 
        args.push("none".to_string()); 
    }
    
    args.push("--flash-attn".to_string());
    args.push(if payload.flash_attention { "on".to_string() } else { "off".to_string() });

    if let Some(mmproj_path) = &payload.mmproj {
        let full_mmproj_path = format!("{}/models/{}", base_dir().0, mmproj_path);
        args.push("--mmproj".to_string());
        args.push(full_mmproj_path);
    }

    let full_command = format!("{} {}", binary_path, args.join(" "));
    state.system_logs.lock().await.push_back("I [SYSTEM] Booting llama-server with parameters:".to_string());
    state.system_logs.lock().await.push_back(format!("I [SYSTEM] {}", full_command));

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
    
    let mut initial_logs = std::collections::VecDeque::new();
    initial_logs.push_back("I [SYSTEM] Booting llama-server with exact parameters:".to_string());
    initial_logs.push_back(format!("I [SYSTEM] {}", full_command));

    let instance_id = uuid::Uuid::new_v4();

    let server_state = ActiveServer {
        process: Some(child),
        model_id: payload.model_id.clone(),
        port,
        is_ready: false,
        logs: initial_logs,
        progress: 0.0,
        instance_id: instance_id.clone(),
    };
    
    {
        let mut servers_map = state.active_servers.lock().await;
        servers_map.insert(payload.model_id.clone(), server_state);
    }

    spawn_log_reader(stdout, state.clone(), payload.model_id.clone(), instance_id.clone());
    spawn_log_reader(stderr, state.clone(), payload.model_id.clone(), instance_id);

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
            let _ = child.wait().await;
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
        for server in servers_map.values_mut() {
            if let Some(mut child) = server.process.take() {
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
        }
        servers_map.clear();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "llama-server.exe", "/T"])
            .output();
    }

    let model_path = format!("{}/models/{}", base_dir().0, payload.model_id);
    let (base, _) = base_dir();
    let engine_dir = if let Some(e) = &payload.engine_id {
        if e.is_empty() {
            format!("{}/llama-cpp", base)
        } else {
            format!("{}/engines/{}", base, e)
        }
    } else {
        format!("{}/llama-cpp", base)
    };
    
    let binary_path = if cfg!(windows) {
        format!("{}/llama-bench.exe", engine_dir)
    } else {
        format!("{}/llama-bench", engine_dir)
    };

    if !std::path::Path::new(&binary_path).exists() {
        *state.benchmark_running.lock().await = false;
        return Json(StartResponse {
            success: false,
            message: format!("llama-bench binary not found at {}", binary_path),
        });
    }
    
    let (actual_gpu_layers, ts_arg, dev_arg) = compute_gpu_offloads(&payload, "/");

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

    if let Some(ts) = ts_arg {
        args.push("-ts".to_string());
        args.push(ts);
    }
    if let Some(dev) = dev_arg {
        args.push("-dev".to_string());
        args.push(dev);
    }

    if payload.moe_cpu_layers > 0 {
        args.push("--n-cpu-moe".to_string());
        args.push(payload.moe_cpu_layers.to_string());
    }

    if !payload.offload_kv { args.push("-nkvo".to_string()); args.push("1".to_string()); }
    if payload.keep_in_memory { args.push("-lm".to_string()); args.push("mlock".to_string()); }
    else if !payload.mmap { args.push("-lm".to_string()); args.push("none".to_string()); }
    if payload.flash_attention { args.push("-fa".to_string()); args.push("1".to_string()); }

    let shared_state = state.clone();
    
    let full_command = format!("{} {}", binary_path, args.join(" "));
    state.benchmark_logs.lock().await.push("I [SYSTEM] Booting llama-bench with exact parameters:".to_string());
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
                let err_msg = format!("E [SYSTEM] Failed to start llama-bench: {}", e);
                eprintln!("{}", err_msg);
                shared_state.benchmark_logs.lock().await.push(err_msg);
                *shared_state.benchmark_running.lock().await = false;
                return;
            }
        };

        let stdout = child.inner().stdout.take().expect("Failed to open stdout");
        let stderr = child.inner().stderr.take().expect("Failed to open stderr");

        let state_clone_out = shared_state.clone();
        let out_handle = tokio::spawn(async move {
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
        let err_handle = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let mut logs = state_clone_err.benchmark_logs.lock().await;
                logs.push(line);
            }
        });

        let _ = child.wait().await;
        let _ = tokio::join!(out_handle, err_handle);
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


#[derive(Deserialize)]
struct HfSearchQuery {
    q: String,
}

async fn hf_search(axum::extract::Query(query): axum::extract::Query<HfSearchQuery>) -> Json<serde_json::Value> {
    let url = format!("https://huggingface.co/api/models?search={}&filter=gguf&limit=20", query.q);
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await;
    match res {
        Ok(r) => {
            if let Ok(json) = r.json::<serde_json::Value>().await {
                Json(json)
            } else {
                Json(serde_json::json!([]))
            }
        },
        Err(_) => Json(serde_json::json!([])),
    }
}

#[derive(Deserialize)]
struct HfModelQuery {
    id: String,
}

async fn hf_model_files(axum::extract::Query(query): axum::extract::Query<HfModelQuery>) -> Json<serde_json::Value> {
    let url = format!("https://huggingface.co/api/models/{}/tree/main?recursive=true", query.id);
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await;
    match res {
        Ok(r) => {
            if let Ok(json) = r.json::<Vec<serde_json::Value>>().await {
                let siblings: Vec<serde_json::Value> = json.into_iter().map(|v| {
                    let path = v.get("path").and_then(|p| p.as_str()).unwrap_or("").to_string();
                    let size = v.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                    serde_json::json!({
                        "rfilename": path,
                        "size": size
                    })
                }).collect();
                Json(serde_json::json!({ "siblings": siblings }))
            } else {
                Json(serde_json::json!({ "siblings": [] }))
            }
        },
        Err(_) => Json(serde_json::json!({ "siblings": [] })),
    }
}

async fn hf_download(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<DownloadRequest>,
) -> Json<StartResponse> {
    let download_id = format!("{}/{}", payload.repo_id, payload.filename);
    {
        let mut downloads = state.hf_downloads.lock().await;
        if downloads.contains_key(&download_id) {
            return Json(StartResponse { success: false, message: "Download already in progress".to_string() });
        }
        downloads.insert(download_id.clone(), DownloadState {
            repo_id: payload.repo_id.clone(),
            filename: payload.filename.clone(),
            progress: 0.0,
            status: "downloading".to_string(),
            error: None,
        });
    }

    let state_clone = state.clone();
    let repo_id = payload.repo_id.clone();
    let filename = payload.filename.clone();
    
    tokio::spawn(async move {
        let url = format!("https://huggingface.co/{}/resolve/main/{}", repo_id, filename);
        let dest_dir = format!("{}/models/{}", base_dir().0, repo_id.replace("/", "_"));
        let _ = tokio::fs::create_dir_all(&dest_dir).await;
        let dest_path_part = format!("{}/{}.part", dest_dir, filename);
        let dest_path = format!("{}/{}", dest_dir, filename);
        
        let client = reqwest::Client::new();
        match client.get(&url).send().await {
            Ok(mut res) => {
                if res.status().is_success() {
                    let total_size = res.content_length().unwrap_or(0) as f64;
                    if let Ok(mut file) = tokio::fs::File::create(&dest_path_part).await {
                        use tokio::io::AsyncWriteExt;
                        let mut downloaded: f64 = 0.0;
                        let mut download_error = None;
                        let mut last_update = tokio::time::Instant::now();
                        loop {
                            match res.chunk().await {
                                Ok(Some(chunk)) => {
                                    if let Err(e) = file.write_all(&chunk).await {
                                        download_error = Some(e.to_string());
                                        break;
                                    }
                                    downloaded += chunk.len() as f64;
                                    if total_size > 0.0 && last_update.elapsed().as_millis() > 250 {
                                        let mut d = state_clone.hf_downloads.lock().await;
                                        if let Some(dl) = d.get_mut(&download_id) {
                                            dl.progress = (downloaded / total_size * 100.0) as f32;
                                        }
                                        last_update = tokio::time::Instant::now();
                                    }
                                }
                                Ok(None) => break,
                                Err(e) => {
                                    download_error = Some(e.to_string());
                                    break;
                                }
                            }
                        }
                        
                        let _ = file.sync_all().await;
                        drop(file);
                        
                        let mut d = state_clone.hf_downloads.lock().await;
                        if let Some(dl) = d.get_mut(&download_id) {
                            if let Some(err_msg) = download_error {
                                dl.status = "error".to_string();
                                dl.error = Some(err_msg);
                            } else {
                                if let Err(e) = std::fs::rename(&dest_path_part, &dest_path) {
                                    dl.status = "error".to_string();
                                    dl.error = Some(e.to_string());
                                } else {
                                    dl.progress = 100.0;
                                    dl.status = "completed".to_string();
                                }
                            }
                        }
                        tokio::spawn({ let s = state_clone.clone(); let id = download_id.clone(); async move { tokio::time::sleep(std::time::Duration::from_secs(10)).await; s.hf_downloads.lock().await.remove(&id); } });
                    } else {
                        let mut d = state_clone.hf_downloads.lock().await;
                        if let Some(dl) = d.get_mut(&download_id) {
                            dl.status = "error".to_string();
                            dl.error = Some("Failed to create file".to_string());
                        }
                        tokio::spawn({ let s = state_clone.clone(); let id = download_id.clone(); async move { tokio::time::sleep(std::time::Duration::from_secs(10)).await; s.hf_downloads.lock().await.remove(&id); } });
                    }
                } else {
                    let mut d = state_clone.hf_downloads.lock().await;
                    if let Some(dl) = d.get_mut(&download_id) {
                        dl.status = "error".to_string();
                        dl.error = Some(format!("HTTP {}", res.status()));
                    }
                    tokio::spawn({ let s = state_clone.clone(); let id = download_id.clone(); async move { tokio::time::sleep(std::time::Duration::from_secs(10)).await; s.hf_downloads.lock().await.remove(&id); } });
                }
            }
            Err(e) => {
                let mut d = state_clone.hf_downloads.lock().await;
                if let Some(dl) = d.get_mut(&download_id) {
                    dl.status = "error".to_string();
                    dl.error = Some(e.to_string());
                }
                tokio::spawn({ let s = state_clone.clone(); let id = download_id.clone(); async move { tokio::time::sleep(std::time::Duration::from_secs(10)).await; s.hf_downloads.lock().await.remove(&id); } });
            }
        }
    });

    Json(StartResponse { success: true, message: "Download started".to_string() })
}

async fn hf_downloads_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<std::collections::HashMap<String, DownloadState>> {
    let downloads = state.hf_downloads.lock().await.clone();
    Json(downloads)
}

#[derive(Deserialize)]
struct EngineDownloadPayload {
    engine_id: String,
    url_or_flags: String,
}

async fn get_system_info() -> Json<serde_json::Value> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let has_nvidia = nvml_wrapper::Nvml::init().is_ok();
    
    let mut distro = "unknown".to_string();
    if os == "linux" {
        if Path::new("/usr/bin/pacman").exists() || Path::new("/bin/pacman").exists() {
            distro = "arch".to_string();
        } else if Path::new("/usr/bin/apt-get").exists() || Path::new("/bin/apt-get").exists() {
            distro = "debian".to_string();
        } else if Path::new("/usr/bin/dnf").exists() || Path::new("/bin/dnf").exists() {
            distro = "fedora".to_string();
        }
    }
    
    let has_xcode_clt = if os == "macos" {
        std::process::Command::new("xcode-select")
            .arg("-p")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        false
    };
    
    let has_brew = if os == "macos" {
        std::process::Command::new("brew")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        false
    };
    
    let has_cmake = std::process::Command::new("cmake")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    
    Json(serde_json::json!({
        "os": os,
        "arch": arch,
        "has_nvidia": has_nvidia,
        "distro": distro,
        "has_xcode_clt": has_xcode_clt,
        "has_brew": has_brew,
        "has_cmake": has_cmake
    }))
}

async fn get_version() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "version": env!("ONYX_VERSION"),
        "git_sha": env!("ONYX_GIT_SHA"),
        "built_at": env!("ONYX_BUILT_AT")
    }))
}

async fn get_installed_engines() -> Json<Vec<String>> {
    let mut engines = Vec::new();
    let (base, _) = base_dir();
    let engines_dir = format!("{}/engines", base);
    if let Ok(entries) = fs::read_dir(engines_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let dir_path = entry.path();
                    let bin_path = if cfg!(windows) { dir_path.join("llama-server.exe") } else { dir_path.join("llama-server") };
                    if bin_path.exists() {
                        engines.push(entry.file_name().to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    Json(engines)
}

async fn download_engine(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<EngineDownloadPayload>
) -> Json<serde_json::Value> {
    let app_base = app_dir();
    let (base, _) = base_dir();
    let script_path = format!("{}/scripts/engine_manager.js", app_base);
    let child_res = node_command(&base)
        .env("ONYX_BASE", &base)
        .arg(script_path)
        .arg("download")
        .arg(&payload.engine_id)
        .arg(&payload.url_or_flags)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .group_spawn();
        
    if let Ok(mut child) = child_res {
        let stdout = child.inner().stdout.take().unwrap();
        let stderr = child.inner().stderr.take().unwrap();
        spawn_log_reader(stdout, state.clone(), "engine_setup".to_string(), uuid::Uuid::nil());
        spawn_log_reader(stderr, state.clone(), "engine_setup".to_string(), uuid::Uuid::nil());
        
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        *state.engine_setup_killer.lock().await = Some((payload.engine_id.clone(), tx));
        let state_clone = state.clone();
        
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {}
                _ = rx => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
            }
            *state_clone.engine_setup_killer.lock().await = None;
        });
        
        Json(serde_json::json!({"success": true}))
    } else {
        Json(serde_json::json!({"success": false, "message": "Failed to spawn engine_manager"}))
    }
}

async fn compile_engine(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<EngineDownloadPayload>
) -> Json<serde_json::Value> {
    let app_base = app_dir();
    let (base, _) = base_dir();
    let script_path = format!("{}/scripts/engine_manager.js", app_base);
    let child_res = node_command(&base)
        .env("ONYX_BASE", &base)
        .arg(script_path)
        .arg("compile")
        .arg(&payload.engine_id)
        .arg(&payload.url_or_flags)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .group_spawn();
        
    if let Ok(mut child) = child_res {
        let stdout = child.inner().stdout.take().unwrap();
        let stderr = child.inner().stderr.take().unwrap();
        spawn_log_reader(stdout, state.clone(), "engine_setup".to_string(), uuid::Uuid::nil());
        spawn_log_reader(stderr, state.clone(), "engine_setup".to_string(), uuid::Uuid::nil());
        
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        *state.engine_setup_killer.lock().await = Some((payload.engine_id.clone(), tx));
        let state_clone = state.clone();
        
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {}
                _ = rx => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
            }
            *state_clone.engine_setup_killer.lock().await = None;
        });
        
        Json(serde_json::json!({"success": true}))
    } else {
        Json(serde_json::json!({"success": false, "message": "Failed to spawn engine_manager"}))
    }
}

async fn stop_engine_setup(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    if let Some((_, tx)) = state.engine_setup_killer.lock().await.take() {
        let _ = tx.send(());
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        state.system_logs.lock().await.push_back(format!("[{}] engine_setup: Process stopped by user.", timestamp));
    }
    Json(serde_json::json!({"success": true}))
}

async fn get_engine_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    if let Some((engine_id, _)) = state.engine_setup_killer.lock().await.as_ref() {
        Json(serde_json::json!({"active_engine": engine_id}))
    } else {
        Json(serde_json::json!({"active_engine": null}))
    }
}
async fn delete_engine(
    axum::extract::Path(engine_id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    if engine_id.contains('/') || engine_id.contains('\\') || engine_id.contains("..") {
        return Json(serde_json::json!({"success": false, "message": "Invalid engine ID"}));
    }
    let (base, _) = base_dir();
    let engine_dir = format!("{}/engines/{}", base, engine_id);
    match fs::remove_dir_all(&engine_dir) {
        Ok(_) => Json(serde_json::json!({"success": true})),
        Err(e) => Json(serde_json::json!({"success": false, "message": e.to_string()}))
    }
}

#[tokio::main]
async fn main() {
    let (base, is_packaged) = base_dir();
    let models_dir = format!("{}/models", base);
    let _ = fs::create_dir_all(&models_dir);
    let data_dir = format!("{}/data", base);
    let _ = fs::create_dir_all(&data_dir);
    let engines_dir = format!("{}/engines", base);
    let _ = fs::create_dir_all(&engines_dir);
    
    // Warn if scripts/engine_manager.js is missing (engine installs will fail later)
    let app_base = app_dir();
    let script_path = format!("{}/scripts/engine_manager.js", app_base);
    if !std::path::Path::new(&script_path).exists() {
        eprintln!("Warning: {} not found — engine installs will fail", script_path);
    }
    
    let telemetry_cache = Arc::new(Mutex::new(TelemetryResponse {
        cpu_name: "Loading...".to_string(),
        cpu_usage_pct: 0.0,

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
            


            #[allow(unused_mut)]
            let mut ram_used_gb = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
            
            #[cfg(target_os = "macos")]
            {
                if let Some(macos_mem) = get_macos_used_memory() {
                    ram_used_gb = macos_mem;
                }
            }
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

                cache.physical_cores = physical_cores;
                cache.ram_used_gb = ram_used_gb;
                cache.ram_total_gb = ram_total_gb;
                cache.gpus = gpus;
            }
            
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
    });

    let shared_state = Arc::new(AppState {
        http_client: reqwest::Client::new(),
        active_servers: Mutex::new(HashMap::new()),
        telemetry_cache,
        proxy_task: Mutex::new(None),
        proxy_addr: Mutex::new(None),
        benchmark_running: Mutex::new(false),
        benchmark_logs: Mutex::new(Vec::new()),
        benchmark_pp: Mutex::new(None),
        benchmark_tg: Mutex::new(None),
        system_logs: Mutex::new(std::collections::VecDeque::new()),
        hf_downloads: Mutex::new(std::collections::HashMap::new()),
        engine_setup_killer: Mutex::new(None),
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/models", get(get_local_models).delete(delete_local_model))
        .route("/api/server/status", get(get_server_status))
        .route("/api/server/logs", get(get_server_logs))
        .route("/api/server/logs/clear", post(clear_server_logs))
        .route("/api/server/telemetry", get(get_telemetry))
        .route("/api/server/network", post(update_network_config))
        .route("/api/server/start", post(start_server))
        .route("/api/server/stop", post(stop_server))
        .route("/api/server/proxy/stop", post(stop_proxy))
        .route("/api/server/benchmark/start", post(run_benchmark))
        .route("/api/server/benchmark/status", get(get_benchmark_status))
        .route("/api/server/benchmark/clear", post(clear_benchmark_logs))
        .route("/api/settings", get(get_settings))
        .route("/api/settings/save", post(save_settings))
        .route("/api/model_settings", get(get_model_settings))
        .route("/api/system/logs", get(get_system_logs))
        .route("/api/system/logs/clear", post(clear_system_logs))
        .route("/api/huggingface/search", get(hf_search))
        .route("/api/huggingface/model", get(hf_model_files))
        .route("/api/huggingface/download", post(hf_download))
        .route("/api/huggingface/downloads", get(hf_downloads_status))
        .route("/api/system/info", get(get_system_info))
        .route("/api/version", get(get_version))
        .route("/api/engines", get(get_installed_engines))
        .route("/api/engines/download", post(download_engine))
        .route("/api/engines/compile", post(compile_engine))
        .route("/api/engines/stop", post(stop_engine_setup))
        .route("/api/engines/status", get(get_engine_status))
        .route("/api/engines/:id", axum::routing::delete(delete_engine))
        .fallback(static_handler)
        .with_state(shared_state)
        .layer(CorsLayer::permissive());

    let mut port = 3001;
    let listener = loop {
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => break l,
            Err(_e) => {
                if port < 3010 {
                    eprintln!("Port {} in use, trying {}...", port, port + 1);
                    port += 1;
                } else {
                    eprintln!("Dashboard port 3001-3010 all in use — close other Onyx instances or set ONYX_PORT");
                    std::process::exit(1);
                }
            }
        }
    };
    let addr = listener.local_addr().unwrap();
    println!("Backend middleware starting on:");
    println!("  Local:   http://127.0.0.1:{}", port);
    println!("  Network: http://{}", addr);

    // Auto-open browser in packaged modes only (opt-out with ONYX_NO_OPEN=1)
    if is_packaged && std::env::var("ONYX_NO_OPEN").map_or(true, |v| v != "1") {
        let url = format!("http://127.0.0.1:{}", port);
        let opener = if cfg!(target_os = "macos") {
            Some(("open", vec![url.clone()]))
        } else if cfg!(target_os = "linux") {
            Some(("xdg-open", vec![url.clone()]))
        } else if cfg!(target_os = "windows") {
            Some(("cmd", vec!["/c".to_string(), "start".to_string(), "".to_string(), url]))
        } else {
            eprintln!("Auto-open: unsupported OS, please open {} manually", url);
            None
        };
        if let Some((cmd, args)) = opener {
            let _ = std::process::Command::new(cmd)
                .args(&args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }

    axum::serve(listener, app).await.unwrap();
}
