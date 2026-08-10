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

The following high-impact features are planned for future updates, organized by priority and scope.

---



### 5.3 Documentation & API Reference in Side Dashboard
Add a new **Docs Tab** to the Right Side Panel to provide instant, in-app reference material:
- **API Reference**: Live, interactive OpenAI-compatible API docs (e.g., `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/health`) generated from the currently active server.
- **Parameter Glossary**: Inline explanations for every `llama.cpp` loading and inference parameter exposed in the UI (ctx size, batch size, RoPE scaling, etc.).
- **Quick-Start Guides**: Embedded markdown guides for common workflows (loading a model, setting up RPC, multimodal inference).
- **Copy-Ready Code Snippets**: Auto-generated `curl`, Python (`openai` SDK), and JavaScript examples for each loaded model's endpoint.

---

### 5.4 First-Run Engine Setup Experience
Replace the current behavior where Onyx silently auto-downloads a default `llama.cpp` build on first launch with an explicit, user-driven **Engine Setup Wizard**:
- **First-Launch Onboarding Screen**: On the very first run (no engine detected), Onyx presents a dedicated setup screen instead of the main dashboard, guiding the user through picking their engine before anything else.
- **Hardware Auto-Detection**: Onyx scans the system at startup and recommends the most suitable engine variant (e.g., suggests CUDA if an NVIDIA GPU is found, Vulkan for AMD, CPU-AVX2 as a universal fallback), clearly displaying detected hardware so the user can make an informed choice.
- **Engine Variant Picker**: The user selects from a list of available `llama.cpp` build flavors:
  - CUDA 12.x / 11.x (NVIDIA)
  - Vulkan (AMD / Intel / cross-platform GPU)
  - ROCm (AMD Linux)
  - Metal (Apple Silicon — future)
  - CPU-only AVX2 / AVX512
- **Advanced Install Parameters**: An expandable "Advanced Options" panel lets power users configure additional parameters before downloading:
  - Specific `llama.cpp` release version / tag to pin
  - Custom install directory override
  - Optional components to include (e.g., `llama-bench`, `llama-rpc-server`)
- **Download with Progress**: A real-time progress bar shows download speed, ETA, and extraction status — no silent background activity.
- **Post-Install Validation**: After installation, Onyx runs a quick `llama-server --version` smoke test and displays the result to confirm the engine is functional before proceeding to the main dashboard.
- **Re-accessible via Engine Tab**: The full engine management and re-installation flow remains accessible at any time from the Engines Tab in the left sidebar (see §5.5), so users can add or swap engines after initial setup.

---

### 5.5 Multi-Engine Support (Swappable Inference Engines)
Decouple Onyx from being tightly coupled to a single `llama.cpp` build by introducing a pluggable **Engine** abstraction:
- **Engine Tab** in the left sidebar: Browse, download, and manage multiple versions of `llama.cpp` variants (CUDA 12.x, Vulkan, ROCm, CPU-AVX2, Metal) side-by-side.
- **Per-Model Engine Assignment**: Each loaded model can be assigned a specific engine variant independently — e.g., run a Mistral model on CUDA while running an embedding model on CPU-only.
- **Hot-Swap**: Reload a model with a different engine without restarting the entire Onyx backend.
- **Version Management**: Pin specific `llama.cpp` release versions per engine, with a built-in updater to fetch new GitHub releases.
- **Future Engine Backends** (longer-term): Abstract the engine interface to eventually support `ollama`, `llamafile`, or `whisper.cpp` as alternative backends.

---

### 5.6 System Tray Integration
Allow Onyx to run silently in the background after the user closes the main window:
- **Tray Icon**: A persistent OS system tray icon showing overall status (models loaded, server healthy/errored).
- **Quick Actions**: Right-click context menu to open the dashboard, stop all models, or quit Onyx entirely.
- **Startup on Login**: Optional setting to launch Onyx backend automatically on OS startup, keeping models pre-warmed.
- **Desktop Notifications**: Native OS notifications for key events — model loaded, server error, download complete.
- **Implementation**: Use `tauri` system tray APIs or a cross-platform tray library (`tray-icon` crate) integrated into the Rust backend.

