@echo off
REM compile.bat — Onyx packaging script (Windows)
REM Produces versioned release artifacts in release/
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%"
set "RELEASE_DIR=%PROJECT_ROOT%release"

REM ── Version ──────────────────────────────────────────────────────────────
for /f "delims=" %%i in ('git describe --tags --always 2^>nul') do set "VERSION=%%i"
if "!VERSION!"=="" set "VERSION=%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "VERSION=!VERSION: =0!"
echo Onyx build version: !VERSION!

REM ── Download Portable Node ───────────────────────────────────────────────
set "NODE_VERSION=v20.11.1"
set "NODE_ZIP=node-!NODE_VERSION!-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/!NODE_VERSION!/!NODE_ZIP!"
set "PORTABLE_NODE_DIR=%PROJECT_ROOT%scripts\portable-node"
set "PORTABLE_NODE_EXE=!PORTABLE_NODE_DIR!\node.exe"

if not exist "!PORTABLE_NODE_EXE!" (
    echo.
    echo Downloading Node.js !NODE_VERSION! ^(win-x64^)...
    if not exist "!PORTABLE_NODE_DIR!" mkdir "!PORTABLE_NODE_DIR!"
    powershell -Command "Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '%TEMP%\!NODE_ZIP!'"
    powershell -Command "Expand-Archive -Path '%TEMP%\!NODE_ZIP!' -DestinationPath '%TEMP%\node_extracted' -Force"
    copy /y "%TEMP%\node_extracted\node-!NODE_VERSION!-win-x64\node.exe" "!PORTABLE_NODE_EXE!" >nul
    rmdir /s /q "%TEMP%\node_extracted"
    del /q "%TEMP%\!NODE_ZIP!"
)

REM ── Build Frontend ───────────────────────────────────────────────────────
echo.
echo =================================================
echo   Building Frontend
echo =================================================
cd /d "%PROJECT_ROOT%frontend"
call npm ci || call npm install
call npm run build
echo Frontend built.

REM ── Build Backend ────────────────────────────────────────────────────────
echo.
echo =================================================
echo   Building Backend
echo =================================================
cd /d "%PROJECT_ROOT%backend"
cargo build --release
echo Backend built.

REM ── Build RPC Agent ──────────────────────────────────────────────────────
echo.
echo =================================================
echo   Building RPC Agent
echo =================================================
cd /d "%PROJECT_ROOT%rpc_agent"
cargo build --release
echo RPC Agent built.

REM ── Stage Artifacts ──────────────────────────────────────────────────────
echo.
echo =================================================
echo   Packaging for Windows x64
echo =================================================

set "stage_dir=%RELEASE_DIR%\onyx-%VERSION%-win-x64"
if not exist "%stage_dir%" mkdir "%stage_dir%"

copy /y "%PROJECT_ROOT%backend\target\release\onyx.exe" "%stage_dir%\" >nul
copy /y "%PROJECT_ROOT%rpc_agent\target\release\rpc_agent.exe" "%stage_dir%\" >nul
xcopy /e /i "%PROJECT_ROOT%scripts" "%stage_dir%\scripts" >nul
mkdir "%stage_dir%\data" >nul 2>&1
mkdir "%stage_dir%\models" >nul 2>&1
mkdir "%stage_dir%\engines" >nul 2>&1

REM Bundle node
if exist "%PROJECT_ROOT%scripts\portable-node\node.exe" (
    copy /y "%PROJECT_ROOT%scripts\portable-node\node.exe" "%stage_dir%\node.exe" >nul
    echo   Bundled node from scripts\portable-node\
) else (
    echo   No bundled node found — backend will use PATH node
)

REM Create zip with PowerShell
set "zip_name=onyx-%VERSION%-win-x64.zip"
set "zip_path=%RELEASE_DIR%\%zip_name%"

powershell -Command "Compress-Archive -Path '%stage_dir%\*' -DestinationPath '%zip_path%' -Force" 2>nul
if !errorlevel! equ 0 (
    echo   Created !zip_name!
) else (
    echo   Warning: PowerShell Compress-Archive failed
    echo   Install from: Get-Module -ListAvailable Archive
)

echo.
echo =================================================
echo   SUMMARY
echo =================================================
for %%f in ("%RELEASE_DIR%\*") do (
    if exist "%%f" (
        for %%g in ("%%f") do echo   %%g (%%~zg bytes)
    )
)
echo.
echo   Note: Upload is manual (per plan REQ-002 §8).
echo =================================================

endlocal
