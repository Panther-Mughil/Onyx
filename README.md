# Panther Dashboard

A high-performance, ultra-sleek, locally hosted web dashboard for managing and running `llama.cpp` models. Built with a lightning-fast Rust backend and a modern React frontend.

## ✨ Features

- **Zero-Downtime Networking**: Features a built-in Rust TCP reverse-proxy. Change ports and expose your API to your local network on the fly without restarting the heavy `llama-server` process.
- **Hardware Benchmarking**: Built-in VRAM-safe hardware benchmarking using `llama-bench`. Accurately test Token Generation (TG) and Prompt Processing (PP) speeds based on your exact UI configurations.
- **Distributed RPC Workers**: Seamlessly add and toggle remote `llama-rpc-server` nodes to offload tensor computations across multiple machines on your network.
- **Live Telemetry & Diagnostics**: Real-time CPU, RAM, and GPU monitoring directly inside the browser using direct NVML polling (no heavy `nvidia-smi` wrappers).
- **Premium UI/UX**: Designed with sleek glassmorphism, dynamic expanding tabs, smooth micro-animations, and a highly responsive layout.
- **Incredibly Lightweight**: By ditching Electron in favor of a native Rust backend + Web SPA, background RAM usage sits at a mere ~15MB instead of 300MB+.

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (For the React Frontend)
- [Rust & Cargo](https://rustup.rs/) (For the Backend middleware)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Panther-Mughil/Panther_LLM_Dashboard.git
   cd Panther_LLM_Dashboard
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
Panther Dashboard acts strictly as a model host. It exposes your active model as a standard OpenAI-compatible API on your selected port.
You can connect external frontends (like JanitorAI, SillyTavern, or your own scripts) by pointing them to:
`http://127.0.0.1:<PORT>/v1`

## 🛠 Tech Stack
- **Backend**: Rust (Axum, Tokio, sysinfo, nvml-wrapper)
- **Frontend**: React (Vite, Lucide-React, Recharts)
- **Core Engine**: llama.cpp
