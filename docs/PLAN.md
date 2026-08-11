# Onyx — Packaging, macOS Fixes & Release Automation Plan

**Status:** v2 — Q1-Q12 answered, Agent A/B task split assigned (awaiting user approval)
**Author:** Planner (review only — no code changed)
**Date:** 2025-08-11

---

## 0. TL;DR

Five workstreams, in dependency order:

1. **Quick UI wins** (Issues 2 & 3): macOS dependency banner + arch-filtered Metal engines. Small, isolated, shippable immediately.
2. **Frontend hardening** (Issue 1): kill the hardcoded `http://127.0.0.1:3001` API base, add a build version stamp, harden sidebar CSS, surface fetch errors. Makes dev/prod identical and makes "stale build" bugs detectable.
3. **Packaging core** (Issue 4 groundwork): resolve all paths from the executable (not cwd), auto-create data dirs, auto-open browser, solve the hidden **Node.js runtime dependency** for engine installs.
4. **Release automation** (Issue 5): `compile.sh` / `compile.bat` → build + package per platform (zip / .app / AppImage + tar.gz), manual upload.
5. **Docs & test matrix** across macOS (Silicon + Intel), Windows, Linux.

**Biggest discovery:** the app has a hidden runtime dependency — the backend shells out to **Node.js** (`node scripts/engine_manager.js`) to download/compile engines. Any precompiled binary still requires Node on the user's machine unless we fix this. This is the single most important constraint for Issue 4/5.

---

## 1. Current Architecture (what I verified in the code)

| Component | Location | Notes |
| --- | --- | --- |
| Frontend SPA | `frontend/` (React + Vite) | Built to `frontend/dist/`; **gitignored** |
| Frontend embedding | `backend/src/main.rs:86-88` `#[derive(RustEmbed)] #[folder = "../frontend/dist"]` | Frontend is baked **into the Rust binary at compile time** |
| Backend server | `backend/src/main.rs` (Axum, port `127.0.0.1:3001`) | Serves API + embedded SPA via `static_handler` (fallback to index.html, main.rs:91-112) |
| API base in frontend | `frontend/src/App.jsx` — **27 hardcoded** `http://127.0.0.1:3001` refs | Dev mode (Vite on 5173) cross-origin; prod same-origin; CORS is `permissive()` (main.rs:1774) |
| Path resolution | `base_dir()` at `backend/src/main.rs:78-83` | **Derived from cwd**, with a hack for cwd=`backend`. Breaks when a binary is double-clicked outside the repo |
| Runtime dirs | `models/`, `data/settings.json`, `engines/<engine_id>/` | All resolved against `base_dir()`; `models/` is auto-created, `data/` is NOT (only on save), `engines/` NOT |
| Engine install | Backend spawns `node scripts/engine_manager.js download | compile ...` (main.rs:1552, 1593) | **Node.js is a runtime dependency** |
| System info | `GET /api/system/info` (main.rs:1508-1526) | Returns `os, arch, has_nvidia, distro` — `distro` only for Linux; nothing macOS-specific |
| Engine options UI | `frontend/src/EngineManager.jsx` | Builds `options[]` per-OS; Linux deps banner is `isLinux`-only; Mac pushes **both** Metal variants unconditionally |
| Engine compile script | `scripts/engine_manager.js` | `mac-intel` branch does **not** set `-DGGML_METAL=ON` (bug, see Issue 3); git-clones llama.cpp each time |
| Launchers | `onyx.sh`, `onyx.bat` | Compile-from-source flow; dev-mode engine check still references legacy `llama-cpp/llama-server` (should be `engines/`) |
| UI gate | `frontend/src/App.jsx:940` | Whole app shows a spinner until `/api/settings` resolves (`hasLoadedSettings`) |

---

## 2. Issue 1 — macOS: Left Sidebar missing in Primary Node mode (works in dev mode)

### 2.1 Findings

