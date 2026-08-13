use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tokio::process::Command;
use std::env;
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
    // Resolve the binary path relative to the executable's location (project root),
    // with a fallback to CWD-relative paths for flexibility.
    let rpc_binary_name = if cfg!(windows) {
        "ggml-rpc-server.exe"
    } else {
        "ggml-rpc-server"
    };

    let rpc_binary = {
        // Try relative to the executable (e.g. rpc_agent/target/release/ -> project root)
        let exe_dir = env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));
        
        let candidates = vec![
            // From exe dir: ../../.. gets us from target/release/ to project root
            exe_dir.as_ref().map(|d| d.join("../../../llama-cpp").join(rpc_binary_name)),
            // CWD-relative (when run from project root)
            Some(std::path::PathBuf::from(format!("./llama-cpp/{}", rpc_binary_name))),
            // CWD-relative (when run from rpc_agent/ via cargo run)
            Some(std::path::PathBuf::from(format!("../llama-cpp/{}", rpc_binary_name))),
        ];

        candidates
            .into_iter()
            .flatten()
            .find(|p| p.exists())
            .unwrap_or_else(|| {
                interactive_install(rpc_binary_name)
            })
    };

    println!("Using RPC binary: {:?}", rpc_binary);

    let mut child = Command::new(&rpc_binary)
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

fn interactive_install(rpc_binary_name: &str) -> std::path::PathBuf {
    use std::io::Write;
    let mut input = String::new();
    
    println!("===========================================================");
    println!("ggml-rpc-server was not found in the expected directories.");
    println!("Would you like to automatically download and compile it from source? (y/N)");
    print!("> ");
    std::io::stdout().flush().unwrap();
    
    std::io::stdin().read_line(&mut input).unwrap();
    if !input.trim().eq_ignore_ascii_case("y") {
        eprintln!("Exiting. Please run option [4] in the Onyx Terminal to install dependencies, or compile it manually.");
        std::process::exit(1);
    }
    
    // Check for git and cmake
    if std::process::Command::new("git").arg("--version").output().is_err() {
        eprintln!("Error: 'git' is not installed or not in PATH.");
        eprintln!("Please install git to continue.");
        std::process::exit(1);
    }
    if std::process::Command::new("cmake").arg("--version").output().is_err() {
        eprintln!("Error: 'cmake' is not installed or not in PATH.");
        eprintln!("Please install cmake to continue.");
        std::process::exit(1);
    }

    let mut backend = String::new();
    let is_mac = cfg!(target_os = "macos");
    
    if is_mac {
        println!("Detected macOS. Using Metal backend by default.");
        backend = "metal".to_string();
    } else {
        println!("Select the hardware backend to compile for:");
        println!("[1] CPU (Default)");
        println!("[2] CUDA (NVIDIA)");
        println!("[3] Vulkan (AMD/Intel/Cross-platform)");
        print!("Select an option (1-3): ");
        std::io::stdout().flush().unwrap();
        
        input.clear();
        std::io::stdin().read_line(&mut input).unwrap();
        
        match input.trim() {
            "2" => backend = "cuda".to_string(),
            "3" => backend = "vulkan".to_string(),
            _ => backend = "cpu".to_string(),
        }
    }
    
    let temp_dir = std::env::current_dir().unwrap().join("temp_llama_cpp_rpc");
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).unwrap();
    }
    
    println!("Cloning llama.cpp repository...");
    let status = std::process::Command::new("git")
        .args(["clone", "https://github.com/ggerganov/llama.cpp.git", temp_dir.to_str().unwrap()])
        .status()
        .expect("Failed to run git clone");
        
    if !status.success() {
        eprintln!("Failed to clone repository.");
        std::process::exit(1);
    }
    
    let build_dir = temp_dir.join("build");
    
    let mut cmake_flags = vec![
        "-B".to_string(), build_dir.to_str().unwrap().to_string(),
        "-DGGML_RPC=ON".to_string(),
        "-DBUILD_SHARED_LIBS=OFF".to_string(),
    ];
    
    if backend == "metal" {
        cmake_flags.push("-DGGML_METAL=ON".to_string());
    } else if backend == "cuda" {
        cmake_flags.push("-DGGML_CUDA=ON".to_string());
    } else if backend == "vulkan" {
        cmake_flags.push("-DGGML_VULKAN=ON".to_string());
    }
    
    println!("Configuring CMake...");
    let status = std::process::Command::new("cmake")
        .current_dir(&temp_dir)
        .args(&cmake_flags)
        .status()
        .expect("Failed to run cmake config");
        
    if !status.success() {
        eprintln!("CMake configuration failed. You may be missing required dependencies (like Vulkan headers or CUDA toolkit).");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::process::exit(1);
    }
    
    println!("Compiling ggml-rpc-server (this may take a while)...");
    let status = std::process::Command::new("cmake")
        .current_dir(&temp_dir)
        .args(["--build", build_dir.to_str().unwrap(), "--config", "Release", "-j4"])
        .status()
        .expect("Failed to run cmake build");
        
    if !status.success() {
        eprintln!("Compilation failed.");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::process::exit(1);
    }
    
    // Find the binary in build or build/bin
    let bin_names = if cfg!(windows) {
        vec!["ggml-rpc-server.exe", "bin/ggml-rpc-server.exe", "bin/Release/ggml-rpc-server.exe"]
    } else {
        vec!["ggml-rpc-server", "bin/ggml-rpc-server"]
    };
    
    let mut compiled_bin_path = None;
    for name in bin_names {
        let p = build_dir.join(name);
        if p.exists() {
            compiled_bin_path = Some(p);
            break;
        }
    }
    
    let compiled_bin = match compiled_bin_path {
        Some(p) => p,
        None => {
            eprintln!("Could not find the compiled binary in the build directory.");
            let _ = std::fs::remove_dir_all(&temp_dir);
            std::process::exit(1);
        }
    };
    
    // Create llama-cpp directory relative to executable
    let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    // Usually rpc_agent/target/release/. We want project root/llama-cpp
    let target_dir = exe_dir.join("../../../llama-cpp");
    let target_dir = if target_dir.exists() || std::fs::create_dir_all(&target_dir).is_ok() {
        target_dir
    } else {
        // Fallback to CWD
        let d = std::env::current_dir().unwrap().join("llama-cpp");
        std::fs::create_dir_all(&d).unwrap();
        d
    };
    
    let target_bin = target_dir.join(rpc_binary_name);
    
    println!("Copying binary to {:?}", target_bin);
    std::fs::copy(&compiled_bin, &target_bin).expect("Failed to copy binary");
    
    // Copy dynamic libraries if any (macOS/Linux)
    let lib_dirs = vec![build_dir.clone(), build_dir.join("bin"), build_dir.join("src")];
    for lib_dir in lib_dirs {
        if let Ok(entries) = std::fs::read_dir(lib_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy();
                    if ext_str == "so" || ext_str == "dylib" || ext_str == "dll" || path.to_string_lossy().contains(".so.") {
                        let dest = target_dir.join(path.file_name().unwrap());
                        let _ = std::fs::copy(&path, &dest);
                    }
                }
            }
        }
    }

    // Fix macOS rpath
    if is_mac {
        let _ = std::process::Command::new("install_name_tool")
            .args(["-add_rpath", "@executable_path", target_bin.to_str().unwrap()])
            .output();
    }
    
    println!("Cleaning up...");
    let _ = std::fs::remove_dir_all(&temp_dir);
    
    println!("Installation complete!");
    target_bin
}
