# AI Development Guide & Context

This document provides context and strict guidelines for AI coding agents contributing to this project. Please read this thoroughly before generating code or modifying the architecture.

## 1. Project Architecture
This project consists of two primary layers:
1. **Frontend (SPA)**: A single-page application providing the user interface. It communicates with the backend middleware via REST APIs and WebSockets/SSE.
2. **Backend Middleware**: A lightweight server that sits between the Frontend and the `llama.cpp` binaries. 
   - **Responsibilities**: Spawning, terminating, and monitoring `llama-server` child processes. Reading system metrics (CPU, RAM, GPU, temps) using OS-level APIs or tools like `nvidia-smi`. Scanning the local file system for models. Proxying OpenAI-compatible API requests to the active `llama-server`.

## 2. UI/UX & Styling Guidelines
- **Aesthetics are Critical**: The interface MUST look premium, state-of-the-art, and visually stunning. Do not settle for basic minimal viable product designs.
- **Styling**: Use Vanilla CSS with modern practices (CSS variables, flexbox/grid). Avoid utility frameworks like Tailwind unless explicitly requested by the user.
- **Design Language**: Implement sleek dark modes, vibrant but harmonious accent colors, and glassmorphism where appropriate.
- **Typography**: Use modern, clean fonts (e.g., Inter, Roboto, Outfit).
- **Interactivity**: Add subtle micro-animations for hover states, active states, and transitions to make the interface feel responsive and alive.
- **No Placeholders**: If visual assets are needed, generate them or use high-quality CSS representations. Avoid raw text placeholders.

## 3. llama.cpp Integration Rules
- **Parameter Mapping**: Ensure frontend settings map correctly to `llama-server` CLI flags (e.g., Context Size -> `-c`, Offload Layers -> `-ngl`, Flash Attention -> `--flash-attn`).
- **Logs**: The backend must capture stdout/stderr from `llama-server` and stream it to the frontend log viewer component.
- **RPC**: Allow dynamic addition of RPC endpoints via the UI, which translates to passing `--rpc <endpoints>` flags to the server instance.

## 4. Workflows
- **Development**: Use `start_dev.bat` to start the backend and frontend in separate terminal tabs with hot-reloading enabled.
- **Testing/End-Users**: Use `start.bat` which will automatically install Node.js/Rust if missing, download the pre-compiled `llama.cpp` binaries, and start the application directly. RPC Nodes should use `start_RPC.bat` or `start_RPC.sh`.
- When implementing a new tab or feature, first build the underlying logic in the backend middleware (if required), then expose it to the frontend via a clean API, and finally build the premium UI components.
- Always check the `PRD.md` for exact feature requirements.