The sidebar is a plain React div — no platform check anywhere. `isLeftSidebarOpen` defaults to `true` (App.jsx:305), width 380px inline. Nothing programmatically closes it. Since the **same embedded dist** renders fine on Linux (prod) and macOS (dev), a pure "Rust injection is broken on macOS" theory is very unlikely — the embed path is OS-independent.

**Root cause — CONFIRMED by user (Q1-Q4):** the macOS binary was a **stale build**. A fresh `git pull` + rebuild fixed the sidebar across Safari, Firefox, and Chrome. The embedded `dist/` is gitignored and baked into the binary at compile time — an old binary silently ships an old UI with no way to tell. There is **no browser-specific rendering bug** (all three browsers behaved identically).

**Remaining work = prevention, not debugging:**

1. **Version stamp** — embed git SHA + build time in the binary, expose via `GET /api/version` + a UI footer, so "stale binary" is instantly visible (Task A5).
2. **Silent failure paths** — `/api/settings` hanging keeps the whole app on a spinner gate (App.jsx:940); fetch failures are swallowed by `.catch(() => {})` everywhere. Surface boot failures (settings/telemetry/health) with a visible banner (Task A7).
3. **CSS hardening (cheap, low priority)** — `.left-sidebar` lacks `flex-shrink: 0` (index.css:211) and `.app-container` uses `100vh`. Not the root cause, but prevents the same "collapsed column" symptom on small windows/zoomed browsers (Task A8).

### 2.2 Proposed fix (phased)

**A. (DONE — diagnosed by user)** Root cause was a stale embedded build; a fresh build fixes it. No further reproduction needed — items B/C below are prevention.

**B. Frontend hardening (do regardless — cheap, prevents whole class):**

- Replace all hardcoded `http://127.0.0.1:3001` with a single `API_BASE` constant (relative `/` by default) and add a **Vite dev proxy** (`/api` → `localhost:3001`) in `vite.config.js`. One code path for dev/prod; no cross-origin at all.
- Add `flex-shrink: 0` to `.left-sidebar`, `min-width: 0` to `.left-pane`, and `min-height: 0` where needed; use `100dvh` with `100vh` fallback for `.app-container`.
- Add a build **version stamp**: embed git SHA + frontend build timestamp (build.rs / Vite define), expose via `GET /api/version` and show in the UI footer. Instantly distinguishes "stale binary" from "real bug."

**C. Error surfacing:** replace silent `.catch(() => {})` on the critical boot fetches (settings, telemetry, health) with a visible banner ("Backend unreachable at <url> — is port 3001 in use?"). If a stale process holds port 3001, this becomes obvious.

### 2.3 Files

`frontend/vite.config.js`, `frontend/src/App.jsx`, `frontend/src/index.css`, `frontend/index.html` (footer/version), `backend/src/main.rs` (version endpoint + build stamp in `build.rs`).

---

## 3. Issue 2 — macOS: missing "install dependencies" banner for compiling llama.cpp

### 3.1 Findings

- `EngineManager.jsx` shows the deps banner only for `isLinux` (distro-aware: pacman/apt/dnf).
- macOS needs: **Xcode Command Line Tools** (compilers) + **Homebrew + cmake**. None of this is checked or displayed today.
- Backend `/api/system/info` returns nothing macOS-specific.

### 3.2 Proposed fix

- **Backend** (`get_system_info`): for macOS, detect and return:
  - `has_xcode_clt` → check `xcode-select -p` succeeds / `/usr/bin/clang` exists
  - `has_brew` → `command -v brew`
  - `has_cmake` → `command -v cmake`
  - (keep existing `os/arch/has_nvidia` fields)
- **Frontend** (`EngineManager.jsx`): add `{isMac && ...}` banner, shown when deps are missing, with a copy-paste command:
  - no CLT: `xcode-select --install`
  - no brew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
  - no cmake: `brew install cmake`
  - Combined (CLT present): `brew install cmake`
