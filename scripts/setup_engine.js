const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const LLAMA_DIR = path.join(__dirname, '..', 'llama-cpp');

function ensureDir() {
    if (!fs.existsSync(LLAMA_DIR)) {
        fs.mkdirSync(LLAMA_DIR, { recursive: true });
    }
}

function runCmd(cmd, opts = {}) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: 'inherit', ...opts });
}

async function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/ggerganov/llama.cpp/releases/latest',
            headers: { 'User-Agent': 'Node.js' }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) resolve(JSON.parse(data));
                else reject(new Error(`Failed to fetch release: ${res.statusCode}`));
            });
        }).on('error', reject);
    });
}

async function downloadFile(url, dest) {
    console.log(`Downloading ${url}...`);
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', reject);
    });
}

async function setupWindows() {
    console.log("Detected Windows Platform.");
    let hasNvidia = false;
    try {
        execSync('nvidia-smi', { stdio: 'ignore' });
        hasNvidia = true;
        console.log("NVIDIA GPU detected. Selecting CUDA release...");
    } catch (e) {
        console.log("No NVIDIA GPU detected (or nvidia-smi not in PATH). Selecting Vulkan release...");
    }

    const release = await fetchLatestRelease();
    let targetAsset = null;

    if (hasNvidia) {
        targetAsset = release.assets.find(a => a.name.includes('-bin-win-cuda-cu12') && a.name.endsWith('.zip') && !a.name.includes('rpc'));
        // fallback to cu11 if cu12 not found
        if (!targetAsset) targetAsset = release.assets.find(a => a.name.includes('-bin-win-cuda-cu11') && a.name.endsWith('.zip'));
    } else {
        targetAsset = release.assets.find(a => a.name.includes('-bin-win-vulkan-x64') && a.name.endsWith('.zip'));
    }

    if (!targetAsset) {
        console.error("Could not find a suitable release asset on GitHub.");
        process.exit(1);
    }

    console.log(`Selected asset: ${targetAsset.name}`);
    const zipPath = path.join(__dirname, '..', targetAsset.name);
    await downloadFile(targetAsset.browser_download_url, zipPath);

    console.log("Extracting archive...");
    runCmd(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${LLAMA_DIR}' -Force"`);

    console.log("Cleaning up...");
    fs.unlinkSync(zipPath);
}

async function setupMac() {
    console.log("Detected macOS Platform.");
    console.log("Compiling from source to avoid precompiled BLAS bugs on newer Macs...");
    
    const tempDir = path.join(__dirname, '..', 'llama_temp_src');
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    runCmd(`git clone https://github.com/ggerganov/llama.cpp.git "${tempDir}"`);
    
    const buildDir = path.join(tempDir, 'build');
    runCmd(`cd "${tempDir}" && cmake -B build -DGGML_METAL=ON -DGGML_RPC=ON -DBUILD_SHARED_LIBS=OFF`);
    runCmd(`cd "${tempDir}" && cmake --build build --config Release`);

    console.log("Moving compiled binaries to llama-cpp/...");
    const binaries = ['llama-server', 'llama-bench', 'ggml-rpc-server'];
    for (const bin of binaries) {
        let src = path.join(buildDir, 'bin', bin);
        if (!fs.existsSync(src)) src = path.join(buildDir, bin); // fallback if it built in root
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(LLAMA_DIR, bin));
            fs.chmodSync(path.join(LLAMA_DIR, bin), 0o755);
        } else {
            console.error(`Warning: Could not find compiled binary ${bin}`);
        }
    }

    // Copy any shared libraries (.dylib) that the binaries may depend on
    const libDirs = [path.join(buildDir, 'bin'), path.join(buildDir, 'src'), buildDir];
    for (const libDir of libDirs) {
        if (fs.existsSync(libDir)) {
            const files = fs.readdirSync(libDir);
            for (const file of files) {
                if (file.endsWith('.dylib')) {
                    const src = path.join(libDir, file);
                    const dest = path.join(LLAMA_DIR, file);
                    fs.copyFileSync(src, dest);
                    fs.chmodSync(dest, 0o755);
                    console.log(`  Copied shared library: ${file}`);
                }
            }
        }
    }

    // Fix rpath on binaries to look for libraries in their own directory
    for (const bin of binaries) {
        const binPath = path.join(LLAMA_DIR, bin);
        if (fs.existsSync(binPath)) {
            try {
                execSync(`install_name_tool -add_rpath @executable_path "${binPath}"`, { stdio: 'ignore' });
            } catch (e) {
                // rpath may already exist, that's fine
            }
        }
    }

    console.log("Cleaning up temp source folder...");
    fs.rmSync(tempDir, { recursive: true, force: true });
}

