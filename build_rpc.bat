@echo off
setlocal enabledelayedexpansion

:: build_rpc.bat — Standalone build script for Onyx RPC Agent on Windows
:: This script compiles the RPC Agent and creates a lightweight release artifact.

echo ===================================================
echo   Building Onyx RPC Agent (Windows)
echo ===================================================

cd /d "%~dp0"
set PROJECT_ROOT=%CD%
set RELEASE_DIR=%PROJECT_ROOT%\release\rpc

:: Get Version
for /f %%i in ('git describe --tags --always 2^>nul') do set VERSION=%%i
if "%VERSION%"=="" (
    for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
    for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
    set VERSION=!mydate!-!mytime: =0!
)
echo RPC Agent build version: %VERSION%

:: Build RPC Agent
echo.
echo ===================================================
echo   Compiling RPC Agent
echo ===================================================
cd rpc_agent
call cargo build --release
if %ERRORLEVEL% NEQ 0 (
    echo RPC Agent build failed.
    exit /b %ERRORLEVEL%
)
echo RPC Agent built.

:: Stage Artifacts
echo.
echo ===================================================
echo   Packaging RPC Agent for Windows x64
echo ===================================================

if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
set STAGE_DIR=%RELEASE_DIR%\onyx-rpc-%VERSION%-win-x64
if not exist "%STAGE_DIR%" mkdir "%STAGE_DIR%"

copy "%PROJECT_ROOT%\rpc_agent\target\release\rpc_agent.exe" "%STAGE_DIR%\" >nul

:: Zip the folder
set ZIP_NAME=onyx-rpc-%VERSION%-win-x64.zip
if exist "%RELEASE_DIR%\%ZIP_NAME%" del "%RELEASE_DIR%\%ZIP_NAME%"
powershell -Command "Compress-Archive -Path '%STAGE_DIR%' -DestinationPath '%RELEASE_DIR%\%ZIP_NAME%' -Force"

:: Cleanup stage dir
rmdir /s /q "%STAGE_DIR%"

echo.
echo   Artifacts saved in release\rpc\
echo ===================================================