- Show the banner only for engines that require compiling (i.e., before offering compile buttons); hide once deps detected. Same UX pattern as Linux.
- **Note (Q6):** macOS is **compile-only** (no prebuilt downloads — ggml zips have a BLAS bug). This banner is the only onboarding for Mac engine installs — make it prominent and keep it in sync with the Linux box.

### 3.3 Files

`backend/src/main.rs` (`get_system_info`), `frontend/src/EngineManager.jsx`.

---

## 4. Issue 3 — macOS: show only the correct Metal engine for the architecture

### 4.1 Findings

- `EngineManager.jsx` pushes **both** `llama.cpp (Metal Silicon)` and `llama.cpp (Metal Intel)` for every Mac, regardless of `sysInfo.arch`.
- `/api/system/info` already returns `arch` (`aarch64` / `x86_64`) — unused for this.
- **Bug in `scripts/engine_manager.js`:** the compile branch only adds `-DGGML_METAL=ON` for `mac-silicon`; `mac-intel` compiles a **CPU-only** build (no Metal), silently giving Intel users a slow engine.
- Bonus: ggml-org/llama.cpp GitHub releases ship **prebuilt** macOS zips (`bin-macos-arm64.zip`, `bin-macos-x64.zip`) — macOS currently only offers compile, never download, even though download would work and be much faster/easier for users.

### 4.2 Proposed fix

- **Frontend:** filter by `sysInfo.arch` (Q5 — Silicon primary, Intel legacy; Q7 — per-arch, no universal builds):
  - `aarch64` → only `llama.cpp (Metal Silicon)`
  - `x86_64` → only `llama.cpp (Metal Intel)`
  - (fallback: show both only if `arch` is unknown)
- **Engine compile script:** add `-DGGML_METAL=ON` for **both** mac variants — Intel Macs have Metal, and today the `mac-intel` branch silently builds a CPU-only engine (bug). Keep the current flag set otherwise.
- **No download path on macOS (Q6):** ggml prebuilt macOS zips have a BLAS bug that prevents models from loading. macOS stays compile-only with the exact flags already in `scripts/engine_manager.js`.

### 4.3 Files

`frontend/src/EngineManager.jsx`, `scripts/engine_manager.js`.

---

## 5. Issue 4 — Distribution strategy (precompiled binaries)

### 5.1 Hard constraints discovered (must fix regardless of format)

1. **Node.js runtime dependency** — `download_engine`/`compile_engine` spawn `node` (main.rs:1552, 1593). **DECIDED (Q10):** bundle a portable `node` binary in the app folder; backend resolves `<appdir>/node` (or `node.exe`) first, then falls back to PATH (Task B4). No Rust reimplementation.
2. **Path resolution** — `base_dir()` uses cwd. Double-clicking a packaged binary on macOS sets cwd to `/`; Windows Explorer usually sets it to the exe's folder but not guaranteed. **Must switch to `std::env::current_exe()` parent** (fallback to cwd for dev).
3. **Missing dirs** — backend must auto-create `data/`, `engines/`, `scripts/` presence check, and `models/` on boot (today only `models/` is created).
4. **`scripts/engine_manager.js` must ship** alongside the binary (or be embedded).
5. **Port 3001 conflicts** — if the port is taken, today the app panics (`.unwrap()` on bind). **DECIDED (Q12):** auto-increment 3001 → 3002 → … (cap 3010), print the chosen port, auto-open the browser at the resolved URL (Task B3/B5). **Requires Task A6 merged first** (frontend must not hardcode 3001).

### 5.2 Proposed per-platform strategy

