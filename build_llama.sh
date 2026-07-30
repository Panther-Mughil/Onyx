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
# llama.cpp now uses CMake exclusively.
cmake -B build -DGGML_RPC=ON -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON -DCMAKE_INSTALL_RPATH="\$ORIGIN;@executable_path"
cmake --build build --config Release -j

echo "[3/4] Extracting binaries..."
mkdir -p ../bin
# Move the newly compiled binaries to the Onyx bin folder
# Depending on the generator, binaries could be in build/bin or build/bin/Release
cp build/bin/Release/llama-server ../bin/ 2>/dev/null || cp build/bin/llama-server ../bin/ 2>/dev/null
cp build/bin/Release/llama-bench ../bin/ 2>/dev/null || cp build/bin/llama-bench ../bin/ 2>/dev/null
cp build/bin/Release/ggml-rpc-server ../bin/ 2>/dev/null || cp build/bin/ggml-rpc-server ../bin/ 2>/dev/null

# Grab any shared libraries (like ggml.so or metal.dylib)
cp build/bin/Release/*.dylib ../bin/ 2>/dev/null || cp build/bin/*.dylib ../bin/ 2>/dev/null
cp build/bin/Release/*.so ../bin/ 2>/dev/null || cp build/bin/*.so ../bin/ 2>/dev/null

cd ..

echo "[4/4] Cleaning up source files..."
rm -rf llama.cpp

echo "======================================="
echo "SUCCESS! Binaries are now located in the bin/ directory."
echo "You can now run start_RPC.sh to launch this machine as a worker."
echo "======================================="
