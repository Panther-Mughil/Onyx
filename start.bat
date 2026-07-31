@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo =======================================
echo           Starting Onyx
echo =======================================
echo.

:: 1. Check for pre-compiled llama.cpp
if exist "bin\llama-server.exe" goto skip_download

echo [!] llama-server.exe not found in bin\
echo Downloading pre-compiled llama.cpp binaries from GitHub...
if not exist "bin" mkdir bin
powershell -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $hasCuda = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue); Write-Host 'Fetching latest release info...'; $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'; $asset = $null; $cudart = $null; if ($hasCuda) { Write-Host 'NVIDIA GPU detected. Looking for CUDA 13 binary...'; $asset = $release.assets | Where-Object { $_.name -match '^llama-.*-bin-win-cuda-13.*x64\.zip$' } | Select-Object -First 1; $cudart = $release.assets | Where-Object { $_.name -match '^cudart-llama-bin-win-cuda-13.*x64\.zip$' } | Select-Object -First 1 }; if (-not $asset) { Write-Host 'Defaulting to Vulkan binary...'; $asset = $release.assets | Where-Object { $_.name -match '^llama-.*-bin-win-vulkan-x64\.zip$' } | Select-Object -First 1 }; if (-not $asset) { Write-Host 'Falling back to CPU binary...'; $asset = $release.assets | Where-Object { $_.name -match '^llama-.*-bin-win-cpu-x64\.zip$' } | Select-Object -First 1 }; Write-Host \"Downloading $($asset.name)...\"; Invoke-WebRequest -Uri $asset.browser_download_url -OutFile 'llama.zip'; Write-Host 'Extracting...'; Expand-Archive -Path 'llama.zip' -DestinationPath '.\bin' -Force; Remove-Item 'llama.zip'; Get-ChildItem -Path '.\bin\llama-*' -Directory | ForEach-Object { Move-Item -Path \"$($_.FullName)\*\" -Destination '.\bin' -Force; Remove-Item -Path $_.FullName -Recurse -Force }; if ($cudart) { Write-Host \"Downloading CUDA DLLs $($cudart.name)...\"; Invoke-WebRequest -Uri $cudart.browser_download_url -OutFile 'cudart.zip'; Expand-Archive -Path 'cudart.zip' -DestinationPath '.\bin' -Force; Remove-Item 'cudart.zip'; Get-ChildItem -Path '.\bin\cudart-*' -Directory | ForEach-Object { Move-Item -Path \"$($_.FullName)\*\" -Destination '.\bin' -Force; Remove-Item -Path $_.FullName -Recurse -Force }; }; Write-Host 'Download complete!'"
if %errorlevel% neq 0 (
    echo Failed to download llama.cpp. Please check your internet connection.
    pause
    exit /b
)

:skip_download

:: 2. Start the embedded application
echo.
echo Starting Onyx Server...
echo Please open your browser and navigate to http://127.0.0.1:3001
echo.

if exist "onyx.exe" (
    onyx.exe
) else if exist "backend\target\release\onyx.exe" (
    backend\target\release\onyx.exe
) else (
    echo [!] onyx.exe not found! Please build the project or download a release.
    pause
    exit /b
)