| Platform | App distribution | Engine install path | Notes |
| --- | --- | --- | --- |
| **Windows** | Portable folder in a zip: `Onyx.exe` + `data/ models/ engines/ scripts/` + bundled `node.exe` (Q10) | **Download only** (CUDA 12/13, Vulkan, CPU zips from ggml releases — already implemented) → no compiler needed at runtime; **verify BLAS bug doesn't affect these zips (Q6 flag)** | Simplest story, keep as-is |
| **macOS** | `.app` bundle in a zip (Q8 — no Developer ID → no signing/notarization; users accept first-open Gatekeeper warning; DMG dropped) | **Compile only** (Q6 — ggml prebuilt zips have a BLAS bug); needs Xcode CLT + cmake → Issue 2 banner is the onboarding | Optional ad-hoc `codesign -s -`; not required |
| **Linux** | **AppImage** (Q11 — one file, works on most glibc distros) + `tar.gz` + `launch.sh` fallback; skip Flatpak/Snap (sandboxing breaks spawning llama-server processes) | **Compile first** with the existing distro-aware banner (pacman/apt/dnf); Download (ggml `bin-ubuntu-x64.zip`) only if the BLAS bug (Q6) is verified NOT to affect Linux zips — **flag for Phase 3 testing** | AppImage needs `appimagetool` in the release pipeline only |
| All | First launch: auto-create dirs, **auto-open browser** at the resolved port, **auto-increment** if 3001 is busy (Q12) | | |

### 5.3 Files

`backend/src/main.rs` (`base_dir()` → exe-relative, boot dir creation, bind error handling + port auto-increment, node resolution helper, auto-open browser via `open`/`xdg-open`/`start`), packaging scripts (Phase 4), `onyx.sh`/`onyx.bat` cleanup (remove legacy `llama-cpp/` check; optional "Package release" menu item).

---

## 6. Issue 5 — Release automation (`compile.sh` / `compile.bat`)

### 6.1 Proposed flow (both scripts, same steps)

1. **Version stamp** — derive `git describe` (fallback: date) and inject into the binary (env! macro via build.rs / cargo `--config`), e.g. `ONYX_VERSION`.
2. **Build frontend** — `cd frontend && npm ci && npm run build` (fail if dist missing).
3. **Build backend + rpc_agent** — `cargo build --release` (both crates).
4. **Package** into `release/`:
   - Windows (`compile.bat`): copy `onyx.exe`, `rpc_agent.exe`, `scripts/`, empty `data/ models/ engines/`, bundled `node.exe` → zip via PowerShell `Compress-Archive`.
   - macOS (`compile.sh` on macOS): build `.app` bundle (Info.plist, icon, binary, scripts), optional ad-hoc `codesign -s -` (Q8 — no Developer ID, no notarization, no DMG), zip.
   - Linux: tar.gz + optional AppImage via `appimagetool` (download if missing).
5. **No upload (Q9)** — scripts only build + package into `release/` and print artifact paths, sizes, and next steps. You upload manually.
6. **Print a summary** — artifact paths, sizes, next steps (upload manually, send to testers).

### 6.2 Realistic limitation (DECIDED — Q9)

**No CI, no `gh` automation.** You upload artifacts manually. Rust **cross-compilation** to macOS from Windows/Linux is painful anyway, so each OS runs its own native script: `compile.sh` on macOS/Linux, `compile.bat` on Windows (Task B6/B7).

### 6.3 Files

New: `compile.sh`, `compile.bat`, `scripts/package/*` helpers (Info.plist template, AppImage recipe).

---

## 7. Recommended implementation order

| Phase | Scope | Agent | Depends on |
| --- | --- | --- | --- |
| **0. Diagnosis** | DONE — stale build confirmed (Q1-Q4); fresh build fixes it | — | — |
| **1. Agent A** | Issues 2 + 3 + 1: macOS deps banner (A1-A2), arch-filtered Metal engines + Intel flag fix (A3-A4), version stamp (A5), relative API base + Vite proxy (A6), error banner (A7), CSS hardening (A8) | Qwen3.6-35B | — |
| **2. Agent B** | Issues 4 + 5: exe-relative `base_dir()` (B1), boot dirs (B2), port auto-increment (B3), node resolution/bundling (B4), auto-open (B5), `compile.sh` (B6), `compile.bat` (B7), launcher cleanup (B8) | Codestral | Phase 1 merged (B3 needs A6; B6/B7 consume A5 stamp) |
| **3. Docs & test matrix** | README updates, per-OS test checklist (Silicon/Intel/Windows/Linux), BLAS-bug verification on Windows/Linux zips, tester feedback loop | — | Phase 1-2 |

