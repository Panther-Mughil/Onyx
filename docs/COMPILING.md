# Building Onyx from Source

Onyx is built using a combination of **React/Vite** for the frontend and **Rust** for the backend engine manager. You can easily compile the main application and the standalone RPC agent for any platform.

## Prerequisites

Before compiling Onyx or the RPC Agent, you need to have the following tools installed on your system:

1. **Node.js** (v18 or higher) - For compiling the React frontend.
2. **Rust** (latest stable) - For compiling the backend and RPC agent.
3. **Git** - Used for injecting version control information into the binaries.

## 1. Compiling the Main Application

The main Onyx application is bundled into a single standalone folder or package (depending on your OS) containing the compiled backend binary, the frontend (served from the backend), and any necessary scripts.

To build Onyx, simply run the compilation script for your platform from the root of the repository:

### Linux / macOS
```bash
./compile.sh
```
This will create a `release/` directory containing:
* **Linux:** A `.tar.gz` package and a `.AppImage` (if `appimagetool` is available).
* **macOS:** A `.zip` containing `Onyx.app` which you can move to your `/Applications` folder.

### Windows
```bat
compile.bat
```
This will create a `release/` directory containing a `.zip` file with the compiled `onyx.exe` and its required folders.

## 2. Compiling the Standalone RPC Agent

If you are setting up a distributed cluster, you will need to run the **Onyx RPC Agent** on your remote worker machines. The RPC Agent is a lightweight Rust binary that listens for tasks from the main Onyx application.

We provide dedicated scripts to compile *just* the RPC agent without needing to compile the frontend or the main application.

### Linux / macOS
```bash
./build_rpc.sh
```
This will create a `release/rpc/` directory containing the standalone package (either a `.tar.gz` or a `.zip`).

### Windows
```bat
build_rpc.bat
```
This will create a `release/rpc/` directory containing a `.zip` with the compiled `rpc_agent.exe`.

## Advanced: Manual Compilation

If you prefer to compile the components manually during development, you can do so as follows:

### Frontend
```bash
cd frontend
npm install
npm run build
```
*(The `frontend/dist` directory will be embedded into the backend binary during the next `cargo build`.)*

### Backend
```bash
cd backend
cargo build --release
```
*(The binary will be available at `backend/target/release/onyx`)*

### RPC Agent
```bash
cd rpc_agent
cargo build --release
```
*(The binary will be available at `rpc_agent/target/release/rpc_agent`)*
