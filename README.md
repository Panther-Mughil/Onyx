# <img src="frontend/public/favicon.svg" width="32" height="32" valign="bottom" /> Onyx

A high-performance, ultra-sleek, locally hosted web dashboard for managing and running `llama.cpp` models. Built with a lightning-fast Rust backend and a modern React frontend.

## ✨ Features

- **Concurrent Multi-Model Execution**: Seamlessly load and manage multiple `llama-server` instances simultaneously. Easily switch between them, compare outputs, and manage distinct configurations without shutting down your workflow.
- **Zero-Downtime Networking**: Features a built-in Rust TCP reverse-proxy. Change ports, configure CORS, and expose your API to your local network on the fly without restarting the heavy `llama-server` process.
- **Hardware Benchmarking**: Built-in VRAM-safe hardware benchmarking using `llama-bench`. Accurately test Token Generation (TG) and Prompt Processing (PP) speeds based on your exact UI configurations.
- **Live Telemetry & Diagnostics**: Real-time CPU, RAM, and GPU monitoring directly inside the browser using direct NVML polling (no heavy `nvidia-smi` wrappers).
- **Persistent Configurations**: Say goodbye to browser caching issues. Onyx features a robust `settings.json` backend persistent storage system that safely stores your context lengths, thread counts, and network setups permanently.
- **Distributed RPC Workers**: Seamlessly add and toggle remote `llama-rpc-server` nodes to offload tensor computations across multiple machines on your network.
- **Premium UI/UX**: Designed with sleek glassmorphism, dynamic expanding tabs, smooth micro-animations, and a highly responsive layout.
- **Incredibly Lightweight**: By ditching Electron in favor of a native Rust backend + Web SPA, background RAM usage sits at a mere ~15MB instead of 300MB+.

## 🚀 Quick Start (Compiling from Source)

Onyx is designed to be compiled directly from source to ensure the Rust backend and `llama.cpp` binaries are perfectly optimized for your specific CPU and OS architecture.

### Installation & Launch
1. Clone the repository:
   ```bash
   git clone https://github.com/Panther-Mughil/Onyx.git
   cd Onyx
   ```
2. Place your downloaded `.gguf` models into the `models/` folder.
3. Run the unified Onyx interactive terminal:
   - **Windows**: Double-click `onyx.bat`
   - **Mac/Linux**: Run `./onyx.sh`
   
### The Onyx Terminal Menu
When you run the script, you will be presented with a simple interactive menu:
1. **Start Primary Node** (Boots the compiled Rust backend which statically serves the beautiful React frontend at `http://127.0.0.1:3001`).
2. **Start RPC Worker Node** (Runs the lightweight RPC agent for distributed multi-GPU tensor offloading).
3. **Start Development Environment** (For developers who want frontend hot-reloading).
4. **Verify & Install System Dependencies** (Run this first! It will check for Rust/Node and compile the entire application natively for your machine).

*Note: Once you launch the Primary Node and visit the dashboard, navigate to the **Engine Manager** tab (Wrench icon) to automatically download or compile the best `llama.cpp` engine for your hardware.*

## 📡 API Integration
Onyx acts strictly as a model host. It exposes your active model as a standard OpenAI-compatible API on your selected port.
You can connect external frontends (like JanitorAI, SillyTavern, or your own scripts) by pointing them to:
`http://127.0.0.1:<PORT>/v1`

## 🛠 Tech Stack
- **Backend**: Rust (Axum, Tokio, sysinfo, nvml-wrapper)
- **Frontend**: React (Vite, Lucide-React)
- **Core Engine**: llama.cpp
