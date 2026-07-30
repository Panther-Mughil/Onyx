import sys

with open('src/main.rs', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove fields from struct ActiveServer
old_struct = '''struct ActiveServer {
    process: Option<tokio::process::Child>,
    model_id: String,
    port: u16,
    is_ready: bool,
    logs: Vec<String>,
    baseline_vram_mb: u64,
    size_gb: f32,
    progress: f32,
}'''

new_struct = '''struct ActiveServer {
    process: Option<tokio::process::Child>,
    model_id: String,
    port: u16,
    is_ready: bool,
    logs: Vec<String>,
    progress: f32,
}'''

code = code.replace(old_struct, new_struct)

# 2. Remove vram baseline computation and size_gb from start_server
old_init = '''    let mut baseline_vram = 0;
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

new_init = '''    let server_state = ActiveServer {
        process: Some(child),
        model_id: payload.model_id.clone(),
        port,
        is_ready: false,
        logs: Vec::new(),
        progress: 0.0,
    };'''

code = code.replace(old_init, new_init)

with open('src/main.rs', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
