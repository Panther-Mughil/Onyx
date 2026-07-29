# setup_env.ps1

Write-Host "=== LocalLLM Environment Setup ===" -ForegroundColor Cyan

# Check and Install Node.js
Write-Host "`nChecking for Node.js..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "Node.js is already installed: $(node -v)" -ForegroundColor Green
} else {
    Write-Host "Node.js not found. Installing via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS -e --source winget
    Write-Host "Node.js installation completed." -ForegroundColor Green
}

# Check and Install Rust
Write-Host "`nChecking for Rust (Cargo)..."
if (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host "Rust is already installed: $(cargo -V)" -ForegroundColor Green
} else {
    Write-Host "Rust not found. Downloading rustup-init..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri https://win.rustup.rs/ -OutFile rustup-init.exe
    Write-Host "Running rustup-init silently..."
    .\rustup-init.exe -y --quiet
    Remove-Item .\rustup-init.exe
    Write-Host "Rust installation completed." -ForegroundColor Green
    
    # Temporarily add cargo to current session path if it was just installed
    $env:Path += ";$env:USERPROFILE\.cargo\bin"
}

Write-Host "`n=== Setup Complete! ===" -ForegroundColor Cyan
Write-Host "If Rust or Node were just installed, you may need to restart your terminal or VS Code for the changes to fully take effect." -ForegroundColor Yellow
