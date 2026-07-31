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
        echo "[!] Pre-compiled macOS binaries contain a known BLAS bug."
        echo "[!] Compiling llama-server from source (this takes a moment)..."
        
        # Ensure build tools are installed
        for cmd in cmake git make; do
            if ! command -v $cmd &> /dev/null; then
                echo "[!] '$cmd' is not installed. Attempting to install via Homebrew..."
                if ! command -v brew &> /dev/null; then
                    echo "[!] Homebrew is not installed. Installing Homebrew first (you may be prompted for your password)..."
                    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                    
                    # Ensure brew is in PATH for this session
                    if [ -x "/opt/homebrew/bin/brew" ]; then
                        eval "$(/opt/homebrew/bin/brew shellenv)"
                    elif [ -x "/usr/local/bin/brew" ]; then
                        eval "$(/usr/local/bin/brew shellenv)"
                    fi
                fi
                brew install $cmd
            fi
        done
        
        rm -rf llama_src
        git clone --depth 1 https://github.com/ggml-org/llama.cpp.git llama_src
        cd llama_src
        cmake -B build -DGGML_METAL=ON -DGGML_RPC=ON -DGGML_BLAS=OFF
        cmake --build build --config Release -j $(sysctl -n hw.logicalcpu)
        cd ..
        
        cp ./llama_src/build/bin/llama-server ./bin/
        cp ./llama_src/build/bin/ggml-rpc-server ./bin/ 2>/dev/null || true
        cp ./llama_src/build/bin/*.dylib ./bin/ 2>/dev/null || true
        rm -rf llama_src
        
        echo "Compilation complete!"
    else
        if [ "$OS" = "Linux" ]; then
            if command -v nvidia-smi &> /dev/null; then
                ASSET_PATTERN="bin-ubuntu-vulkan-x64\.tar\.gz"
            else
                ASSET_PATTERN="bin-ubuntu-x64\.tar\.gz"
            fi
            
            if [ "$ARCH" = "aarch64" ]; then
                ASSET_PATTERN="bin-ubuntu-arm64\.tar\.gz"
            fi
        else
            echo "Unsupported OS: $OS"
            exit 1
        fi
        
        DOWNLOAD_URL=$(curl -s https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | grep "browser_download_url" | grep -E "$ASSET_PATTERN" | head -n 1 | cut -d '"' -f 4)
        
        if [ -z "$DOWNLOAD_URL" ] && [ "$OS" = "Linux" ]; then
            echo "Falling back to CPU binary..."
            DOWNLOAD_URL=$(curl -s https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | grep "browser_download_url" | grep -E "bin-ubuntu-x64\.tar\.gz" | head -n 1 | cut -d '"' -f 4)
        fi

        if [ -z "$DOWNLOAD_URL" ]; then
            echo "Failed to find a matching release asset."
            exit 1
        fi
        
        echo "Downloading from $DOWNLOAD_URL..."
        curl -L "$DOWNLOAD_URL" -o llama_archive
        
        echo "Extracting..."
        if [[ "$DOWNLOAD_URL" == *".tar.gz" ]]; then
            tar -xzf llama_archive -C ./bin --strip-components=1
        else
            unzip -o llama_archive -d ./bin
            # Unzip doesn't have strip-components, so move files up if nested
            for dir in ./bin/llama-*/; do
                if [ -d "$dir" ]; then
                    mv "$dir"* ./bin/ 2>/dev/null || true
                    rm -rf "$dir" 2>/dev/null || true
                fi
            done
        fi
        rm llama_archive
        
        chmod +x ./bin/llama-server
        chmod +x ./bin/ggml-rpc-server 2>/dev/null || true
        echo "Download complete!"
    fi
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
