@echo off
setlocal

echo =======================================
echo       Onyx llama.cpp Auto-Builder      
echo =======================================
echo This script requires Git and CMake to be installed.
echo.

set /p USE_CUDA="Do you want to compile with NVIDIA CUDA support? (Y/N): "

echo.
echo [1/4] Cloning latest llama.cpp repository...
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp

set CMAKE_ARGS=-DGGML_RPC=ON -DGGML_BLAS=OFF
if /I "%USE_CUDA%"=="Y" set CMAKE_ARGS=%CMAKE_ARGS% -DGGML_CUDA=ON

echo.
echo [2/4] Configuring CMake...
cmake -B build %CMAKE_ARGS%
if %errorlevel% neq 0 (
    echo CMake configuration failed!
    pause
    exit /b %errorlevel%
)

echo.
echo [3/4] Compiling...
cmake --build build --config Release -j
if %errorlevel% neq 0 (
    echo Compilation failed!
    pause
    exit /b %errorlevel%
)

echo.
echo [4/4] Extracting binaries...
if not exist ..\bin mkdir ..\bin

:: Binaries could be in build\bin\Release or build\bin depending on the generator used
copy build\bin\Release\llama-server.exe ..\bin\ >nul 2>&1
copy build\bin\Release\llama-bench.exe ..\bin\ >nul 2>&1
copy build\bin\Release\ggml-rpc-server.exe ..\bin\ >nul 2>&1
copy build\bin\llama-server.exe ..\bin\ >nul 2>&1
copy build\bin\llama-bench.exe ..\bin\ >nul 2>&1
copy build\bin\ggml-rpc-server.exe ..\bin\ >nul 2>&1

:: Copy any required DLLs
copy build\bin\Release\*.dll ..\bin\ >nul 2>&1
copy build\bin\*.dll ..\bin\ >nul 2>&1

cd ..
echo Cleaning up source files...
rmdir /s /q llama.cpp

echo.
echo =======================================
echo SUCCESS! Binaries are now located in the bin\ directory.
echo You can now run start_RPC.bat to launch this machine as a worker.
echo =======================================
endlocal
pause
