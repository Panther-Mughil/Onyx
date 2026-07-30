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

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (For the React Frontend)
- [Rust & Cargo](https://rustup.rs/) (For the Backend middleware)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Panther-Mughil/Onyx.git
   cd Onyx
   ```
2. Place your downloaded `.gguf` models into the `models/` folder.
3. Make sure the official `llama.cpp` binaries (`llama-server.exe`, `llama-bench.exe`, etc.) are placed inside the `bin/` folder.
4. Run the setup script to install dependencies:
   ```cmd
   setup.bat
   ```

### Launch
Run the start script to boot both the Rust backend and the React frontend simultaneously:
```cmd
start.bat
```
The dashboard will automatically open in your browser at `http://localhost:5173`.

## 📡 API Integration
Onyx acts strictly as a model host. It exposes your active model as a standard OpenAI-compatible API on your selected port.
You can connect external frontends (like JanitorAI, SillyTavern, or your own scripts) by pointing them to:
`http://127.0.0.1:<PORT>/v1`

## 🛠 Tech Stack
- **Backend**: Rust (Axum, Tokio, sysinfo, nvml-wrapper)
- **Frontend**: React (Vite, Lucide-React)
- **Core Engine**: llama.cpp
