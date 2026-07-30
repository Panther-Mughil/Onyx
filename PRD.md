# Product Requirements Document (PRD): Onyx LocalLLM Dashboard

## 1. Project Overview
A web-based interface for managing and loading local LLM models using `llama.cpp` as the backend. The application aims to provide a more comprehensive set of configuration options than existing alternatives (like LM Studio), exposing the vast majority of `llama.cpp` parameters to the user in an intuitive, premium interface.

## 2. Objectives
- Provide a sleek, single-page Web UI (SPA) to manage **multiple** `llama-server` instances concurrently.
- Allow users to configure granular server settings, model loading parameters, RPC workers, and inference parameters per model.
- Provide real-time monitoring of system resources (CPU, RAM, GPU, VRAM) including multi-GPU setups.
- Display real-time, multiplexed server logs and the individual progress of concurrently loaded models.
- Persist user configurations securely and reliably via a Rust-managed backend storage system (`settings.json`).

## 3. Core Features

### 3.1. Top Navigation & Global Controls
- **Global Settings Modal**: Manage reverse-proxy configurations, port forwarding, CORS, and JIT model loading.
- **Concurrent Model Management**: A top horizontal tray or active card list displaying all currently running models.
- **System Logs**: Global error and system event logging when no specific model is selected.

### 3.2. Model Selection Modal
- Scans and lists available models from the local `models` folder.
- Displays for each model:
  - Model Name
  - Quantization (e.g., 8b, 12b, Q4_K_M)
  - File Size (GB)
- Clicking a model transitions to the **Model Configuration View**.

### 3.3. Model Configuration View
- Exposes detailed `llama.cpp` loading parameters mapped per model:
  - Context Size (ctx)
  - GPU Offload Layers
  - CPU Thread Pool Size
  - Evaluation Batch Size
  - Physical Batch Size
  - Concurrency
  - Unified KV Cache
  - Offload KV Cache to GPU Memory
  - Keep Model in Memory
  - MMAP (On/Off)
  - Flash Attention (On/Off)
- Action: "Load Model" button at the bottom to initialize a new `llama-server` background process with the chosen parameters. "Reload to Apply Changes" automatically replaces it if the model is active but configurations have been modified.

### 3.4. Main Dashboard (Center)
- **Loaded Models Container**: Displays active models, their current generation metrics, and provides buttons to eject/stop them.
- **Log Viewer**: Console output showing real-time, streaming `llama-server` stdout/stderr specifically isolated to the currently selected model.

### 3.5. Right Side Panel
Organized into tabs for quick access to configurations without interrupting the main view.
- **Load Tab**: Adjust primary model configurations, context size, and GPU offload layers.
- **RPC & Devices Tab**: Manage local GPU allocations and add remote `llama-rpc-server` nodes for distributed inference.
- **Monitoring Tab**: Real-time metrics visualization polling directly from OS and NVML:
  - CPU Usage & System RAM
  - GPU Utilization & VRAM Usage per GPU
- **Benchmark Tab**: Built-in hardware benchmarking using `llama-bench` for Prompt Processing (PP) and Token Generation (TG) speeds based on the user's exact UI configuration.

## 4. Technical Stack
- **Frontend**: Vite + React, Vanilla CSS. Features a premium, glassmorphism dark-mode aesthetic with micro-animations. State is managed locally, with UI elements derived directly from backend polling.
- **Backend Middleware**: Rust (Axum, Tokio, sysinfo, nvml-wrapper). Features a `HashMap` based state architecture to securely route TCP reverse-proxies, spawn multiple concurrent binary processes, and write robust persistent configurations to `data/settings.json`.
- **Core Engine**: `llama.cpp` (`llama-server`, `llama-bench`).

## 5. Future Roadmap
The following high-impact features are deferred for future updates:
- **Built-in Chat Playground**: A built-in chat UI directly within the dashboard to quickly test loaded models using the API.
- **1-Click HuggingFace Downloader**: A feature to input a HuggingFace GGUF URL and have the backend natively stream the model into the `models/` folder.
- **Advanced Device Monitoring**: More granular visual heatmaps for device bottlenecks.
- **System Tray Integration**: Running the backend silently in the background with OS system tray controls.