**Gate for Agent B:** Agent A's work must be merged first — packaging against cwd-based paths would ship broken binaries.

---

## 8. Decisions (resolved — Q1-Q12 answered by user)

| # | Question | Answer | Impact on plan |
| --- | --- | --- | --- |
| Q1 | Browsers tested on macOS | Safari, Firefox, Chrome — all three | Not browser-specific; rules out Safari-only rendering theory |
| Q2 | Fresh build? | Fresh `git pull` + rebuild fixed the sidebar | **Root cause = stale embedded dist.** Issue 1 becomes prevention (version stamp, error surfacing) |
| Q3 | What did the broken screen show | N/A — resolved by fresh build | N/A |
| Q4 | Port 3001 / screenshot | N/A — resolved by fresh build | N/A |
| Q5 | Intel Mac support | Silicon primary; Intel kept as legacy | Keep the Intel engine branch; arch-filter (A3) and Metal flag fix (A4) both needed |
| Q6 | macOS prebuilt download path? | **No** — ggml prebuilt zips have a BLAS bug that breaks model loading; must compile with our flags | macOS is compile-only; no download path; deps banner (A2) is critical onboarding; **flag: verify whether Windows/Linux zips share the bug** |
| Q7 | Universal vs per-arch | Whichever is easier → per-arch | No universal builds; `aarch64`/`x86_64` filter only |
| Q8 | Apple Developer ID | None | No signing/notarization; **.app zip** with first-open Gatekeeper warning; DMG dropped |
| Q9 | CI / release pipeline | Manual upload; just `compile.sh`/`compile.bat` | No GitHub Actions, no `gh release` automation |
| Q10 | Node runtime | Bundle portable Node short-term; no Rust rewrite | Option A only — node resolution helper (B4) + bundling in compile scripts |
| Q11 | Linux artifact | AppImage | AppImage = primary Linux artifact (B6); tar.gz fallback |
| Q12 | Auto-open browser / busy port | Auto-open yes; auto-increment port | B3 (auto-increment, cap 3010) + B5 (auto-open at resolved port); requires A6 merged first |

---

## 9. Task Assignment — Agent A (Qwen3.6-35B) & Agent B (Codestral)

The work is split into **two sequential workstreams**. After this PLAN.md is approved, each agent gets a tailored plan generated from `docs/plans/plan-template.md` (file convention: `docs/plans/REQ-###-[ModelName].md`).

**Why this split:** Agent A owns the UI/UX + macOS correctness work (Issues 1-3) — it requires careful reasoning about frontend state, cross-browser behavior, and a small, well-scoped Rust surface. Agent B owns packaging + release tooling (Issues 4-5) — mostly mechanical, boilerplate-heavy code generation (shell/batch packaging, Rust system plumbing) where a dedicated code model excels.

> **Sequencing rule: Agent A merges FIRST, then Agent B starts.** Two hard dependencies:
>
> 1. Agent B's port auto-increment (Task B3) only works if the frontend no longer hardcodes `:3001` (Task A6).
> 2. Both agents edit `backend/src/main.rs` — different regions, but never run the two agents concurrently on the same checkout (merge-conflict risk). Use separate worktrees only if the user explicitly wants parallelism; **sequential is the default.**

### 9.1 Agent A — Qwen3.6-35B — "Dashboard UX & macOS Fixes" (Issues 1, 2, 3)

