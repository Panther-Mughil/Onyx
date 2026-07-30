import sys

with open('src/main.rs', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. ServerInfo
code = code.replace(
'''struct ServerInfo {
    model_id: String,
    port: u16,
    is_ready: bool,
}''',
'''struct ServerInfo {
    model_id: String,
    port: u16,
    is_ready: bool,
    progress: f32,
}'''
)

# 2. ActiveServer
code = code.replace(
'''struct ActiveServer {
    process: Option<Child>,
    model_id: String,
    port: u16,
    is_ready: bool,
    logs: Vec<String>,
}''',
'''struct ActiveServer {
    process: Option<Child>,
    model_id: String,
    port: u16,
    is_ready: bool,
    logs: Vec<String>,
    baseline_vram_mb: u64,
    size_gb: f32,
    progress: f32,
}'''
)

# 3. AppState
code = code.replace(
'''struct AppState {
    active_servers: Mutex<HashMap<String, ActiveServer>>,
    next_port: Mutex<u16>,
    sys: Mutex<System>,
    proxy_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    proxy_addr: Mutex<Option<String>>,
    benchmark_running: Mutex<bool>,
    benchmark_logs: Mutex<Vec<String>>,
    benchmark_pp: Mutex<Option<f32>>,
    benchmark_tg: Mutex<Option<f32>>,
}''',
'''struct AppState {
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
}'''
)

# 4. AppState instantiation
code = code.replace(
'''    let shared_state = Arc::new(AppState {
        active_servers: Mutex::new(HashMap::new()),
        next_port: Mutex::new(8080),
        sys: Mutex::new(sys),
        proxy_task: Mutex::new(None),
        proxy_addr: Mutex::new(None),
        benchmark_running: Mutex::new(false),
        benchmark_logs: Mutex::new(Vec::new()),
        benchmark_pp: Mutex::new(None),
        benchmark_tg: Mutex::new(None),
    });''',
'''    let shared_state = Arc::new(AppState {
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
    });'''
)

# 5. Routes
new_routes = '''        .route("/api/server/benchmark/status", get(get_benchmark_status))
        .route("/api/server/benchmark/clear", post(clear_benchmark_logs))
        .route("/api/settings", get(get_settings))
        .route("/api/settings/save", post(save_settings))
        .route("/api/server/proxy/stop", post(stop_proxy))
        .route("/api/system/logs", get(get_system_logs))'''
code = code.replace(
'''        .route("/api/server/benchmark/status", get(get_benchmark_status))
        .route("/api/server/benchmark/clear", post(clear_benchmark_logs))''',
new_routes
)

# 6. Handlers
handlers = '''
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

'''
# Insert before fn health_check
code = code.replace('async fn health_check', handlers + 'async fn health_check')

# 7. update_network_config logging
code = code.replace(
'''            *proxy_lock = Some(task);
            *proxy_addr_lock = Some(bind_addr.clone());
            
            Json(StartResponse {''',
'''            *proxy_lock = Some(task);
            *proxy_addr_lock = Some(bind_addr.clone());
            state.system_logs.lock().await.push(format!("[System] Gateway started on {}", bind_addr));
            
            Json(StartResponse {'''
)

# 8. get_server_status
old_status = '''async fn get_server_status(
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
        }
    }).collect();
    
    Json(StatusResponse { servers })
}'''
new_status = '''async fn get_server_status(
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
}'''
code = code.replace(old_status, new_status)

# 9. start_server
old_start_tail = '''    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    
    let server_state = ActiveServer {
        process: Some(child),
        model_id: payload.model_id.clone(),
        port,
        is_ready: false,
        logs: Vec::new(),
    };'''
new_start_tail = '''    let stdout = child.stdout.take().unwrap();
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
    };'''
code = code.replace(old_start_tail, new_start_tail)

with open('src/main.rs', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
