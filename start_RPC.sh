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
        echo "[!] Pre-compiled macOS binaries contain a known BLAS bug for RPC."
        echo "[!] Compiling ggml-rpc-server from source (this takes a moment)..."
        
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
        
        cp ./llama_src/build/bin/ggml-rpc-server ./bin/
        cp ./llama_src/build/bin/llama-server ./bin/ 2>/dev/null || true
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
fi

# Set dynamic library paths (Linux)
export LD_LIBRARY_PATH="$(pwd)/bin:$LD_LIBRARY_PATH"

# On macOS, System Integrity Protection (SIP) strips DYLD_LIBRARY_PATH.
# We permanently rewrite the binary's rpath to look in its own directory instead.
if [ "$(uname)" == "Darwin" ]; then
    install_name_tool -add_rpath @executable_path ./bin/ggml-rpc-server >/dev/null 2>&1 || true
fi

echo "To connect to this worker from your main Onyx instance:"
echo "1. Open the Onyx Dashboard on your main PC"
echo "2. Go to 'RPC & Devices' tab"
echo "3. Add a new RPC Server using this machine's local IP address and port $PORT"
echo ""

if command -v cargo >/dev/null 2>&1; then
    echo "[i] Rust detected. Starting RPC Server and Telemetry Agent on $HOST:$PORT..."
    cargo run --release --manifest-path rpc_agent/Cargo.toml -- $HOST:$PORT $HOST:50053
else
    echo "[!] Rust/Cargo is not installed on this machine."
    echo "[!] Telemetry agent will not run, but the RPC worker will still function perfectly."
    echo "[!] Starting barebones RPC Server on $HOST:$PORT..."
    ./bin/ggml-rpc-server -H $HOST -p $PORT
fi