| # | Task | Files | Detail |
| --- | --- | --- | --- |
| A1 | macOS system-info detection | `backend/src/main.rs` (`get_system_info`, ~L1508) | Add `has_xcode_clt` (`xcode-select -p` succeeds), `has_brew`, `has_cmake`. Keep existing `os/arch/has_nvidia/distro` fields; macOS-only additions. |
| A2 | macOS deps banner | `frontend/src/EngineManager.jsx` | `{isMac && ...}` warning box (same style as the Linux one): no CLT → `xcode-select --install`; no brew → Homebrew install command; no cmake → `brew install cmake`. Show only when missing. macOS is compile-only (Q6) → this banner is the primary Mac onboarding. |
| A3 | Arch-filtered Metal engines | `frontend/src/EngineManager.jsx` | `aarch64` → Metal Silicon only; `x86_64` → Metal Intel only; unknown arch → both (fallback). |
| A4 | Intel Metal compile flag | `scripts/engine_manager.js` | `mac-intel` must also get `-DGGML_METAL=ON` (Intel Macs have Metal; today they get a CPU-only build). Keep all other flags unchanged. |
| A5 | Version stamp + `/api/version` | `backend/build.rs`, `backend/src/main.rs`, `frontend/src/App.jsx` (footer) | Embed git SHA + build time (env var injected via build.rs, e.g. `ONYX_VERSION`); new `GET /api/version` → `{"version","git_sha","built_at"}`; subtle footer in the UI. Purpose: make stale binaries instantly visible (root cause of Issue 1). |
| A6 | Relative API base + Vite proxy | `frontend/vite.config.js`, `frontend/src/App.jsx` (+ every component with hardcoded URLs) | Replace all 27 hardcoded `http://127.0.0.1:3001` refs with a relative base; add dev proxy `/api` → `http://127.0.0.1:3001` so dev mode still works. **Unblocks Agent B's port auto-increment (B3).** |
| A7 | Boot error banner | `frontend/src/App.jsx` | Surface failed critical fetches (settings/telemetry/health) as a visible banner instead of `.catch(() => {})` silence; include the API base + "is the backend running / port busy?" hint. |
| A8 | Sidebar CSS hardening | `frontend/src/index.css` | `.left-sidebar { flex-shrink: 0 }`, `.left-pane { min-width: 0 }`, `100dvh` with `100vh` fallback on `.app-container`. Not the root cause — cheap prevention. |

**Agent A file ownership (complete):** `backend/src/main.rs` (only `get_system_info` + new `/api/version` handler + router registration), `backend/build.rs`, `frontend/src/App.jsx`, `frontend/src/EngineManager.jsx`, `frontend/src/index.css`, `frontend/vite.config.js`, `scripts/engine_manager.js`.
**Out of scope for A:** `base_dir()`, boot dir creation, port handling, node resolution, auto-open, any packaging — those are Agent B's.

### 9.2 Agent B — Codestral — "Packaging & Release Automation" (Issues 4, 5)

| # | Task | Files | Detail |
| --- | --- | --- | --- |
| B1 | Exe-relative `base_dir()` | `backend/src/main.rs` (`base_dir`, ~L78) | Resolve base from `std::env::current_exe()` parent. Packaged layout: `<appdir>/` contains `onyx` + `data/ engines/ models/ scripts/`. Dev fallback: existing cwd logic (cwd ends with `backend` → `..`) when the exe-relative layout isn't found (e.g. `target/release/onyx`). Deterministic helper with a comment. |
| B2 | Boot dir creation | `backend/src/main.rs` (`main`, ~L1660) | Auto-create `data/` and `engines/` at boot (models/ already created). `scripts/engine_manager.js` presence check with a clear error if missing. |
| B3 | Port auto-increment | `backend/src/main.rs` (bind, ~L1775) | Try 3001 → 3002 → … cap 3010; print chosen port; friendly error if all busy. **Requires A6 merged** (frontend must not hardcode 3001). |
| B4 | Node resolution + bundling | `backend/src/main.rs` (~L1553, ~L1594) | Helper `node_command()`: prefer `<base>/node` or `<base>/node.exe`, else PATH. Compile scripts bundle a portable Node into the release. |
| B5 | Auto-open browser | `backend/src/main.rs` (`main`) | On successful bind, spawn `open` (macOS) / `xdg-open` (Linux) / `start` (Windows) at the resolved dashboard URL. Env-var opt-out (`ONYX_NO_OPEN=1`) for dev. Packaged mode only. |
| B6 | `compile.sh` (macOS/Linux) | new `compile.sh` + `scripts/package/*` | Version from `git describe --tags --always` (fallback date). Build frontend (`npm ci && npm run build`), backend + rpc_agent (`cargo build --release`). Package: macOS → `.app` bundle (Info.plist template, copy binary + `scripts/ data/ engines/ models/`), optional ad-hoc `codesign -s -` (Q8 — no Developer ID), zip; Linux → `tar.gz` + **AppImage** (Q11) via `appimagetool` (auto-download if missing). Output to `release/` with versioned names; print summary (paths, sizes, manual-upload reminder — Q9). |
| B7 | `compile.bat` (Windows) | new `compile.bat` | Same pipeline; zip via PowerShell `Compress-Archive`; bundle portable `node.exe`. |
| B8 | Launcher cleanup | `onyx.sh`, `onyx.bat` | Fix legacy dev-mode check (`llama-cpp/llama-server` → `engines/`). Optional: add a "Package release" menu item calling `compile.sh`/`compile.bat`. |

