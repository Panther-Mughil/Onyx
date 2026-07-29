$LlamaServer = "G:\LocalLLM\bin\llama-server.exe"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "                Universal AI Engine (RTX 5060 + 3050)             " -ForegroundColor White
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "Select Model:"
Write-Host "  1) Qwen 3.6 35B"
Write-Host "  2) GPT-OSS 20B"
Write-Host "  3) Roleplay 8B (Dolphin 3.0 Llama 3.1)"
Write-Host "  Q) Quit"
Write-Host "==================================================================" -ForegroundColor Cyan
$modelChoice = Read-Host "Enter your choice (1-3 or Q)"

if ($modelChoice -eq 'Q' -or $modelChoice -eq 'q') { exit }

if ($modelChoice -eq '1') {
    $ModelPath = "G:\LocalLLM\models\Qwen3.6-35B-A3B-Q4_K_M.gguf"
    $ModelName = "Qwen 3.6 35B"
    $ModelAlias = "Qwen-3.6-35B"
} elseif ($modelChoice -eq '2') {
    $ModelPath = "G:\LocalLLM\models\gpt-oss-20b-Q4_K_M.gguf"
    $ModelName = "GPT-OSS 20B"
    $ModelAlias = "GPT-OSS-20B"
} elseif ($modelChoice -eq '3') {
    $ModelPath = "G:\LocalLLM\models\Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf"
    $ModelName = "Roleplay 8B (Dolphin 3.0)"
    $ModelAlias = "Dolphin-3.0-Llama-3.1-8B"
} else {
    Write-Host "Invalid choice." -ForegroundColor Red
    exit
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "Select Context Size:"
Write-Host "  1) 64k Context (Standard Fast Mode)"
Write-Host "  2) 128k Context (Extended Mode)"
Write-Host "  3) 256k Context (Maximum Memory Mode)"
Write-Host "==================================================================" -ForegroundColor Cyan
$ctxChoice = Read-Host "Enter your choice (1-3)"

$Ctx = 0
$UB = 0
$Ngl = 0
$KV = "q8_0"

if ($modelChoice -eq '1') {
    # Qwen 35B Optimization (Needs CPU offloading)
    if ($ctxChoice -eq '1') {
        $Ctx = 65536; $UB = 2048; $Ngl = 25; $KV = "q8_0"
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 131072; $UB = 512; $Ngl = 20; $KV = "q4_0"
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 262144; $UB = 128; $Ngl = 15; $KV = "q4_0"
    }
} elseif ($modelChoice -eq '2') {
    # GPT-OSS 20B Optimization (11GB Model)
    if ($ctxChoice -eq '1') {
        $Ctx = 65536; $UB = 2048; $Ngl = 999; $KV = "q8_0" # Fits 100% in VRAM
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 131072; $UB = 512; $Ngl = 40; $KV = "q4_0" # KV Cache pushes total past 16GB, split required
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 262144; $UB = 128; $Ngl = 30; $KV = "q4_0" # Massive KV Cache, heavy CPU offload required
    }
} elseif ($modelChoice -eq '3') {
    # Roleplay 8B Optimization (4.9GB Model)
    if ($ctxChoice -eq '1') {
        $Ctx = 65536; $UB = 2048; $Ngl = 999; $KV = "q8_0" # Fits 100% in VRAM
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 131072; $UB = 512; $Ngl = 999; $KV = "q4_0" # 4.9GB Model + 8.3GB KV = 13.2GB (Fits perfectly in 16GB VRAM)
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 262144; $UB = 128; $Ngl = 22; $KV = "q4_0" # 16.7GB KV Cache alone! Must offload ~10 layers to CPU to avoid OOM
    }
}

Write-Host "`n[Launching $ModelName on http://0.0.0.0:12057/ (Available on LAN)]" -ForegroundColor Green

$Args = @(
    "-m", $ModelPath,
    "--alias", $ModelAlias,
    "-c", $Ctx,
    "-fa", "on",
    "-ts", "1,1",
    "-sm", "layer",
    "-t", "6",
    "-b", "2048",
    "-ub", $UB,
    "-ctk", $KV,
    "-ctv", $KV,
    "-ngl", $Ngl,
    "-np", "1",
    "--host", "0.0.0.0",
    "--port", "12057",
    "--cors-origins", "*"
)

Start-Process -FilePath $LlamaServer -ArgumentList $Args -NoNewWindow -Wait
