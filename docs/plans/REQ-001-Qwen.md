> **SYSTEM INSTRUCTION — READ THIS FIRST (embedded by Planner).** You are the implementation agent (Qwen3.6-35B) for the Onyx project, assigned **Agent A: "Dashboard UX & macOS Fixes"** (Issues 1, 2, 3 of `docs/PLAN.md`). This document is your complete task specification — the user will give you no other instructions. Read it fully before acting. Implement EXACTLY what sections 1–17 require, in the order of Section 5, obeying Sections 7, 8, 15, and 18 strictly. Use Section 3 as your starting map, but ALWAYS re-read the actual files before editing (line numbers drift). Report completion of each acceptance criterion in Section 6 as you finish it. If anything is ambiguous, conflicts with the codebase, or requires a decision not authorized in Section 15, **STOP and report** — never guess, never invent requirements, never expand scope.

# REQ-001-Qwen — Onyx: Dashboard UX & macOS Fixes (Agent A)

## 1. Exact Feature Request and Clarified Requirements

Implement three fixes for the Onyx dashboard (React/Vite frontend + Rust/Axum backend at `127.0.0.1:3001`):

1. **Issue 2 — macOS dependency banner:** The Engines tab (`frontend/src/EngineManager.jsx`) shows a "Linux Dependencies Required" warning only for Linux. Add an equivalent macOS banner telling users which Homebrew/Xcode tools to install before compiling llama.cpp. macOS is **compile-only** (prebuilt ggml zips have a BLAS bug — do NOT add a download path). The backend must expose macOS tool-detection fields.
2. **Issue 3 — Arch-filtered Metal engines:** On macOS the Engines tab currently lists BOTH "llama.cpp (Metal Silicon)" and "llama.cpp (Metal Intel)" for every Mac. Show only the entry matching the detected architecture (`aarch64` → Silicon, `x86_64` → Intel). Also fix a bug in `scripts/engine_manager.js`: the `mac-intel` compile branch omits `-DGGML_METAL=ON`, silently producing a CPU-only build.
3. **Issue 1 — Stale-build prevention (root cause was confirmed: stale embedded `dist/`):** Add a build **version stamp** visible in the UI and via `GET /api/version`; replace all 27 hardcoded `http://127.0.0.1:3001` API calls in the frontend with a relative base + Vite dev proxy; surface silent boot fetch failures with a visible banner; harden sidebar CSS (`flex-shrink: 0`) so the left column can never collapse.

All decisions (Q1–Q12) are resolved in `docs/PLAN.md` §8 — do not re-open them.

## 2. Explicit Scope — What the Agent is Allowed to Change

- **Allowed files (complete list):**
  - `backend/src/main.rs` — ONLY the `get_system_info` handler (~L1508), a new `get_version` handler, and its route registration (~L1762). No other regions.
  - `backend/build.rs` — add version/git-sha/build-time env injection; keep existing Windows `winres` block intact.
  - `frontend/src/App.jsx` — hardcoded-URL replacement, version footer, boot error banner, `apiBase` prop value for `<EngineManager>` (~L1147).
  - `frontend/src/EngineManager.jsx` — macOS banner + arch filtering.
  - `frontend/src/index.css` — ONLY the three rules in Requirement R8.
  - `frontend/vite.config.js` — add dev proxy.
  - `scripts/engine_manager.js` — ONLY the `mac-silicon`/`mac-intel` Metal flag lines.
