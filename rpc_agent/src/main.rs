use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tokio::process::Command;
use std::env;

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

struct AppState {
    telemetry_cache: Arc<Mutex<TelemetryResponse>>,
}

async fn get_telemetry(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<TelemetryResponse> {
    let data = state.telemetry_cache.lock().await.clone();
    Json(data)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    let host_port = if args.len() > 1 { &args[1] } else { "0.0.0.0:50052" };
    let telemetry_port = if args.len() > 2 { &args[2] } else { "0.0.0.0:50053" };
    
    println!("Starting Onyx RPC Agent...");
    println!("RPC Server bound to: {}", host_port);
    println!("Telemetry Server bound to: {}", telemetry_port);

    // Launch llama-rpc-server in the background
    let rpc_binary = if cfg!(windows) {
        "bin\\ggml-rpc-server.exe"
    } else {
        "./bin/ggml-rpc-server"
    };
    
    let mut child = Command::new(rpc_binary)
        .arg("--host")
        .arg(host_port.split(':').next().unwrap_or("0.0.0.0"))
        .arg("--port")
        .arg(host_port.split(':').last().unwrap_or("50052"))
        .kill_on_drop(true)
        .spawn()
        .expect("Failed to start llama-rpc-server. Make sure it is in your PATH.");

    tokio::spawn(async move {
        child.wait().await.unwrap();
        println!("llama-rpc-server exited.");
        std::process::exit(0);
    });

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

    let state = Arc::new(AppState {
        telemetry_cache,
    });

    let app = Router::new()
        .route("/telemetry", get(get_telemetry))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(telemetry_port).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
