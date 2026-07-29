# LocalLLM Web Interface

A comprehensive, premium web-based user interface for `llama.cpp`, designed to give you complete control over your local AI models. Unlike other tools that hide advanced settings, this project exposes the full power of `llama.cpp` through an intuitive, modern, and highly responsive single-page application.

## ✨ Features

- **Total Parameter Control**: Access almost all `llama.cpp` options directly from the UI (Context size, offload layers, flash attention, KV cache quantization, CPU MoE, and more).
- **Real-time System Monitoring**: Track CPU, RAM, GPU, and VRAM usage and temperatures in real-time, with full support for multi-GPU setups.
- **Distributed Inference**: Built-in RPC worker management to spread inference across multiple machines.
- **Advanced Inference Settings**: Control speculative decoding, context overflow strategies (Truncate middle, Rolling window, Stop at limit), and all standard sampling parameters.
- **Sleek, Premium UI**: Modern design featuring dark mode, smooth micro-animations, glassmorphism, and a highly responsive layout.
- **Integrated Log Viewer**: Monitor `llama.cpp` server logs in real-time directly from the dashboard.

## 📂 Project Structure

- `frontend/` - The modern Web UI (React/Vite or Next.js).
- `backend/` - Middleware (Node.js/Python) to manage `llama.cpp` processes, fetch hardware metrics, and serve the API.
- `models/` - Directory for storing your GGUF models.
- `bin/` - Contains the compiled `llama.cpp` binaries (`llama-server`, `llama-rpc-server`, etc.).

## 🚀 Getting Started

*(Instructions for setting up the project will be added as development progresses.)*

## 🛠️ Development

This project heavily utilizes AI coding agents for development. Please refer to `AI_DEVELOPMENT_GUIDE.md` for context, styling rules, and architectural guidelines.
