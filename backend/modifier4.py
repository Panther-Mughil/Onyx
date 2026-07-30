import sys

with open('src/main.rs', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update `get_server_status` to remove the VRAM logic
old_get_server_status = '''async fn get_server_status(
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

        if let Some(child) = server.process.as_mut() {'''

new_get_server_status = '''async fn get_server_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<StatusResponse> {
    let mut servers_map = state.active_servers.lock().await;
    
    let mut to_remove = Vec::new();
    for (model_id, server) in servers_map.iter_mut() {
        if let Some(child) = server.process.as_mut() {'''

code = code.replace(old_get_server_status, new_get_server_status)

# 2. Add System Logs for `update_network_config`
old_network_config = '''async fn update_network_config(
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
    
    let mut proxy_lock = state.proxy_task.lock().await;'''

new_network_config = '''async fn update_network_config(
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
    state.system_logs.lock().await.push(format!("[{}] Network gateway configured: {} (Port: {}, Network Host: {})", timestamp, bind_addr, payload.port, payload.network_host));'''

code = code.replace(old_network_config, new_network_config)

# 3. Add `llm_load_tensors` parsing in `start_server` stdout/stderr readers
old_stdout = '''    tokio::spawn(async move {
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
    });'''

new_stdout = '''    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut servers = state1.active_servers.lock().await;
            if let Some(server) = servers.get_mut(&model_id_clone) {
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
                    state1.system_logs.lock().await.push(format!("[{}] {} Error: {}", timestamp, model_id_clone, line));
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
                    state2.system_logs.lock().await.push(format!("[{}] {} Error: {}", timestamp, model_id_clone2, line));
                }
            } else {
                break;
            }
        }
    });'''

code = code.replace(old_stdout, new_stdout)

with open('src/main.rs', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
