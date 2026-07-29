$LlamaServer = "G:\LocalLLM\bin\llama-server.exe"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "         Universal AI Engine (RTX 5060 + 3050 + Mac RPC)          " -ForegroundColor White
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  1) Qwen 3.6 35B (MoE - Requires RPC)"
Write-Host "  2) GPT-OSS 20B (MoE - Fast on RPC)"
Write-Host "  3) Gemma 12B (Dense - Fast on Local)"
Write-Host "  4) Dolphin Mixtral 8x7B (MoE - RPC Routed)"
Write-Host "  5) Magnum 12B v4 (Dense - Local Routed)"
Write-Host "  Q) Quit"
Write-Host "==================================================================" -ForegroundColor Cyan
$modelChoice = Read-Host "Enter your choice (1-5 or Q)"

if ($modelChoice -eq 'Q' -or $modelChoice -eq 'q') { exit }

if ($modelChoice -eq '1') {
    $ModelPath = "G:\LocalLLM\models\Qwen3.6-35B-A3B-Q4_K_M.gguf"
    $ModelName = "Qwen 3.6 35B"
    $ModelAlias = "Qwen-3.6-35B"
    $ModelSize = "large"  # Needs multi-GPU + RPC
} elseif ($modelChoice -eq '2') {
    $ModelPath = "G:\LocalLLM\models\gpt-oss-20b-Q4_K_M.gguf"
    $ModelName = "GPT-OSS 20B"
    $ModelAlias = "GPT-OSS-20B"
    $ModelSize = "medium" # Fits on RTX 5060+3050 locally
} elseif ($modelChoice -eq '3') {
    $ModelPath = "G:\LocalLLM\models\gemma-4-12B-it-Q4_K_M.gguf"
    $ModelName = "Gemma 12B"
    $ModelAlias = "Gemma-12B"
    $ModelSize = "small"  # Fits entirely on RTX 5060
} elseif ($modelChoice -eq '4') {
    $ModelPath = "G:\LocalLLM\models\dolphin-2.7-mixtral-8x7b.Q4_K_M.gguf"
    $ModelName = "Dolphin Mixtral 8x7B"
    $ModelAlias = "Dolphin-Mixtral"
    $ModelSize = "large"  # MoE, routes via RPC
} elseif ($modelChoice -eq '5') {
    $ModelPath = "G:\LocalLLM\models\magnum-v4-12b-Q4_K_M.gguf"
    $ModelName = "Magnum 12B v4"
    $ModelAlias = "Magnum-12B-v4"
    $ModelSize = "small"  # Dense, routes locally
} else {
    Write-Host "Invalid choice." -ForegroundColor Red
    exit
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "Select Context Size:"
Write-Host "  1) 8k Context (Safe Chat Mode - Recommended)"
Write-Host "  2) 64k Context (Standard Fast Mode)"
Write-Host "  3) 128k Context (Extended Mode)"
Write-Host "==================================================================" -ForegroundColor Cyan
$ctxChoice = Read-Host "Enter your choice (1-3)"

$Ctx = 0
$UB = 0
$Ngl = 0
$KV = "q8_0"

if ($modelChoice -eq '1') {
    # Qwen 35B MoE - needs all devices
    if ($ctxChoice -eq '1') {
        $Ctx = 8192; $UB = 512; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 65536; $UB = 128; $Ngl = 30; $KV = "q8_0"
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 131072; $UB = 128; $Ngl = 25; $KV = "q4_0"
    }
} elseif ($modelChoice -eq '2') {
    # GPT-OSS 20B - fits on local GPUs only
    if ($ctxChoice -eq '1') {
        $Ctx = 8192; $UB = 512; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 65536; $UB = 512; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 131072; $UB = 128; $Ngl = 45; $KV = "q4_0"
    }
} elseif ($modelChoice -eq '3' -or $modelChoice -eq '5') {
    # Dense 12B models (Gemma / Magnum) - fit entirely on local GPUs
    if ($ctxChoice -eq '1') {
        $Ctx = 8192; $UB = 512; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 65536; $UB = 512; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 131072; $UB = 128; $Ngl = 99; $KV = "q4_0"
    }
} elseif ($modelChoice -eq '4') {
    # Dolphin Mixtral 8x7B MoE
    if ($ctxChoice -eq '1') {
        $Ctx = 8192; $UB = 512; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '2') {
        $Ctx = 65536; $UB = 256; $Ngl = 99; $KV = "q8_0"
    } elseif ($ctxChoice -eq '3') {
        $Ctx = 131072; $UB = 128; $Ngl = 60; $KV = "q4_0"
    }
}

# Build argument list based on model size
$Args = @(
    "-m", $ModelPath,
    "--alias", $ModelAlias,
    "-c", $Ctx,
    "-fa", "on",
    "-sm", "layer",
    "-t", "4",
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

# Smart Routing based on Model Architecture
if ($modelChoice -in @('1', '2', '4')) {
    # MoE models perform exceptionally well over RPC
    $Args += @("--rpc", "10.0.2.3:50052")
    Write-Host "`n[Launching $ModelName with RPC on http://0.0.0.0:12057/]" -ForegroundColor Green
    Write-Host "[Using: RTX 5060 + RTX 3050 + Mac M1 Metal (RPC)]" -ForegroundColor Green
} else {
    # Dense models bottleneck on RPC, run purely on local RTX GPUs
    # -ts 2,1 prioritizes RTX 5060 over 3050
    $Args += @("-ts", "2,1")
    Write-Host "`n[Launching $ModelName LOCAL ONLY on http://0.0.0.0:12057/]" -ForegroundColor Green
    Write-Host "[Using: RTX 5060 + RTX 3050 Local GPUs]" -ForegroundColor Green
}

Start-Process -FilePath $LlamaServer -ArgumentList $Args -NoNewWindow -Wait
