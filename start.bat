@echo off
cd /d "%~dp0"
echo Starting Panther Dashboard...

:: Try to use Windows Terminal (wt.exe) to open both processes in multiple tabs
wt -d .\backend cmd /k "title Rust Backend && cargo run" ; new-tab -d .\frontend cmd /k "title Vite Frontend && npm run dev"

:: If Windows Terminal is not installed, it will fallback to opening separate standard command prompt windows
if %errorlevel% neq 0 (
    echo Windows Terminal not found, falling back to separate windows...
    start "Panther Backend" cmd /k "cd backend && cargo run"
    start "Panther Frontend" cmd /k "cd frontend && npm run dev"
)
