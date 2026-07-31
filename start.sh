#!/bin/bash
cd "$(dirname "$0")"

echo "======================================="
echo "           Starting Onyx"
echo "======================================="
echo ""

# 1. Check for Node.js
if ! command -v npm &> /dev/null; then
    echo "[!] Node.js/npm not found. Attempting to install..."
    if command -v brew &> /dev/null; then
        brew install node
    elif command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y nodejs npm
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm nodejs npm
    else
        echo "Could not detect package manager. Please install Node.js manually from https://nodejs.org/"
        exit 1
    fi
    echo "=============================================================="
    echo "Node.js has been installed. Please restart your terminal"
    echo "and re-run ./start.sh for the changes to take effect."
    echo "=============================================================="
    exit 0
fi

# 2. Check for Rust (cargo)
if ! command -v cargo &> /dev/null; then
    echo "[!] Rust/Cargo not found. Installing via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    echo "=============================================================="
    echo "Rust has been installed. You MUST restart your terminal"
    echo "and re-run ./start.sh for the changes to take effect."
    echo "=============================================================="
    exit 0
fi

# 3. Check for pre-compiled llama.cpp
if [ ! -f "bin/llama-server" ]; then
    echo "[!] llama-server not found in bin/"
    echo "Downloading pre-compiled llama.cpp binaries from GitHub..."
    mkdir -p bin
    
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    
    if [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            ASSET_PATTERN="bin-macos-arm64\.zip$"
        else
            ASSET_PATTERN="bin-macos-x64\.zip$"
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v nvidia-smi &> /dev/null; then
            ASSET_PATTERN="bin-ubuntu-x64-cuda-cu12.*\.zip$"
        else
            ASSET_PATTERN="bin-ubuntu-x64\.zip$"
        fi
        
        # Fallback for aarch64 linux if missing exact match, we just look for ubuntu-aarch64 if they ever add it
        if [ "$ARCH" = "aarch64" ]; then
            ASSET_PATTERN="bin-ubuntu-aarch64\.zip$"
        fi
    else
        echo "Unsupported OS: $OS"
        exit 1
    fi
    
    # Simple curl check for release.
    DOWNLOAD_URL=$(curl -s https://api.github.com/repos/ggerganov/llama.cpp/releases/latest | grep "browser_download_url" | grep -E "$ASSET_PATTERN" | head -n 1 | cut -d '"' -f 4)
    
    # If a specific CUDA version failed, fallback to Vulkan or CPU
    if [ -z "$DOWNLOAD_URL" ] && [ "$OS" = "Linux" ] && command -v nvidia-smi &> /dev/null; then
        echo "CUDA 12 binary not found in latest release. Trying Vulkan..."
        DOWNLOAD_URL=$(curl -s https://api.github.com/repos/ggerganov/llama.cpp/releases/latest | grep "browser_download_url" | grep -E "bin-ubuntu-vulkan-x64\.zip$" | head -n 1 | cut -d '"' -f 4)
    fi
    if [ -z "$DOWNLOAD_URL" ] && [ "$OS" = "Linux" ]; then
        echo "Falling back to CPU binary..."
        DOWNLOAD_URL=$(curl -s https://api.github.com/repos/ggerganov/llama.cpp/releases/latest | grep "browser_download_url" | grep -E "bin-ubuntu-x64\.zip$" | head -n 1 | cut -d '"' -f 4)
    fi

    if [ -z "$DOWNLOAD_URL" ]; then
        echo "Failed to find a matching release asset for $OS $ARCH."
        exit 1
    fi
    
    echo "Downloading from $DOWNLOAD_URL..."
    curl -L "$DOWNLOAD_URL" -o llama.zip
    
    echo "Extracting..."
    unzip -o llama.zip -d ./bin
    rm llama.zip
    
    chmod +x ./bin/llama-server
    chmod +x ./bin/ggml-rpc-server 2>/dev/null || true
    echo "Download complete!"
fi

# 4. Install frontend dependencies
echo ""
echo "Installing frontend dependencies (if any are missing)..."
cd frontend
npm install
cd ..

# 5. Start the application
echo ""
echo "Starting backend and frontend..."

trap 'echo "Stopping servers..."; kill $(jobs -p) 2>/dev/null; exit' SIGINT SIGTERM

cd backend
cargo run &
BACKEND_PID=$!

cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Onyx is now running!"
echo "Backend: http://localhost:3001"
echo "Frontend: Check the output above for the Vite local URL (usually http://localhost:5173)"
echo "Press Ctrl+C to stop both servers gracefully."
echo ""

wait $BACKEND_PID $FRONTEND_PID