---

### 5.7 Additional Suggested Improvements

These are further enhancements identified to make Onyx more competitive and production-ready:

#### 🧪 Built-in Chat Playground
A full chat interface inside the dashboard to quickly test any loaded model:
- Markdown rendering, code highlighting, streaming token output.
- Switchable system prompt and inference parameter sliders (temperature, top-p, repetition penalty) in a side panel.
- Image upload for multimodal models.
- Conversation history export (JSON / Markdown).

#### 📊 Advanced Inference Monitoring & Heatmaps
- Per-token latency graphs, time-to-first-token (TTFT), and throughput (tok/s) displayed per active model.
- Visual GPU layer allocation heatmap showing which layers reside in VRAM vs. RAM.
- Device bottleneck detector with color-coded warnings (CPU-bound, VRAM-bound, bandwidth-bound).

#### 🔗 Preset & Profile System
- Save named configuration profiles per model (e.g., "Fast Draft Mode", "High Quality Mode").
- Share profiles as portable JSON files for community sharing.

#### 🌐 Remote Dashboard Access
- Optional password-protected web UI accessible over LAN or via a reverse-proxy tunnel (Cloudflare Tunnel, Tailscale).
- Read-only guest mode for sharing monitoring dashboards without exposing controls.

#### 🤖 Model Metadata Enrichment
- **Clean Model Names**: Parse `general.name` or `general.basename` from GGUF metadata to display clean, human-readable model names in the UI (e.g., `qwen35moe`) instead of long, raw filenames like `Qwen3.6-35B-A3B-Q4_K-M`.
- Auto-fetch model cards from HuggingFace when a model is added, storing a local summary (architecture, parameter count, license, recommended use cases).
- Display a rich model info panel in the Model Selection modal.

#### 🔒 API Key Management
- Issue and manage bearer tokens for the reverse-proxied API endpoints.
- Per-key rate limiting and usage tracking (tokens generated, requests served).

#### 📦 One-Click Portable Export
- Bundle a loaded model + its exact Onyx configuration into a self-contained archive for easy transfer between machines.

### 5.8 Dependency-Free Installation & Pre-Compiled Releases
To significantly improve the onboarding experience and prevent users from encountering complex build toolchain errors (e.g., missing MSVC `link.exe` on Windows during `cargo build`), Onyx will move towards a zero-compilation distribution model:
- **Pre-Compiled Binaries**: Distribute ready-to-run executables for the Onyx Backend and RPC Agent for major platforms (Windows, macOS, Linux). Users will no longer need Rust, Cargo, or C++ Build Tools installed on their machines.
- **Automated Installers**: Provide standard installers (e.g., `.msi` for Windows, `.dmg` for macOS, `.deb`/AppImage for Linux) that automatically bundle the compiled backend, frontend static files, and initial environment configurations.
- **Self-Contained Executable**: Explore tools like Tauri or Electron to bundle the entire application (frontend + Rust backend) into a single executable file, completely eliminating the need for `onyx.bat`/`onyx.sh` scripts and terminal-based setups.

## 6. Bugs & Known Issues

### 6.1 Hardcoded API Endpoints
- **Description**: The frontend React application (`App.jsx`, `EngineManager.jsx`, etc.) heavily hardcodes the backend API endpoint as `http://127.0.0.1:3001` directly in `fetch()` calls. 
- **Impact**: This breaks the application if the user attempts to host the UI on a remote server or access it over a LAN instead of locally (`localhost`). It also makes changing the backend port difficult.
- **Resolution Plan**: Refactor the frontend to use a centralized API configuration (e.g., an Axios instance) driven by environment variables (`import.meta.env.VITE_API_BASE_URL`) or relative paths (`/api/...`), allowing the UI to seamlessly communicate with the backend regardless of where it is hosted.
