#!/bin/bash
PORT=50052
HOST="0.0.0.0"

echo "======================================="
echo "   Onyx RPC Worker Node (Mac/Linux)    "
echo "======================================="

if [ ! -f "./bin/ggml-rpc-server" ]; then
    echo "Error: ./bin/ggml-rpc-server not found!"
    echo "Please run ./build_llama.sh first to compile the binaries."
    exit 1
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
