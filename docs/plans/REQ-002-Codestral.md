> **SYSTEM INSTRUCTION — READ THIS FIRST (embedded by Planner).** You are the implementation agent (Codestral) for the Onyx project, assigned **Agent B: "Packaging & Release Automation"** (Issues 4, 5 of `docs/PLAN.md`). This document is your complete task specification — the user will give you no other instructions. Read it fully before acting. Implement EXACTLY what sections 1–17 require, in the order of Section 5, obeying Sections 7, 8, 15, and 18 strictly. Use Section 3 as your starting map, but ALWAYS re-read the actual files before editing (line numbers drift). Report completion of each acceptance criterion in Section 6 as you finish it. If anything is ambiguous, conflicts with the codebase, or requires a decision not authorized in Section 15, **STOP and report** — never guess, never invent requirements, never expand scope.

# REQ-002-Codestral — Onyx: Packaging & Release Automation (Agent B)

## 1. Exact Feature Request and Clarified Requirements

Make Onyx distributable as precompiled binaries and scriptable to release:

1. **Issue 4 — Packaging groundwork (backend):** The backend resolves all paths from the **cwd** (`base_dir()`), which breaks when a binary is double-clicked outside the repo. Fix to resolve from the **executable's directory** (with a dev fallback and an AppImage-specific user-data root), auto-create `data/` and `engines/` at boot, auto-increment the dashboard port when 3001 is busy (cap 3010), resolve Node.js first from a **bundled portable node** then PATH, and auto-open the browser on successful startup (packaged modes only, `ONYX_NO_OPEN=1` opt-out).
2. **Issue 5 — Release automation:** Create `compile.sh` (macOS/Linux) and `compile.bat` (Windows) that: derive a version from git, build frontend + backend + rpc_agent, package per-platform artifacts (macOS `.app` zip; Linux tar.gz + AppImage; Windows zip with bundled `node.exe`) into `release/`, and print a summary. **No CI, no `gh` upload, no signing/notarization, no DMG, no universal macOS binary** (Q8, Q9 — manual upload by the user).
3. **Launcher cleanup:** Fix the legacy `llama-cpp/llama-server` engine check in `onyx.sh` / `onyx.bat` (dev mode) that no longer matches how engines are installed (`engines/<id>/`). Optional: add a "Package release" menu item.

All decisions (Q1–Q12) are resolved in `docs/PLAN.md` §8 — do not re-open them. Agent A's work (Issues 1–3) is assumed **already merged** before you start — in particular the frontend uses **relative API paths** (no hardcoded `:3001`), so the port auto-increment is safe, and `GET /api/version` exists (but your scripts MUST derive artifact names from `git describe` independently).

## 2. Explicit Scope — What the Agent is Allowed to Change

