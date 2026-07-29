# Product Requirements Document (PRD): LocalLLM Web Interface

## 1. Project Overview
A web-based interface for managing and loading local LLM models using `llama.cpp` as the backend. The application aims to provide a more comprehensive set of configuration options than existing alternatives (like LM Studio), exposing the vast majority of `llama.cpp` parameters to the user in an intuitive, premium interface.

## 2. Objectives
- Provide a sleek, single-page Web UI (SPA) to manage `llama-server` instances.
- Allow users to configure granular server settings, model loading parameters, RPC workers, and inference parameters.
- Provide real-time monitoring of system resources (CPU, RAM, GPU, VRAM) including multi-GPU setups.
- Display real-time server logs and the status of loaded models.

## 3. Core Features

### 3.1. Top Navigation Bar
- **Load Model Button**: Opens the model selection popup.
- **Server Start/Stop Button**: Toggles the `llama-server` process.
- **Server Settings Button**: Opens a popup with global server configurations:
  - Port Number
  - CORS settings
  - JIT (Just-In-Time) model loading
  - Auto unload models (timeout threshold if unused)
  - Time display and synchronization setting

### 3.2. Model Selection Popup
- Scans and lists available models from the local `models` folder.
- Displays for each model:
  - Model Name
  - Quantization (e.g., 8b, 12b, Q4_K_M)
  - Parameter Size (e.g., 7B, 8x22B)
  - File Size (GB)
- Clicking a model transitions to the **Model Configuration View**.

### 3.3. Model Configuration View
- Exposes detailed `llama.cpp` loading parameters:
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
  - K Cache Quantization Type
  - V Cache Quantization Type
  - CPU MoE (Mixture of Experts)
- Action: "Load Model" button at the bottom to initialize the server with the chosen parameters.

### 3.4. Main Dashboard (Center)
- **Loaded Models Container**: Displays currently active/loaded models and their statuses.
- **Log Viewer**: Console output showing real-time `llama-server` logs directly below the loaded models.

### 3.5. Right Side Panel
Organized into tabs for quick access to configurations without interrupting the main view.
- **Settings Tab**: Mirrors the Model Configuration View for the currently loaded model, allowing adjustments and re-loads.
- **RPC Tab**: Manage RPC settings and add RPC workers for distributed inference across multiple machines.
- **Inference Tab**:
  - Enable Thinking (reasoning mode)
  - System Prompt & Presets
  - Context Overflow Handling: Truncate Middle, Rolling Window, or Stop at Limit
  - Temperature, Top K Sampling, Top P Sampling, Min P Sampling
  - Repeat Penalty, Presence Penalty
  - Speculative Decoding toggles
- **Monitoring Tab**: Real-time metrics visualization:
  - CPU Usage & Temperature
  - RAM Usage, Cache Usage, Paging
  - Total RAM & Total VRAM Available
  - GPU N Usage & GPU N Temperature (Explicit support for multiple GPUs)

## 4. Technical Stack Recommendation
- **Frontend**: Vite + React or Next.js, with Vanilla CSS prioritizing a premium, glassmorphism, or modern dark-mode aesthetic.
- **Backend Middleware**: Node.js or Python to handle system-level metrics (reading temperatures/RAM), file system scanning (for models), and managing the lifecycle of the `llama.cpp` process.
- **Backend AI**: `llama.cpp` (`llama-server`).