async function main() {
    ensureDir();
    const platform = process.platform;
    
    try {
        if (platform === 'win32') {
            await setupWindows();
        } else if (platform === 'darwin') {
            await setupMac();
        } else {
            console.log("Linux detected. You can compile from source or download vulkan binaries manually.");
            console.log("Attempting to clone and compile with standard cmake...");
            const tempDir = path.join(__dirname, '..', 'llama_temp_src');
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            runCmd(`git clone https://github.com/ggerganov/llama.cpp.git "${tempDir}"`);
            
            const buildDir = path.join(tempDir, 'build');
            let cmakeFlags = "-DGGML_RPC=ON -DBUILD_SHARED_LIBS=OFF";
            let env = Object.assign({}, process.env);
            
            try {
                // Try standard nvcc first, then arch linux default path
                try {
                    execSync('nvcc --version', { stdio: 'ignore' });
                } catch (e) {
                    execSync('/opt/cuda/bin/nvcc --version', { stdio: 'ignore' });
                    env.PATH = '/opt/cuda/bin:' + (env.PATH || '');
                    env.CUDACXX = '/opt/cuda/bin/nvcc';
                    cmakeFlags += " -DCUDAToolkit_ROOT=/opt/cuda";
                }
                cmakeFlags += " -DGGML_CUDA=ON";
                console.log("CUDA toolkit detected. Compiling with GGML_CUDA=ON for NVIDIA GPUs...");
            } catch (e) {
                let hasNvidia = false;
                try {
                    execSync('nvidia-smi', { stdio: 'ignore' });
                    hasNvidia = true;
                } catch (err) {}

                if (hasNvidia) {
                    console.log("NVIDIA GPU detected but CUDA toolkit is missing. Attempting to install CUDA toolkit...");
                    try {
                        execSync('command -v apt-get', { stdio: 'ignore' });
                        runCmd('sudo apt-get update && sudo apt-get install -y nvidia-cuda-toolkit', { env });
                        cmakeFlags += " -DGGML_CUDA=ON";
                    } catch (errApt) {
                        try {
                            execSync('command -v pacman', { stdio: 'ignore' });
                            runCmd('sudo pacman -S --noconfirm cuda', { env });
                            env.PATH = '/opt/cuda/bin:' + (env.PATH || '');
                            env.CUDACXX = '/opt/cuda/bin/nvcc';
                            cmakeFlags += " -DCUDAToolkit_ROOT=/opt/cuda -DGGML_CUDA=ON";
                        } catch (errPacman) {
                            try {
                                execSync('command -v dnf', { stdio: 'ignore' });
                                runCmd('sudo dnf install -y cuda-toolkit', { env });
                                cmakeFlags += " -DGGML_CUDA=ON";
                            } catch (errDnf) {
                                console.log("Could not detect package manager to install CUDA. Please install it manually.");
                            }
                        }
                    }
                } else {
                    try {
                        execSync('ls /usr/include/vulkan/vulkan.h', { stdio: 'ignore' });
                        cmakeFlags += " -DGGML_VULKAN=ON";
                        console.log("Vulkan headers detected. Compiling with GGML_VULKAN=ON...");
                    } catch (e2) {
                        console.log("No CUDA toolkit (nvcc) or Vulkan headers detected. Compiling for CPU only...");
                    }
                }
            }

            runCmd(`cd "${tempDir}" && cmake -B build ${cmakeFlags}`, { env });
            runCmd(`cd "${tempDir}" && cmake --build build --config Release -j4`, { env });

            const binaries = ['llama-server', 'llama-bench', 'ggml-rpc-server'];
            for (const bin of binaries) {
                let src = path.join(buildDir, 'bin', bin);
                if (!fs.existsSync(src)) src = path.join(buildDir, bin); // fallback if it built in root
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(LLAMA_DIR, bin));
                    fs.chmodSync(path.join(LLAMA_DIR, bin), 0o755);
                } else {
                    console.error(`Warning: Could not find compiled binary ${bin}`);
                }
            }
            
            // Copy any shared libraries (.so) that the binaries may depend on
            const libDirs = [path.join(buildDir, 'bin'), path.join(buildDir, 'src'), buildDir];
            for (const libDir of libDirs) {
                if (fs.existsSync(libDir)) {
                    const files = fs.readdirSync(libDir);
                    for (const file of files) {
                        if (file.endsWith('.so') || file.includes('.so.')) {
                            const src = path.join(libDir, file);
                            const dest = path.join(LLAMA_DIR, file);
                            fs.copyFileSync(src, dest);
                            fs.chmodSync(dest, 0o755);
                            console.log(`  Copied shared library: ${file}`);
                        }
                    }
                }
            }
            
            // Note: rpath might need adjustment similarly to mac, or we might need LD_LIBRARY_PATH
            // However, copying the libraries to the same folder is often sufficient if rpath is $ORIGIN
            
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        console.log("Engine setup complete! Binaries are securely placed in the llama-cpp/ directory.");
    } catch (err) {
        console.error("Error setting up engine:", err);
        process.exit(1);
    }
}

main();
