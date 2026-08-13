# Onyx Project Plan & Review

## 1. Project Audit & Developer Experience
First, I want to address your feelings about the codebase. It's incredibly common to feel a sense of "imposter syndrome" or mistrust when an AI (especially a local model) generates a large portion of a working application. You described feeling like the code is broken or untrustworthy because you didn't hand-write every line, which caused you to step away from the project. 

**Here's the reality:** The code is working well. The fact that you successfully guided DeepSeek v4 to plan the architecture and Qwen 3.6 35B to implement it is a huge win. Local models are powerful, cost-effective tools. You shouldn't feel guilty for using them to save your quota! The code they produced is yours, and the best way to build trust in it is to review, refine, and document it—which is exactly what we are going to do.

Regarding your tooling: You mentioned forcing yourself to use the "Pi coding harness" even though you prefer "opencode" and its UI, because of things you've heard. **Use the tools that make you productive and happy.** If opencode gives you a better experience and less friction, use it. Don't force yourself into a workflow you hate just because it's popular or uses fewer tokens. Your mental energy is better spent on the project itself.

---

## 2. Feature Implementation & Fixes Plan

Below is the actionable plan to address the three main issues you've identified. We will tackle these one by one in future sessions.

### Phase 1: Polishing the Port Auto-Increment Feature
**Current State:** The backend automatically increments the port (e.g., from 3001 to 3002) if 3001 is in use. This is a great feature, but the frontend currently detects this as a failure and displays a dismissible red "Boot error" banner, which feels accidental and jarring. 
**The Plan:**
*   **Formalize the Feature:** We will update the frontend logic (`frontend/src/App.jsx`) to handle port fallback gracefully.
*   **UI Update:** Instead of a red error banner, we will change this to a non-intrusive informational banner (e.g., blue or yellow) that says something like: *"Port 3001 was in use. Onyx started successfully on port 3002."*
*   **Result:** You get to keep the useful auto-increment feature, but it will feel intentional, polished, and user-friendly.

### Phase 2: App Icons for macOS and Linux
**Current State:** The compiled binaries run perfectly, but they use the default system icon (e.g., the blank app icon on macOS) because the icon files aren't being correctly bundled during the compile scripts.
**The Plan:**
*   **macOS (`.app` bundle):** We need to generate an `.icns` file from your project logo. We will update `compile.sh` to copy this `icon.icns` into `Onyx.app/Contents/Resources/` and modify the `Info.plist` to explicitly reference it using the `CFBundleIconFile` key.
*   **Linux (AppImage):** We will ensure a high-resolution `.png` or `.svg` icon is placed at the root of the AppDir and correctly referenced in the `Onyx.desktop` file during the AppImage creation in `compile.sh`.
*   **Windows (`.exe`):** The `backend/build.rs` is already using `winres` to attach `icon.ico`. We will just verify it's working as expected.

### Phase 3: RPC Agent Compilation & Developer Documentation
**Current State:** The `rpc_agent` works, but the compilation process is bundled into the main `compile.sh` script, mixing the dev environment with the build pipeline in a way that feels clumsy. Furthermore, there is no public-facing documentation explaining how users can compile the RPC agent or the main app themselves.
**The Plan:**
*   **Decouple Compilation:** We will update the compilation scripts (`compile.sh` / `compile.bat`) or create dedicated scripts (e.g., `build_rpc.sh`) so that users can easily build *just* the RPC agent without needing to compile the entire Onyx frontend/backend ecosystem.
*   **Create `docs/COMPILING.md`:** We will write a comprehensive, step-by-step guide on how to build Onyx from source. This will cover:
    *   Prerequisites (Rust, Node.js, etc.)
    *   Building the main Onyx Application for Windows, macOS (Apple Silicon), and Linux.
    *   Building the standalone RPC Agent for distributed setups.
*   **Result:** The repository will feel much cleaner, open-source friendly, and you won't have to deal with a clumsy all-in-one build environment when you only want to work on one component.

---

### Next Steps
Whenever you are ready to jump back in, just let me know which Phase you want to tackle first! You've built something genuinely cool here; let's polish it up and get it ready for release.
