## Goal Description
The objective is to fix a series of persistent bugs impacting the UI state, GPU detection, configuration hydration, system logs, and model loading. Additionally, we will introduce a new Master Gateway switch in the dashboard top bar and overhaul the model loading heuristic to parse `llama-server` stdout/stderr directly instead of relying on VRAM deltas, which is inaccurate for CPU-only or partial loads.

## Proposed Changes

### `G:\LocalLLM\frontend\src\App.jsx`
- **GPU Detection**: Extract `fetchTelemetry` so it executes on a global interval regardless of the active tab. This ensures `config.localGpus` is populated immediately upon load.
- **Global Settings Bug**: Inject a `useEffect` hook on mount to execute `fetch('http://127.0.0.1:3001/api/settings')`. The result will correctly merge into `serverSettings` state to fix the `networkHost` visual inconsistency.
- **Master Gateway UI**: Render a new toggle button (Running/Stopped) directly to the left of the "Active Models" counter in the top bar. This will trigger the existing `toggleProxy` logic.
- **Load Model Button**: Ensure that `activeServers` and model loading states correctly bubble up. The backend crash/silent failure will be resolved via the backend `stderr` parser.

### `G:\LocalLLM\backend\src\main.rs`
- **System Logs for Network API**: In `update_network_config`, append formatted logs to `state.system_logs` so that port changes and network host toggles are explicitly visible in the Developer Logs view.
- **Progress Bar Tracking Heuristic**: 
  - Remove the VRAM usage differential calculation inside `get_server_status`.
  - Inside the `start_server` process stdout/stderr listener threads, add a regex or substring parser for `llm_load_tensors:`. 
  - When a line like `llm_load_tensors:   45%` is captured, explicitly parse the integer and assign it directly to `server.progress`. This provides exact physical loading metrics even if the model is loading exclusively on CPU RAM.
  - Also capture `error` strings and push them to system logs if `llama-server` instantly crashes, explaining the "nothing happens" behavior.

## Verification Plan

### Manual Verification
1. Open the dashboard.
2. Verify the Gateway: Running/Stopped toggle is present in the header.
3. Toggle the network host in settings; verify the System Logs tab outputs the explicit change.
4. Go to a model's Devices tab without opening Monitoring first. Verify GPUs are present.
5. Load a model. Verify the progress bar smoothly reflects actual loading percentages rather than jumping.
