const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const https = require("https");

const args = process.argv.slice(2);
if (args.length < 2) {
	console.error(
		"Usage: node engine_manager.js <action> <engine_id> [url_or_flags]",
	);
	process.exit(1);
}

const action = args[0];
const engineId = args[1];
const urlOrFlags = args[2] || "";

// Honor ONYX_BASE env for bundled/AppImage deployments; fallback to repo root
const BASE_DIR = process.env.ONYX_BASE || path.join(__dirname, "..");
const ENGINE_DIR = path.join(BASE_DIR, "engines", engineId);

function ensureDir() {
	if (!fs.existsSync(ENGINE_DIR)) {
		fs.mkdirSync(ENGINE_DIR, { recursive: true });
	}
}

function runCmd(cmd, opts = {}) {
	console.log(`> ${cmd}`);
	execSync(cmd, { stdio: "inherit", ...opts });
}

async function downloadFile(url, dest) {
	console.log(`Downloading ${url}...`);
	return new Promise((resolve, reject) => {
		https
			.get(url, { headers: { "User-Agent": "Node.js" } }, (res) => {
				if (res.statusCode === 302 || res.statusCode === 301) {
					return downloadFile(res.headers.location, dest)
						.then(resolve)
						.catch(reject);
				}
				const file = fs.createWriteStream(dest);
				res.pipe(file);
				file.on("finish", () => {
					file.close(resolve);
				});
			})
			.on("error", reject);
	});
}

async function handleDownload() {
	ensureDir();
	const platform = process.platform;
	const urls = urlOrFlags.split(",");

	for (let i = 0; i < urls.length; i++) {
		const url = urls[i].trim();
		if (!url) continue;

		const zipPath = path.join(BASE_DIR, `temp_${engineId}_${i}.zip`);
		console.log(`Downloading ${url}...`);
		await downloadFile(url, zipPath);

		console.log("Extracting archive...");
		if (platform === "win32") {
			runCmd(
				`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${ENGINE_DIR}' -Force"`,
			);
		} else {
			runCmd(
				`unzip -o "${zipPath}" -d "${ENGINE_DIR}" || tar -xf "${zipPath}" -C "${ENGINE_DIR}"`,
			);
		}

		console.log("Cleaning up temp zip...");
		fs.unlinkSync(zipPath);
	}

	console.log(`Engine ${engineId} successfully downloaded and extracted.`);
}

async function handleCompile() {
	ensureDir();
	const safeEngineId = engineId.replace(/[^a-zA-Z0-9]/g, "_");
	const tempDir = path.join(BASE_DIR, "engines", `temp_src_${safeEngineId}`);
	if (fs.existsSync(tempDir))
		fs.rmSync(tempDir, { recursive: true, force: true });

	runCmd(`git clone https://github.com/ggerganov/llama.cpp.git "${tempDir}"`);
	const buildDir = path.join(tempDir, "build");

	let cmakeFlags = "-DGGML_RPC=ON -DBUILD_SHARED_LIBS=OFF";
	const env = Object.assign({}, process.env);

	if (urlOrFlags === "mac-silicon" || urlOrFlags === "mac-intel") {
		cmakeFlags += " -DGGML_METAL=ON -DGGML_BLAS=OFF";
	} else if (urlOrFlags === "linux-cuda") {
		cmakeFlags += " -DGGML_CUDA=ON";
		try {
			execSync("nvcc --version", { stdio: "ignore" });
		} catch (e) {
			env.PATH = "/opt/cuda/bin:" + (env.PATH || "");
			env.CUDACXX = "/opt/cuda/bin/nvcc";
			cmakeFlags += " -DCUDAToolkit_ROOT=/opt/cuda";
		}
	} else if (urlOrFlags === "linux-vulkan") {
		cmakeFlags += " -DGGML_VULKAN=ON";
	}

	runCmd(`cd "${tempDir}" && cmake -B build ${cmakeFlags}`, { env });
	runCmd(`cd "${tempDir}" && cmake --build build --config Release -j4 --target llama-server --target llama-bench --target ggml-rpc-server`, {
		env,
	});

	const binaries = [
		"llama-server",
		"llama-bench",
		"ggml-rpc-server",
		"llama-server.exe",
		"llama-bench.exe",
		"ggml-rpc-server.exe",
	];
	for (const bin of binaries) {
		let src = path.join(buildDir, "bin", bin);
		if (!fs.existsSync(src)) src = path.join(buildDir, bin);
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, path.join(ENGINE_DIR, bin));
			fs.chmodSync(path.join(ENGINE_DIR, bin), 0o755);
		}
	}

	const libDirs = [
		path.join(buildDir, "bin"),
		path.join(buildDir, "src"),
		buildDir,
	];
	for (const libDir of libDirs) {
		if (fs.existsSync(libDir)) {
			const files = fs.readdirSync(libDir);
			for (const file of files) {
				if (
					file.endsWith(".dylib") ||
					file.endsWith(".so") ||
					file.includes(".so.")
				) {
					const src = path.join(libDir, file);
					const dest = path.join(ENGINE_DIR, file);
					fs.copyFileSync(src, dest);
					fs.chmodSync(dest, 0o755);
				}
			}
		}
	}

	if (process.platform === "darwin") {
		for (const bin of binaries) {
			const binPath = path.join(ENGINE_DIR, bin);
			if (fs.existsSync(binPath)) {
				try {
					execSync(
						`install_name_tool -add_rpath @executable_path "${binPath}"`,
						{ stdio: "ignore" },
					);
				} catch (e) {}
			}
		}
	}

	fs.rmSync(tempDir, { recursive: true, force: true });
	console.log(`Engine ${engineId} compiled successfully.`);
}

async function main() {
	try {
		if (action === "download") await handleDownload();
		else if (action === "compile") await handleCompile();
		else console.error("Unknown action: " + action);
	} catch (err) {
		console.error(err);
		process.exit(1);
	}
}
main();
