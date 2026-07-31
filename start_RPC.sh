#!/bin/bash
PORT=50052
HOST="0.0.0.0"

echo "======================================="
echo "   Onyx RPC Worker Node (Mac/Linux)    "
echo "======================================="

if [ ! -f "./bin/ggml-rpc-server" ]; then
    echo "[!] ggml-rpc-server not found in bin/"
    echo "Downloading pre-compiled llama.cpp binaries from GitHub..."
    mkdir -p bin
    
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    
    if [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            ASSET_PATTERN="bin-macos-arm64\.tar\.gz"
        else
            ASSET_PATTERN="bin-macos-x64\.tar\.gz"
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v nvidia-smi &> /dev/null; then
            ASSET_PATTERN="bin-ubuntu-vulkan-x64\.tar\.gz" # Linux doesn't have official CUDA binaries anymore, use Vulkan
        else
            ASSET_PATTERN="bin-ubuntu-x64\.tar\.gz"
        fi
        
        # Check for ARM64 Linux
        if [ "$ARCH" = "aarch64" ]; then
            ASSET_PATTERN="bin-ubuntu-arm64\.tar\.gz"
        fi
    else
        echo "Unsupported OS: $OS"
        exit 1
    fi
    
    # Simple curl check for release.
    DOWNLOAD_URL=$(curl -s https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | grep "browser_download_url" | grep -E "$ASSET_PATTERN" | head -n 1 | cut -d '"' -f 4)
    
    # If Vulkan failed, fallback to CPU
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
        for dir in ./bin/llama-*/; do
            if [ -d "$dir" ]; then
                mv "$dir"* ./bin/ 2>/dev/null || true
                rm -rf "$dir" 2>/dev/null || true
            fi
        done
    fi
    rm llama_archive
    
    chmod +x ./bin/ggml-rpc-server
    chmod +x ./bin/llama-server 2>/dev/null || true
    echo "Download complete!"
fi

# Set dynamic library paths (Linux)
export LD_LIBRARY_PATH="$(pwd)/bin:$LD_LIBRARY_PATH"

# On macOS, System Integrity Protection (SIP) strips DYLD_LIBRARY_PATH.
# We permanently rewrite the binary's rpath to look in its own directory instead.
if [ "$(uname)" == "Darwin" ]; then
    install_name_tool -add_rpath @executable_path ./bin/ggml-rpc-server >/dev/null 2>&1 || true
fi

echo "Starting RPC Server on $HOST:$PORT..."
echo "To connect to this worker from your main Onyx instance:"
echo "1. Open the Onyx Dashboard on your main PC"
echo "2. Go to 'RPC & Devices' tab"
echo "3. Add a new RPC Server using this machine's local IP address and port $PORT"
echo ""

./bin/ggml-rpc-server -H $HOST -p $PORT
