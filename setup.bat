@echo off
echo Setting up Onyx environment...
echo.

echo Checking Node.js installation...
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js/npm is not installed. Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

echo Checking Rust installation...
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Rust/Cargo is not installed. Please install Rust from https://rustup.rs/
    pause
    exit /b
)

echo.
echo Installing Frontend Dependencies...
cd frontend
call npm install
cd ..

echo.
echo Setup Complete! You can now run start.bat to launch Onyx.
pause