- **In scope:** backend build must still succeed on Linux (this machine) with the macOS-only additions compile-safe (they are always-present JSON fields; detection only runs on macOS).
- **Out of scope (Agent B's work — do NOT touch):** `base_dir()` (L78), boot dir creation, port auto-increment, node resolution, auto-open browser, `compile.sh`, `compile.bat`, `onyx.sh`, `onyx.bat`, `scripts/package/*`, the `engine_manager.js` `ONYX_BASE` override (Agent B adds it later — leave `path.join(__dirname, '..')` untouched), any packaging.

## 3. Current Architecture / Context

- **Backend serves the embedded SPA:** `backend/src/main.rs:86-88` `#[derive(RustEmbed)] #[folder = "../frontend/dist"]`; `static_handler` (L91-112) falls back to `index.html` for non-asset paths. Router is built at L1762+ and ends `.fallback(static_handler)`.
- **System info endpoint:** `get_system_info` (L1508-1526) currently returns `{"os", "arch", "has_nvidia", "distro"}`. `os` = `std::env::consts::OS` (`"macos"`), `arch` = `std::env::consts::ARCH` (`"aarch64"` / `"x86_64"`).
- **EngineManager:** `frontend/src/EngineManager.jsx` — `apiBase` prop (currently `"http://127.0.0.1:3001"` passed at App.jsx L1147); `fetchSysInfo()` hits `${apiBase}/api/system/info`; `isWin/isMac/isLinux` flags at ~L121-124; Linux banner at ~L162-178 (uses `sysInfo.distro`, amber box with `<code>`); Mac options pushed at ~L145-147 (`compile: 'mac-silicon'` / `compile: 'mac-intel'`); options render with Compile buttons for compile-type engines.
- **Compile script:** `scripts/engine_manager.js` `handleCompile()` — base flags `-DGGML_RPC=ON -DBUILD_SHARED_LIBS=OFF`; the mac branch is:

  ```js
  if (urlOrFlags === 'mac-silicon' || urlOrFlags === 'mac-intel') {
      if (urlOrFlags === 'mac-silicon') cmakeFlags += " -DGGML_METAL=ON";
  }
  ```

- **Hardcoded API base:** 27 occurrences of `http://127.0.0.1:3001` in `App.jsx` (settings ~L596, health ~L626, models ~L631, telemetry ~L677, engine/proxy/HF/benchmark calls throughout). **Exception — must stay absolute:** the remote RPC telemetry fetch at ~L689 (`fetch(\`http://${ip}:50053/telemetry\`)`) is a *remote worker* URL, not the backend.
- **Boot gate:** App.jsx L940 — whole app shows a spinner until `hasLoadedSettings` resolves; the settings fetch (`/api/settings`, ~L596) already has `.finally(() => setHasLoadedSettings(true))` — keep that guarantee.
- **Vite:** `frontend/vite.config.js` is minimal (react plugin only). No `server` block. Dev server default port 5173; backend on 3001 with `CorsLayer::permissive()`.
- **CSS:** `frontend/src/index.css` — `.app-container` (L38, `height: 100vh`), `.main-content` (L152, flex row), `.left-sidebar` (L211, `display:flex; overflow:hidden; transition:width; will-change:width`, **no `flex-shrink:0`**), `.left-pane` (L156). Sidebar width is inline (`isLeftSidebarOpen ? '380px' : '0px'`, App.jsx ~L1021).
- **Dependencies:** backend has no extra needs; `chrono` (0.4.45) is available for timestamps. Frontend has `oxlint` (`npm run lint`).

## 4. Exact Implementation Requirements

- **R1 (Task A1):** `GET /api/system/info` must always return three additional booleans: `has_xcode_clt`, `has_brew`, `has_cmake`. On macOS, detect via spawned commands (`xcode-select -p` for CLT; `brew --version`; `cmake --version`). On Linux/Windows they must be `false` (do not gate the field out — always present so the frontend schema is stable). Use `std::process::Command`, `.output().map(|o| o.status.success()).unwrap_or(false)`. Do not change existing fields or the response shape otherwise.
- **R2 (Task A2):** In `EngineManager.jsx`, render a macOS dependency banner when `isMac` AND at least one of the three fields is missing — same visual style as the existing Linux banner (amber box, copy-paste `<code>` blocks). Compose per missing tool: no CLT → `xcode-select --install`; no brew (but CLT present) → the Homebrew install command `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`; no cmake → `brew install cmake`. If all present, no banner. Heading: "macOS Dependencies Required".
- **R3 (Task A3):** Mac engine options must be arch-filtered: `sysInfo.arch` matching `aarch64`/`arm64` → push ONLY `llama.cpp (Metal Silicon)`; `x86_64`/`x86` → ONLY `llama.cpp (Metal Intel)`; missing/unknown arch → push both (fallback). Keep exact ids/labels/`compile` flags (`mac-silicon` / `mac-intel`).
- **R4 (Task A4):** In `scripts/engine_manager.js`, both mac variants must enable Metal — replace the inner `if` so the branch becomes:

  ```js
  if (urlOrFlags === 'mac-silicon' || urlOrFlags === 'mac-intel') {
      cmakeFlags += " -DGGML_METAL=ON";
  }
  ```

  No other flag, path, or behavior changes in this file.
- **R5 (Task A5):** `backend/build.rs` must inject `cargo:rustc-env` values: `ONYX_VERSION` (run `git describe --tags --always --dirty`; on failure use `0.1.0-dev`), `ONYX_GIT_SHA` (short sha; `unknown` on failure), `ONYX_BUILT_AT` (UTC ISO-8601 via `chrono`-style formatting or `date -u`). New `GET /api/version` handler returns `{"version": ..., "git_sha": ..., "built_at": ...}` reading `env!("ONYX_VERSION")` etc. Register the route. Build must not fail when git is unavailable (graceful fallbacks).
- **R6 (Task A6):** Eliminate all 27 hardcoded `http://127.0.0.1:3001` refs in `App.jsx`. Create `frontend/src/api.js` exporting `export const API_BASE = '';` (empty = relative). Rewrite every backend fetch to `${API_BASE}/api/...` / `${API_BASE}/health`. Update the `<EngineManager apiBase=...>` prop to pass `API_BASE`. Add to `vite.config.js` a dev proxy covering BOTH `/api` and `/health` → `http://127.0.0.1:3001` (the health fetch is NOT under `/api`). Dev mode (Vite 5173) must keep working through the proxy. Leave the remote RPC telemetry fetch (~L689) absolute — it is not the backend.
- **R7 (Task A7):** Add a dismissible error banner rendered below the top bar when any critical boot fetch fails (settings, health, models, telemetry): message includes what failed and a hint like "Is the backend running? Is port 3001 in use?" Use a small state (e.g. `bootErrors: []`). The app must still render normally — the banner is additive, and the `hasLoadedSettings` `.finally()` guarantee must be preserved.
- **R8 (Task A8):** In `index.css` only: add `flex-shrink: 0;` to `.left-sidebar`; add `min-width: 0;` to `.left-pane`; change `.app-container` height to `height: 100vh; height: 100dvh;` (fallback pair). No other CSS changes.
- **R9 (Task A5b):** Add a subtle version footer in the UI (bottom of the left sidebar content area): `Onyx v<version> · <git_sha> · <built_at>` fetched from `/api/version`. If the fetch fails, render nothing (the R7 banner covers failures).

## 5. Step-by-Step Implementation Plan

1. **A1 — backend system-info fields** (`backend/src/main.rs` `get_system_info`). Always-included macOS detection fields.
2. **A5 — version stamp** (`backend/build.rs` env injection + new `get_version` handler + route registration in `main.rs`).
3. **A6 — relative API base** (`frontend/src/api.js`, rewrite `App.jsx` refs, `EngineManager` prop, `vite.config.js` proxy). Verify dev mode still works.
4. **A2 — macOS banner** (`EngineManager.jsx`), consuming the R1 fields.
5. **A3 — arch-filtered engines** (`EngineManager.jsx`).
6. **A4 — Metal flag fix** (`scripts/engine_manager.js`).
7. **A7 — boot error banner** (`App.jsx`).
8. **A8 — CSS hardening** (`index.css`).
9. **A5b — version footer** (`App.jsx`).
10. Run all Section 16 validations; fix regressions.

## 6. Acceptance Criteria / Definition of Done

Report each as you complete it; do NOT modify this file.

- [ ] `GET /api/system/info` returns `has_xcode_clt`, `has_brew`, `has_cmake` (false on Linux; detected on macOS).
- [ ] macOS banner appears only when a Mac dep is missing, with the correct copy-paste command(s); absent when all present; Linux banner untouched.
- [ ] On `arch = aarch64` only Metal Silicon is offered; on `x86_64` only Metal Intel; unknown arch → both.
- [ ] `scripts/engine_manager.js` adds `-DGGML_METAL=ON` for both `mac-silicon` and `mac-intel`; nothing else changed.
- [ ] `GET /api/version` returns `{"version","git_sha","built_at"}` with real git values (or `0.1.0-dev`/`unknown` fallbacks outside a git repo).
- [ ] Zero hardcoded `http://127.0.0.1:3001` refs remain in `frontend/src` (except the remote RPC telemetry fetch); `vite.config.js` proxies `/api` and `/health`.
- [ ] Dev mode via `npm run dev` + `cargo run` works end-to-end (sidebar, Engines tab, HF search through the proxy).
- [ ] Killing the backend while the UI is open shows the new error banner; UI still renders.
- [ ] `.left-sidebar` has `flex-shrink: 0`, `.left-pane` has `min-width: 0`, `.app-container` has the `100vh`/`100dvh` pair.
- [ ] Version footer appears in the sidebar bottom with the `/api/version` data.
- [ ] `npm run lint`, `npm run build`, `cargo build --release` all pass.

## 7. Constraints and Invariants

- Do not change `base_dir()` (L78), the bind logic (L1775+), or any `Command::new("node")` sites — Agent B owns them.
- Do not add download options for macOS engines (Q6 — BLAS bug). macOS stays compile-only.
- Do not change engine ids/labels (`llama.cpp (Metal Silicon)` / `llama.cpp (Metal Intel)`) — installed-engine detection depends on exact ids.
- Do not introduce new dependencies (backend or frontend) without authorization.
- Keep the `hasLoadedSettings` spinner gate's `.finally()` guarantee intact.
- Builds must succeed on Linux (this environment); macOS-only logic must be compile-safe everywhere.

## 8. Non-Goals / Forbidden Changes

This task does NOT include:

- Fixing the actual stale-build incident (already resolved by the user via fresh build).
- `base_dir()`, boot dir creation, port handling, node resolution, auto-open browser, packaging, launcher scripts.
- The `ONYX_BASE` env override in `engine_manager.js` (Agent B's B4) or any non-Metal-flag edits to that file.
- RPC worker, llama-server spawning, proxy, or benchmark logic.
- Any download-path additions.

## 9. Files/Components Expected to Change

| File | Expected Change | Reason |
| --- | --- | --- |
| `backend/src/main.rs` | Modify | `get_system_info` fields (R1); new `get_version` handler + route (R5) |
| `backend/build.rs` | Modify | Inject `ONYX_VERSION` / `ONYX_GIT_SHA` / `ONYX_BUILT_AT`; keep winres block |
| `frontend/src/api.js` | Add | `API_BASE` constant (R6) |
| `frontend/src/App.jsx` | Modify | Relative base rewrite, error banner (R7), version footer (R9), `apiBase` prop |
| `frontend/src/EngineManager.jsx` | Modify | macOS banner (R2), arch filter (R3) |
| `frontend/src/index.css` | Modify | R8 rules only |
| `frontend/vite.config.js` | Modify | dev proxy `/api` + `/health` (R6) |
| `scripts/engine_manager.js` | Modify | Metal flag for both mac variants (R4) |

## 10. Interfaces and Contracts

- **`GET /api/system/info` →** existing `{os, arch, has_nvidia, distro}` **plus** `{has_xcode_clt: bool, has_brew: bool, has_cmake: bool}`. No field removal or renaming.
- **`GET /api/version` →** `{"version": string, "git_sha": string, "built_at": string}` (new).
- **Vite dev proxy:** `/api` and `/health` → `http://127.0.0.1:3001` (dev only; production is same-origin).
- **Frontend API base:** `API_BASE = ''` (relative). All backend fetches use it. Remote RPC telemetry URL (`http://${ip}:50053/...`) is untouched.
- **Engine ids (unchanged):** `llama.cpp (Metal Silicon)` ↔ compile flag `mac-silicon`; `llama.cpp (Metal Intel)` ↔ `mac-intel`.

## 11. Edge Cases and Failure Behavior

- `sysInfo` fetch fails or is `null` → `isMac` is false → banner/options simply don't render; no crash (existing optional chaining already guards this — keep it).
- `arch` value is `arm64` or `x86` (some runtimes) → match both spellings (R3).
- Git unavailable during build → version fallbacks (`0.1.0-dev`, `unknown`, current time) — build must NOT fail.
- Backend down while UI open → banner shows; UI still functional-looking; no unhandled rejections (keep `.catch` chains, now with state instead of silence).
- Port 3001 occupied (stale process) → banner hint text explains it (actual auto-increment is Agent B's job).
- `npm ci` vs `npm install` is not in scope here — do not touch install flow.

## 12. Testing Requirements

- Unit-level: none required (no test framework present); rely on build + manual verification.
- Manual (this Linux env): run backend, curl `/api/system/info` and `/api/version`; run `npm run dev` + backend, verify the sidebar, Engines tab, and one HF search work through the proxy (no mixed-origin console errors); kill backend → banner appears.
- Manual (user on macOS, later): verify banner shows correct commands and only the matching Metal engine appears on Silicon vs Intel.

## 13. Existing Behavior That Must Remain Unchanged

- Dev mode (Vite 5173 + backend 3001) must work exactly as before, through the new proxy.
- The Linux deps banner and all Windows/Linux engine options must be byte-for-byte functionally identical.
- `/api/system/info` existing consumers (`os`, `arch`, `has_nvidia`, `distro`) unchanged.
- All other API endpoints, the SPA fallback, CORS (`permissive`), and engine compile/download flows unchanged.

## 14. Dependencies and Assumptions

- Assumption: `chrono` (already a backend dep) may be used for the `built_at` timestamp; or a plain UTC format via `date -u` in build.rs — either is acceptable.
- Assumption: git is present in the build environment most of the time; fallbacks cover absence.
- Assumption: Agent B will later add the `ONYX_BASE` override to `engine_manager.js`; Agent A must not pre-empt it.
- If any assumption is false, STOP and report (Section 15).

## 15. Decision Points / Prohibited Autonomous Decisions

Do not invent decisions not specified here. Specifically do NOT autonomously:

- Choose to add a macOS download path (Q6 forbids it).
- Rename engine ids/labels.
- Touch Agent B's regions (even "to help").
- Change backend dependency set.

**UNRESOLVED DECISIONS:** None.

## 16. Validation Commands

```bash
cd frontend && npm run lint
cd frontend && npm run build
cd backend && cargo build --release
# manual API checks (run backend first: cd backend && cargo run --release)
curl -s http://127.0.0.1:3001/api/system/info
curl -s http://127.0.0.1:3001/api/version
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/   # expect 200
# dev-mode proxy check: cd frontend && npm run dev, then browse http://localhost:5173
```

## 17. Expected Final State

After implementation: `frontend/src` contains zero hardcoded backend URLs (except the remote-RPC fetch); `frontend/src/api.js` exists; `vite.config.js` has the proxy; `EngineManager.jsx` shows the macOS deps banner and arch-filtered Metal options; `scripts/engine_manager.js` builds Metal for both Mac variants; `backend` exposes `/api/version` and enriched `/api/system/info`; the UI shows a version footer and a boot-error banner; sidebar CSS is collapse-proof. All three build/lint commands in Section 16 pass.

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