- **Allowed files (complete list):**
  - `backend/src/main.rs` — ONLY: `base_dir()` (L78-83), a new `app_dir()` helper, the boot sequence in `main()` (L1660+), the bind code (L1775+), the two `Command::new("node")` sites in `download_engine` (L1553) and `compile_engine` (L1594), and the `scripts/engine_manager.js` path construction at L1552/L1593. No other regions.
  - `scripts/engine_manager.js` — ONLY the `BASE_DIR`/`ENGINE_DIR`/temp-path resolution to honor an `ONYX_BASE` env override. Do NOT touch the Metal flag lines (Agent A's A4).
  - `onyx.sh`, `onyx.bat` — dev-mode engine check + optional "Package release" menu item.
  - New files: `compile.sh`, `compile.bat`, `scripts/package/*` (Info.plist template, AppRun, Onyx.desktop, packaging helpers).
- **In scope:** code must compile on Linux (this machine). Windows/macOS paths must be correct by construction and clearly structured (they cannot be executed here — flagged for user verification).
- **Out of scope (Agent A's work — do NOT touch):** `frontend/src/*` (any file), `frontend/vite.config.js`, the macOS Metal flag fix, the version-stamp build.rs logic (read-only reference), any API handler changes.

## 3. Current Architecture / Context

- **`base_dir()` (main.rs:78-83):** `cwd`, with `".."` if cwd ends with `backend`. Used for `models/`, `data/settings.json`, `engines/`, and the script path.
- **Boot (main.rs:1660-1661):** only `models/` is created. `data/` is created lazily on settings save (L310-313); `engines/` is never created.
- **Bind (main.rs:1775-1779):** `TcpListener::bind(SocketAddr::from(([127,0,0,1], 3001))).await.unwrap()` — panics if 3001 is taken.
- **Node spawns:** `download_engine` (L1552-1553) and `compile_engine` (L1593-1594) both do `Command::new("node").arg(script_path)...` where `script_path = format!("{}/scripts/engine_manager.js", base_dir())`. `node` comes from PATH only.
- **`scripts/engine_manager.js`:** `ENGINE_DIR = path.join(__dirname, '..', 'engines', engineId)` (L5); temp files at `path.join(__dirname, '..', 'temp_...')` (L26-27) and `engines/temp_src_<id>` (L30). All relative to the repo root = `scripts/` parent.
- **Engine layout:** `engines/<engine_id>/llama-server(.exe)` — verified by `get_installed_engines` (L1531-1537) and used by spawn logic (L1001-1006, with a legacy `llama-cpp` fallback — leave that fallback untouched). `llama-bench` path at L1212-1214.
- **Launchers:** `onyx.sh` case 3 checks `[ ! -f "llama-cpp/llama-server" ] && [ ! -f "llama-cpp/llama-server.exe" ]` before dev setup; `onyx.bat` checks `not exist "llama-cpp\llama-server.exe"`. Both are stale (engines now live in `engines/`).
- **Packaged layout (target):** `<appdir>/` contains `onyx` (or `Onyx.exe`), `scripts/`, `data/`, `models/`, `engines/`, `node` (or `node.exe`), and optionally `rpc_agent`. For macOS `.app`: `<appdir>` = `Onyx.app/Contents/MacOS/`.
- **AppImage constraint:** the AppImage runtime mounts a read-only squashfs and sets the `APPIMAGE` env var. Data dirs must move to a writable user location when `APPIMAGE` is set. The binary itself and `scripts/` stay inside the mount (read-only is fine — node reads them).
- **Dependencies:** backend has no `open` crate — use `std::process::Command` to spawn `open` (macOS) / `xdg-open` (Linux) / `cmd /c start` (Windows). `chrono` is available (not needed for scripts). No new crates allowed.

## 4. Exact Implementation Requirements

- **R1 (Task B1) — path resolution.** Introduce two functions:
  - `app_dir() -> String`: parent of `std::env::current_exe()` if that directory contains `scripts/`; else dev fallback = existing cwd logic (`cwd`, or `..` when cwd ends with `backend`). Used for `scripts/engine_manager.js` lookup and bundled-node lookup.
  - `base_dir() -> String`: if env `APPIMAGE` is set → `$XDG_DATA_HOME/onyx` if `XDG_DATA_HOME` is set, else `$HOME/.local/share/onyx` (create it on demand) — this is the writable root for `data/ models/ engines/` on AppImage. Else if `app_dir()` resolved via exe-dir (packaged mode) → `app_dir()`. Else → dev fallback (same as today). Return both a value and an `is_packaged() -> bool` (true when exe-relative or APPIMAGE mode; false in dev fallback).
  - Replace `base_dir()` usages ONLY for the data paths (`models/`, `data/`, `engines/`, L1001-1006, L1212-1214) — keep them calling `base_dir()`. Change the script-path construction (L1552/L1593) to use `app_dir()`.
- **R2 (Task B2) — boot dirs.** In `main()` after the existing `models/` creation: `fs::create_dir_all(data_dir)` and `fs::create_dir_all(engines_dir)` (both under `base_dir()`). After resolving the script path via `app_dir()`, if `{app_dir}/scripts/engine_manager.js` is missing, print a clear warning to stderr (engine installs will fail later) — do not exit.
- **R3 (Task B3) — port auto-increment.** Replace the bind with a loop: try 3001..=3010, first successful bind wins; if all fail, `eprintln!` a friendly error ("Dashboard port 3001-3010 all in use — close other Onyx instances or set ONYX_PORT") and exit non-zero. Print the chosen port (`Backend middleware starting on http://127.0.0.1:<port>`). No `.unwrap()` on bind. (No frontend change needed — Agent A's relative API base is merged.)
- **R4 (Task B4) — node resolution + ONYX_BASE.** Add `node_command() -> std::process::Command` (or tokio `Command`): if `{app_dir}/node` (unix) or `{app_dir}/node.exe` (windows) exists → use it; else `node` (PATH). Use it at BOTH spawn sites. In `scripts/engine_manager.js`, change base resolution so engines/temp paths honor an env override: `const BASE_DIR = process.env.ONYX_BASE || path.join(__dirname, '..');` and use `BASE_DIR` for `ENGINE_DIR` (L5) and the temp paths (L26-30). The backend must set `ONYX_BASE` on the spawned node process = `base_dir()` (so AppImage engines land in the user dir). Do NOT touch the Metal flag lines.
- **R5 (Task B5) — auto-open browser.** After the listener binds (before `axum::serve`), if `is_packaged()` AND env `ONYX_NO_OPEN` is unset, spawn the platform opener with `http://127.0.0.1:<resolved-port>`: macOS `open`, Linux `xdg-open`, Windows `cmd /c start "" <url>`. Spawn detached (ignore result). Dev mode (`is_packaged() == false`) never auto-opens.
- **R6 (Task B6) — `compile.sh` (macOS/Linux).** `set -euo pipefail`. Steps: (1) `VERSION=$(git describe --tags --always 2>/dev/null || date +%Y%m%d-%H%M%S)`; detect OS (`uname`) and ARCH (`uname -m` → `aarch64`/`x86_64`); (2) `cd frontend && npm ci (fallback: npm install) && npm run build`; (3) `cd ../backend && cargo build --release`; `cd ../rpc_agent && cargo build --release`; (4) package into `release/`:
  - **macOS:** build `Onyx.app/Contents/{MacOS,Resources}` from `scripts/package/Info.plist` (CFBundleIdentifier `org.onyx.app`, CFBundleName `Onyx`, CFBundleExecutable `onyx`, version = `$VERSION`); copy `backend/target/release/onyx` → `Contents/MacOS/onyx`; copy `scripts/` → `Contents/MacOS/scripts`; copy `rpc_agent/target/release/rpc_agent`; create empty `data/ models/ engines/` in `Contents/MacOS/`; copy portable node as `Contents/MacOS/node`; optional ad-hoc `codesign --force --deep -s -` (best-effort, non-fatal); zip with `ditto -c -k --keepParent` (fallback `zip -ry`) → `onyx-<VERSION>-macos-<ARCH>.zip`.
  - **Linux:** stage `release/onyx-<VERSION>-linux-<ARCH>/` with `onyx`, `rpc_agent`, `scripts/`, `data/ models/ engines/`, `node` (all `chmod +x` on binaries); `tar -czf onyx-<VERSION>-linux-<ARCH>.tar.gz`; AppImage: build `scripts/package/AppDir` (AppRun from `scripts/package/AppRun` exec'ing `./onyx`, `Onyx.desktop`, optional icon), run `appimagetool` (auto-download the AppImage tool to `scripts/package/` if missing) → `onyx-<VERSION>-linux-<ARCH>.AppImage`.
  - Portable node: look for `scripts/portable-node/node` (or download the official nodejs.org binary tarball for the current OS/ARCH if absent; on download failure print clear instructions and continue without bundling — the backend falls back to PATH).
  - (5) Print summary: artifact paths, sizes, and a reminder that upload is manual (Q9).
- **R7 (Task B7) — `compile.bat` (Windows).** Same pipeline: `for /f %%i in ('git describe --tags --always') do set VERSION=%%i`; `cd frontend && call npm ci && call npm run build`; `cd ..\backend && call cargo build --release`; `cd ..\rpc_agent && call cargo build --release`; stage `release\onyx-%VERSION%-win-x64\` with `onyx.exe`, `rpc_agent.exe`, `scripts\`, empty `data models engines`, `node.exe` (from `scripts\portable-node\node.exe`, with the same download-or-instruct behavior); zip via PowerShell `Compress-Archive -Force` → `onyx-%VERSION%-win-x64.zip`; print summary.
- **R8 (Task B8) — launchers.** In `onyx.sh` case 3 and `onyx.bat` :START_DEV: replace the `llama-cpp/llama-server(.exe)` existence check with a check that `engines/` contains at least one installed engine dir (e.g. `ls engines/*/llama-server* 2>/dev/null` / `dir engines\*` style), so first-time dev setup is only triggered when truly nothing is installed. Optional (recommended): add menu option "Package Release" (option 5) that runs `./compile.sh` / `call compile.bat`. Do not change any other menu behavior.

## 5. Step-by-Step Implementation Plan

1. **B1** — `app_dir()` / `base_dir()` / `is_packaged()` in `backend/src/main.rs`; update script-path construction (L1552/L1593) to `app_dir()`.
2. **B2** — boot dir creation (`data/`, `engines/`) + scripts-presence warning.
3. **B3** — port auto-increment loop (3001..=3010) with friendly failure.
4. **B4** — `node_command()` helper + both spawn sites; `ONYX_BASE` env set on the child; `engine_manager.js` base override.
5. **B5** — auto-open browser (packaged modes only, `ONYX_NO_OPEN=1` opt-out).
6. **B6** — `scripts/package/*` (Info.plist, AppRun, Onyx.desktop) then `compile.sh`; verify Linux path end-to-end here.
7. **B7** — `compile.bat`.
8. **B8** — `onyx.sh` / `onyx.bat` launcher fixes + optional package menu item.
9. Run all Section 16 validations; fix regressions.

## 6. Acceptance Criteria / Definition of Done

Report each as you complete it; do NOT modify this file.

- [ ] `base_dir()` returns the exe directory when `scripts/` sits next to the binary; returns the dev fallback when launched via `cargo run` from `backend/`; returns `$XDG_DATA_HOME/onyx` (or `~/.local/share/onyx`) when `APPIMAGE` is set.
- [ ] Boot creates `data/`, `engines/`, `models/` and warns (does not crash) if `scripts/engine_manager.js` is missing.
- [ ] With a process holding port 3001, the backend binds the next free port (3002...) up to 3010 and prints it; exits with a friendly message when all are busy.
- [ ] Bundled `node`/`node.exe` next to the binary is preferred over PATH node (verify by temporarily moving system node out of PATH).
- [ ] `engine_manager.js` honors `ONYX_BASE` for engines/temp paths; Metal flag lines untouched.
- [ ] Packaged mode auto-opens the browser at the resolved port; dev mode never does; `ONYX_NO_OPEN=1` suppresses it.
- [ ] `compile.sh` on this Linux machine produces `release/onyx-<VERSION>-linux-<ARCH>.tar.gz` AND `.AppImage` containing the binary, `scripts/`, and bundled node; prints a summary.
- [ ] `compile.bat` and the macOS `.app` path are present, structured, and internally consistent (cannot be executed here — flagged for user verification).
- [ ] `onyx.sh` / `onyx.bat` no longer reference `llama-cpp/` for the dev-mode engine check.
- [ ] `cargo build --release` passes for both `backend` and `rpc_agent`.

## 7. Constraints and Invariants

- **No new crates** — use `std::process::Command` for openers; no `open` crate.
- Do not modify `frontend/src/*`, `frontend/vite.config.js`, or any API handler.
- Do not change the Metal-flag lines in `engine_manager.js` (Agent A's) — only the base-path resolution (R4).
- Do not touch the legacy `llama-cpp` fallback in `backend/src/main.rs` (L1001-1006) — leave it as-is.
- Keep the settings.json format, all API routes, CORS, and the SPA fallback unchanged.
- Artifact names must be versioned (`onyx-<VERSION>-<os>-<arch>.<ext>`); do NOT overwrite prior releases in `release/` silently (overwrite is fine, but print what you produced).
- AppImage data must never be written inside the read-only mount (R1 covers this).

## 8. Non-Goals / Forbidden Changes

This task does NOT include:

- Signing/notarization, DMG creation, or any Apple Developer ID flow (Q8).
- CI pipelines, `gh` uploads, or release automation beyond the two scripts (Q9).
- Universal macOS binaries (Q7 — per-arch only).
- A Rust reimplementation of `engine_manager.js` (Q10 — bundling only).
- `.deb`/`.rpm`/Flatpak/Snap packaging (Q11 — AppImage + tar.gz).
- Any frontend or EngineManager changes (Agent A).

## 9. Files/Components Expected to Change

| File | Expected Change | Reason |
| --- | --- | --- |
| `backend/src/main.rs` | Modify | `base_dir()`/`app_dir()`/`is_packaged()` (R1); boot dirs (R2); port loop (R3); node helper + ONYX_BASE env (R4); auto-open (R5) |
| `scripts/engine_manager.js` | Modify | `BASE_DIR` honors `process.env.ONYX_BASE` (fallback: `path.join(__dirname,'..')`) for engines/temp paths only (R4) |
| `compile.sh` | Add | macOS/Linux release build + package (R6) |
| `compile.bat` | Add | Windows release build + package (R7) |
| `scripts/package/Info.plist` | Add | macOS `.app` metadata template (R6) |
| `scripts/package/AppRun` | Add | AppImage entrypoint (R6) |
| `scripts/package/Onyx.desktop` | Add | AppImage desktop entry (R6) |
| `onyx.sh` | Modify | dev engine check + optional package menu (R8) |
| `onyx.bat` | Modify | dev engine check + optional package menu (R8) |

## 10. Interfaces and Contracts

- **`ONYX_BASE` (env, set by backend on the node child):** writable data root (engines/temp). Absent → old behavior (`__dirname/..`).
- **`APPIMAGE` (env, read by backend):** set by the AppImage runtime → switch `base_dir()` to user data dir.
- **`ONYX_NO_OPEN` (env, read by backend):** `1` suppresses auto-open.
- **`ONYX_PORT` (optional env, read by backend):** if set, start the auto-increment loop at this port instead of 3001 (still capped at +10). (Add only if trivial; otherwise skip.)
- **Bundled node location:** `<appdir>/node` (unix) / `<appdir>/node.exe` (windows), produced by compile scripts.
- **Artifact names:** `onyx-<VERSION>-macos-<ARCH>.zip`, `onyx-<VERSION>-linux-<ARCH>.tar.gz`, `onyx-<VERSION>-linux-<ARCH>.AppImage`, `onyx-<VERSION>-win-x64.zip` into `release/`.
- **Dashboard URL for auto-open:** `http://127.0.0.1:<resolved-port>`.

## 11. Edge Cases and Failure Behavior

- Ports 3001-3010 all busy → friendly stderr message + non-zero exit (no panic).
- Bundled node missing → PATH fallback + a clear boot warning so users know.
- `APPIMAGE` set but `XDG_DATA_HOME`/`HOME` unset or dir unwritable → fall back to `base_dir()` exe mode and warn (never crash).
- `git describe` fails → version fallback to date string.
- `npm ci` fails (no lockfile) → fall back to `npm install`.
- `ditto`/`zip`/`appimagetool` missing → print install/download instructions; AppImage step is non-fatal for the tar.gz artifact (but the script should fail loudly if the AppImage was requested and can't be produced).
- Executable path contains spaces → quote all paths in scripts (`"$VAR"`, `"%VAR%"`).
- AppImage: engines/model downloads must land in the user dir (R1/R4) — never inside the read-only mount.
- macOS `.app`/Windows `compile.bat` cannot be executed in this Linux environment — keep them robust by construction; flag them in the final report for user verification.

## 12. Testing Requirements

- Build: `cargo build --release` (backend + rpc_agent) — must pass.
- Packaged-folder run (Linux): copy `backend/target/release/onyx` + `scripts/` + empty dirs into a temp folder, run it from a different cwd; verify `data/`/`engines/` are created next to the binary and the SPA loads at the printed port.
- Port conflict: start a dummy listener on 3001, launch the binary, verify it picks 3002+ and prints it; with 3001-3010 occupied, verify the friendly failure.
- Node bundling: place a fake `node` in the packaged folder, remove system node from PATH, trigger an engine install via the UI/API, verify the bundled node is used.
- `ONYX_NO_OPEN=1` suppresses auto-open; dev mode (`cargo run` from `backend/`) never auto-opens.
- Run `compile.sh` here: verify tar.gz + AppImage artifacts exist in `release/` with the right names; run the AppImage (if the environment permits) and confirm `APPIMAGE` mode writes to `~/.local/share/onyx`.
- Windows/macOS paths: static review only (document in report).

## 13. Existing Behavior That Must Remain Unchanged

- Dev flow (`cargo run` from `backend/`, `onyx.sh`/`onyx.bat` options 1-4) resolves the same directories as today (`base_dir()` dev fallback).
- All API endpoints, CORS, SPA fallback, engine compile/download/stop/delete flows, and `settings.json` format.
- The legacy `llama-cpp` fallback in spawn logic stays functional (unchanged).
- The Metal-flag behavior Agent A just added stays untouched.

## 14. Dependencies and Assumptions

- Assumption: Agent A is merged first — the frontend has no hardcoded `:3001` (relative API base) and `/api/version` exists.
- Assumption: `unzip`, `tar`, `zip`/`ditto` availability varies — handle missing tools with clear messages (Section 11).
- Assumption: portable node can be obtained from `nodejs.org` official binaries; if not, PATH fallback covers it.
- Assumption: `appimagetool` is downloaded from its official GitHub release if absent.
- If any assumption is false, STOP and report (Section 15).

## 15. Decision Points / Prohibited Autonomous Decisions

Do not invent decisions not specified here. Specifically do NOT autonomously:

- Add a Rust rewrite of engine_manager (Q10 forbids it).
- Add signing/notarization/DMG steps (Q8).
- Change the auto-increment cap or base port without authorization.
- Alter the packaged folder layout (binary + `scripts/ data/ models/ engines/ node`).
- Touch Agent A's files or regions.

**UNRESOLVED DECISIONS:** None.

## 16. Validation Commands

```bash
cd backend && cargo build --release
cd ../rpc_agent && cargo build --release
# packaged-folder smoke test (Linux):
mkdir -p /tmp/onyx-pkg/{data,models,engines} && cp backend/target/release/onyx /tmp/onyx-pkg/ && cp -r scripts /tmp/onyx-pkg/
cd /tmp && ONYX_NO_OPEN=1 /tmp/onyx-pkg/onyx   # verify dirs created next to binary + SPA at printed port
# port conflict test:
python3 -c "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',3001)); s.listen(); time.sleep(30)" &
ONYX_NO_OPEN=1 /tmp/onyx-pkg/onyx              # expect port 3002
# release build:
./compile.sh                                    # expect release/onyx-<VER>-linux-<ARCH>.tar.gz + .AppImage
```

## 17. Expected Final State

After implementation: the backend resolves paths from the executable (with dev + AppImage modes), creates its data dirs on boot, survives port conflicts via auto-increment, prefers a bundled node, and auto-opens the browser in packaged modes. `compile.sh`/`compile.bat` + `scripts/package/*` produce versioned artifacts (macOS .app zip, Linux tar.gz + AppImage, Windows zip) into `release/`. `engine_manager.js` honors `ONYX_BASE`. Launchers no longer reference the stale `llama-cpp/` path and (optionally) expose a "Package release" menu item. Both crates build cleanly.

## 18. Agent Instructions / Execution Rules

1. Implement only this plan.
2. Do not expand the scope.
3. Do not implement features mentioned elsewhere in the repository unless required by this plan.
4. Prefer existing project patterns over introducing new patterns.
5. Do not make architectural changes without explicit authorization.
6. Do not modify unrelated files.
7. If the plan conflicts with the existing implementation, stop and report the conflict rather than guessing.
8. If a requirement is ambiguous, stop and report it.
9. Do not mark the task complete until every acceptance criterion passes.
