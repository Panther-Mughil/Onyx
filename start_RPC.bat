@echo off
setlocal

set PORT=50052
set HOST=0.0.0.0

echo =======================================
echo    Onyx RPC Worker Node (Windows)
echo =======================================

if not exist "bin\ggml-rpc-server.exe" (
    echo [!] ggml-rpc-server.exe not found in bin\
    echo Downloading pre-compiled llama.cpp binaries from GitHub...
    if not exist "bin" mkdir bin
    powershell -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $hasCuda = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue); Write-Host 'Fetching latest release info...'; $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'; $asset = $null; $cudart = $null; if ($hasCuda) { Write-Host 'NVIDIA GPU detected. Looking for CUDA 13 binary...'; $asset = $release.assets | Where-Object { $_.name -match 'bin-win-cuda-13.*x64\.zip$' } | Select-Object -First 1; $cudart = $release.assets | Where-Object { $_.name -match 'cudart-llama-bin-win-cuda-13.*x64\.zip$' } | Select-Object -First 1 }; if (-not $asset) { Write-Host 'Defaulting to Vulkan binary...'; $asset = $release.assets | Where-Object { $_.name -match 'bin-win-vulkan-x64\.zip$' } | Select-Object -First 1 }; if (-not $asset) { Write-Host 'Falling back to CPU binary...'; $asset = $release.assets | Where-Object { $_.name -match 'bin-win-cpu-x64\.zip$' } | Select-Object -First 1 }; Write-Host \"Downloading $($asset.name)...\"; Invoke-WebRequest -Uri $asset.browser_download_url -OutFile 'llama.zip'; Write-Host 'Extracting...'; Expand-Archive -Path 'llama.zip' -DestinationPath '.\bin' -Force; Remove-Item 'llama.zip'; Get-ChildItem -Path '.\bin\llama-*' -Directory | ForEach-Object { Move-Item -Path \"$($_.FullName)\*\" -Destination '.\bin' -Force; Remove-Item -Path $_.FullName -Recurse -Force }; if ($cudart) { Write-Host \"Downloading CUDA DLLs $($cudart.name)...\"; Invoke-WebRequest -Uri $cudart.browser_download_url -OutFile 'cudart.zip'; Expand-Archive -Path 'cudart.zip' -DestinationPath '.\bin' -Force; Remove-Item 'cudart.zip'; Get-ChildItem -Path '.\bin\cudart-*' -Directory | ForEach-Object { Move-Item -Path \"$($_.FullName)\*\" -Destination '.\bin' -Force; Remove-Item -Path $_.FullName -Recurse -Force }; }; Remove-Item '.\bin\*blas*.dll' -ErrorAction SilentlyContinue; Write-Host 'Download complete!'"
    if %errorlevel% neq 0 (
        echo Failed to download llama.cpp. Please check your internet connection.
        pause
        exit /b 1
    )
)

echo Starting RPC Server on %HOST%:%PORT%...
echo To connect to this worker from your main Onyx instance:
echo 1. Open the Onyx Dashboard on your main PC
echo 2. Go to 'RPC ^& Devices' tab
echo 3. Add a new RPC Server using this machine's local IP address and port %PORT%
echo.

bin\ggml-rpc-server.exe -H %HOST% -p %PORT%

pause
endlocal
