@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo =======================================
echo           Starting Onyx
echo =======================================
echo.

:: 1. Check for Node.js
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Installing via winget...
    winget install -e --id OpenJS.NodeJS
    echo.
    echo ==============================================================
    echo Node.js has been installed. You MUST restart your terminal
    echo and re-run start.bat for the changes to take effect.
    echo ==============================================================
    pause
    exit /b
)

:: 2. Check for Rust (cargo)
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Rust/Cargo not found. Installing via winget...
    winget install -e --id Rustlang.Rustup
    echo.
    echo ==============================================================
    echo Rust has been installed. You MUST restart your terminal
    echo and re-run start.bat for the changes to take effect.
    echo ==============================================================
    pause
    exit /b
)

:: 3. Check for pre-compiled llama.cpp
if not exist "bin\llama-server.exe" (
    echo [!] llama-server.exe not found in bin\
    echo Downloading pre-compiled llama.cpp binaries from GitHub...
    if not exist "bin" mkdir bin
    powershell -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $hasCuda = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue); Write-Host 'Fetching latest release info...'; $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggerganov/llama.cpp/releases/latest'; $asset = $null; if ($hasCuda) { Write-Host 'NVIDIA GPU detected. Looking for CUDA 12 binary...'; $asset = $release.assets | Where-Object { $_.name -match 'bin-win-cuda-cu12.*x64\.zip$' } | Select-Object -First 1 }; if (-not $asset) { Write-Host 'Defaulting to Vulkan binary...'; $asset = $release.assets | Where-Object { $_.name -match 'bin-win-vulkan-x64\.zip$' } | Select-Object -First 1 }; if (-not $asset) { Write-Host 'Falling back to CPU AVX2 binary...'; $asset = $release.assets | Where-Object { $_.name -match 'bin-win-avx2-x64\.zip$' } | Select-Object -First 1 }; Write-Host \"Downloading $($asset.name)...\"; Invoke-WebRequest -Uri $asset.browser_download_url -OutFile 'llama.zip'; Write-Host 'Extracting...'; Expand-Archive -Path 'llama.zip' -DestinationPath '.\bin' -Force; Remove-Item 'llama.zip'; Write-Host 'Download complete!'"
    if %errorlevel% neq 0 (
        echo Failed to download llama.cpp. Please check your internet connection.
        pause
        exit /b
    )
)

:: 4. Install frontend dependencies
echo.
echo Installing frontend dependencies (if any are missing)...
cd frontend
call npm install
cd ..

:: 5. Start the application
echo.
echo Starting backend and frontend...
wt -d .\backend cmd /k "title Rust Backend && cargo run" ; new-tab -d .\frontend cmd /k "title Vite Frontend && npm run dev"

if %errorlevel% neq 0 (
    echo Windows Terminal not found, falling back to separate windows...
    start "Onyx Backend" cmd /k "cd backend && cargo run"
    start "Onyx Frontend" cmd /k "cd frontend && npm run dev"
)