**Agent B file ownership (complete):** `backend/src/main.rs` (only `base_dir`, boot sequence, bind, the two node-spawn sites), `compile.sh`, `compile.bat`, `scripts/package/*` (new), `onyx.sh`, `onyx.bat`.
**Out of scope for B:** any `frontend/src/*` changes, `EngineManager.jsx`, `vite.config.js`, `scripts/engine_manager.js` logic — those are Agent A's. (B only *copies* those files into packages.)

### 9.3 Handoff contracts between agents

- `GET /api/version` (A5) → `{"version":"v0.1.0","git_sha":"abc1234","built_at":"ISO8601"}` — B's scripts may read it for the UI but MUST derive artifact names from `git describe` independently (no runtime dependency on the backend).
- Frontend uses **relative `/api/*` paths** after A6 — B's auto-open (B5) must open `http://127.0.0.1:<resolved-port>` and B3 may only ship after A6 is merged.
- `scripts/engine_manager.js` (A4) ships verbatim inside Agent B's packages — B must not change its contents, only include it in the bundle.

### 9.4 Acceptance outline per agent (detailed per-plan later, from plan-template.md)

- **A:** macOS banner shows the correct Homebrew command per missing dep; only the matching Metal engine appears on aarch64 vs x86_64; Intel compile includes `-DGGML_METAL=ON`; `/api/version` returns the stamp; UI footer shows it; dev mode still works through the Vite proxy; boot failures show a banner; sidebar never collapses below its width.
- **B:** binary runs from a double-clicked folder on all 3 OSes (dirs auto-created); port busy → next free port + auto-opened browser at the right URL; engine install works with bundled node and no system Node; `compile.sh`/`compile.bat` produce versioned artifacts for macOS (.app zip), Linux (AppImage + tar.gz), Windows (zip) into `release/`; launcher menu still works.

## 10. Risks & unknowns

- **BLAS bug in ggml prebuilt zips (Q6):** confirmed for macOS (compile-only). Whether the official **Windows/Linux** zips are affected is UNKNOWN — if testers report models failing to load from downloaded engines, Windows/Linux must also move to compile. **Flag to verify during Phase 3 testing; do not silently change the Windows download path.**
- **AppImage sandbox:** llama-server must spawn from inside the AppImage mount point — verify with exe-relative paths during Agent B's testing; fallback is tar.gz + `launch.sh`.
- **macOS first-open warning (Q8 accepted):** no Developer ID → Gatekeeper "unidentified developer" on every release; document the right-click → Open workaround in the README and release notes.
- **Port auto-increment (Q12):** only safe after Agent A's relative-API-base change is merged — enforce the A→B sequencing rule; the 3001-3010 cap must be documented.
- **Node bundling:** adds ~30MB per artifact; the resolution helper (B4) must prefer the bundled node so a user's system node never silently overrides it.
