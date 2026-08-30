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
		const { spawnSync } = require("child_process");
		if (platform === "win32") {
			// Windows 10+ ships `tar` (bsdtar), which extracts .zip files and
			// handles spaces/parentheses in engine ids safely (separate argv).
			// Fall back to PowerShell only if tar is unavailable, quoting every
			// path because `powershell -Command` re-parses the concatenated
			// command line and breaks on bare spaces/parens (e.g. the engine id
			// `llama-cpp-turboquant (CUDA 12.4)`). Check exit codes so failures
			// are surfaced instead of being reported as a false success.
			let tarStatus = null;
			const tarRes = spawnSync("tar", ["-xf", zipPath, "-C", ENGINE_DIR], {
				stdio: "inherit",
			});
			tarStatus = tarRes.error ? tarRes.error.code : tarRes.status;
			if (tarRes.error || tarRes.status !== 0) {
				const psCmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${ENGINE_DIR.replace(/'/g, "''")}' -Force`;
				const psRes = spawnSync("powershell", ["-NoProfile", "-Command", psCmd], {
					stdio: "inherit",
				});
				if (psRes.error || psRes.status !== 0) {
					throw new Error(
						`Failed to extract archive (tar exit ${tarStatus}, PowerShell exit ${psRes.status}). Check the zip is valid and writable.`,
					);
				}
			}
		} else {
			const res = spawnSync("unzip", ["-o", zipPath, "-d", ENGINE_DIR], {
				stdio: "inherit",
			});
			if (res.error || res.status !== 0) {
				const tarRes = spawnSync("tar", ["-xf", zipPath, "-C", ENGINE_DIR], {
					stdio: "inherit",
				});
				if (tarRes.error || tarRes.status !== 0) {
					throw new Error("Failed to extract archive (both unzip and tar failed)");
				}
			}
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

	const { spawnSync } = require("child_process");
	const gitRepo = engineId.includes("turboquant")
		? "https://github.com/TheTom/llama-cpp-turboquant.git"
		: "https://github.com/ggerganov/llama.cpp.git";
	spawnSync("git", ["clone", gitRepo, tempDir], { stdio: "inherit" });
	const buildDir = path.join(tempDir, "build");

	const cmakeFlagsArr = [
		"-B",
		"build",
		"-DGGML_RPC=ON",
		"-DBUILD_SHARED_LIBS=OFF",
	];
	const env = Object.assign({}, process.env);

	if (urlOrFlags === "mac-silicon" || urlOrFlags === "mac-intel") {
		cmakeFlagsArr.push("-DGGML_METAL=ON", "-DGGML_BLAS=OFF");
	} else if (urlOrFlags === "linux-cuda") {
		cmakeFlagsArr.push("-DGGML_CUDA=ON");
		try {
			execSync("nvcc --version", { stdio: "ignore" });
		} catch (e) {
			env.PATH = "/opt/cuda/bin:" + (env.PATH || "");
			env.CUDACXX = "/opt/cuda/bin/nvcc";
			cmakeFlagsArr.push("-DCUDAToolkit_ROOT=/opt/cuda");
		}
	} else if (urlOrFlags === "linux-vulkan") {
		cmakeFlagsArr.push("-DGGML_VULKAN=ON");
	}

	spawnSync("cmake", cmakeFlagsArr, { env, cwd: tempDir, stdio: "inherit" });
	spawnSync(
		"cmake",
		[
			"--build",
			"build",
			"--config",
			"Release",
			"-j4",
			"--target",
			"llama-server",
			"--target",
			"llama-bench",
			"--target",
			"ggml-rpc-server",
		],
		{ env, cwd: tempDir, stdio: "inherit" },
	);

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
					execSync(`install_name_tool -add_rpath @executable_path "${binPath}"`, {
						stdio: "ignore",
					});
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
