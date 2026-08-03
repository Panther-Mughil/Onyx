@echo off
setlocal EnableDelayedExpansion
title Onyx Terminal

:MENU
cls
echo =================================================
echo                 ONYX TERMINAL
echo =================================================
echo [1] Start Primary Node (Dashboard ^& API Server)
echo [2] Start RPC Worker Node (Compute Only)
echo [3] Start Development Environment (Hot-Reloading)
echo [4] Verify ^& Install System Dependencies
echo [0] Exit
echo =================================================
set /p choice="Select an option (0-4): "

if "%choice%"=="1" goto START_PRIMARY
if "%choice%"=="2" goto START_RPC
if "%choice%"=="3" goto START_DEV
if "%choice%"=="4" goto INSTALL_DEPS
if "%choice%"=="0" exit /b
goto MENU

:START_PRIMARY
echo Starting Primary Node...
echo If this is your first time, please run option [4] first.
cd backend
cargo run --release
pause
goto MENU

:START_RPC
echo Starting RPC Worker Node...
cd rpc_agent
cargo run --release
pause
goto MENU

:START_DEV
echo Starting Development Environment...
cd frontend
start cmd /k "npm run dev"
cd ../backend
start cmd /k "cargo run"
cd ..
pause
goto MENU

:INSTALL_DEPS
echo =================================================
echo        VERIFYING ^& INSTALLING DEPENDENCIES
echo =================================================

echo [1/4] Checking for Rust/Cargo...
cargo --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Rust not found. Attempting to install via winget...
    winget install -e --id Rustlang.Rustup
    echo Please restart this terminal after installation completes.
    pause
    exit /b
) else (
    echo [OK] Rust is installed.
)

echo [2/4] Checking for Node.js/npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Attempting to install via winget...
    winget install -e --id OpenJS.NodeJS
    echo Please restart this terminal after installation completes.
    pause
    exit /b
) else (
    echo [OK] Node.js is installed.
)

echo [3/4] Checking for CMake...
cmake --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] CMake not found. Attempting to install via winget...
    winget install -e --id Kitware.CMake
    echo Please restart this terminal after installation completes.
    pause
    exit /b
) else (
    echo [OK] CMake is installed.
)

echo [4/4] Compiling and Baking application...
echo Installing Frontend Dependencies...
cd frontend
call npm install
echo Building Frontend Static Files...
call npm run build
cd ..

echo Building Backend Server (This may take a while)...
cd backend
call cargo build --release
cd ..

echo Building RPC Agent...
cd rpc_agent
call cargo build --release
cd ..

echo =================================================
echo All dependencies installed and compiled successfully!
echo You can now use option [1] or [2] to start Onyx.
echo =================================================
pause
goto MENU
