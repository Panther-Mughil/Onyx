#!/bin/bash

echo "======================================="
echo "      Onyx llama.cpp Auto-Builder      "
echo "======================================="
echo "This script will download and compile llama.cpp from source."
echo "On macOS, Metal GPU acceleration is enabled by default."

echo "[1/4] Cloning latest llama.cpp repository..."
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp

echo "[2/4] Compiling with RPC support..."
# GGML_RPC=1 enables the RPC server build for distributed inference
make -j GGML_RPC=1

echo "[3/4] Extracting binaries..."
mkdir -p ../bin
# Move the newly compiled binaries to the Onyx bin folder
cp llama-server ../bin/ 2>/dev/null
cp llama-bench ../bin/ 2>/dev/null
cp llama-rpc-server ../bin/ 2>/dev/null

# Also grab any library files that might have been built (like metal/ggml libs)
cp *.dylib ../bin/ 2>/dev/null
cp *.so ../bin/ 2>/dev/null

cd ..

echo "[4/4] Cleaning up source files..."
rm -rf llama.cpp

echo "======================================="
echo "SUCCESS! Binaries are now located in the bin/ directory."
echo "You can now run start_RPC.sh to launch this machine as a worker."
echo "======================================="
