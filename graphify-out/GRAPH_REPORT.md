# Graph Report - /mnt/G/Onyx  (2026-08-10)

## Corpus Check
- Corpus is ~17,541 words - fits in a single context window. You may not need a graph.

## Summary
- 187 nodes · 416 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Rust Backend
- Rust Backend
- Rust Backend
- React Frontend
- React Frontend
- Telemetry & Monitoring
- Miscellaneous 6
- Miscellaneous 7
- Miscellaneous 8

## God Nodes (most connected - your core abstractions)
1. `AppState` - 34 edges
2. `Onyx Project` - 14 edges
3. `StartResponse` - 13 edges
4. `ServerConfig` - 10 edges
5. `get_server_logs()` - 9 edges
6. `start_server()` - 9 edges
7. `spawn_log_reader()` - 8 edges
8. `run_benchmark()` - 8 edges
9. `hf_downloads_status()` - 8 edges
10. `download_engine()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `GitHub Icon` --semantically_similar_to--> `Onyx Project`  [INFERRED] [semantically similar]
  frontend/public/icons.svg → README.md
- `Favicon SVG Icon` --semantically_similar_to--> `Onyx Project`  [INFERRED] [semantically similar]
  frontend/public/favicon.svg → README.md
- `main.jsx` --semantically_similar_to--> `React Frontend`  [INFERRED] [semantically similar]
  frontend/index.html → README.md
- `HTML Entry Point` --references--> `Favicon SVG Icon`  [EXTRACTED]
  frontend/index.html → frontend/public/favicon.svg
- `Favicon SVG Icon` --shares_data_with--> `icons.svg Sprite Sheet`  [EXTRACTED]
  frontend/public/favicon.svg → frontend/public/icons.svg

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Core Project Architecture** — readme_rust_backend, readme_react_frontend, readme_llama_cpp [EXTRACTED 1.00]

## Communities (11 total, 1 thin omitted)

### Community 0 - "Rust Backend"
Cohesion: 0.00
Nodes (39): AsyncGroupChild, ActiveServer, Asset, base_dir(), BenchmarkStatus, CachedModelMetadata, compute_gpu_offloads(), delete_engine() (+31 more)

### Community 1 - "Rust Backend"
Cohesion: 0.00
Nodes (38): AppState, clear_benchmark_logs(), clear_server_logs(), clear_system_logs(), compile_engine(), download_engine(), EngineDownloadPayload, get_benchmark_status() (+30 more)

### Community 2 - "Rust Backend"
Cohesion: 0.00
Nodes (29): HTML Entry Point, main.jsx, React Root Div, Favicon SVG Icon, Bluesky Icon, Discord Icon, Documentation Icon, GitHub Icon (+21 more)

### Community 3 - "React Frontend"
Cohesion: 0.00
Nodes (23): dependencies, lucide-react, react, react-dom, devDependencies, oxlint, vite, @vitejs/plugin-react (+15 more)

### Community 4 - "React Frontend"
Cohesion: 0.00
Nodes (13): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, App(), getTempColor(), getUsageColor() (+5 more)

### Community 5 - "Telemetry & Monitoring"
Cohesion: 0.00
Nodes (13): AppState, get_macos_used_memory(), get_telemetry(), GpuTelemetry, main(), Arc, Json, Mutex (+5 more)

### Community 6 - "Miscellaneous 6"
Cohesion: 0.00
Nodes (12): args, downloadFile(), ENGINE_DIR, ensureDir(), { execSync }, fs, handleCompile(), handleDownload() (+4 more)

### Community 7 - "Miscellaneous 7"
Cohesion: 0.00
Nodes (3): static_handler(), IntoResponse, Uri

## Knowledge Gaps
- **33 isolated node(s):** `Asset`, `$schema`, `oxc`, `react/rules-of-hooks`, `warn` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppState` connect `Rust Backend` to `Rust Backend`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `proxy_handler()` connect `Rust Backend` to `Rust Backend`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `Asset`, `$schema`, `oxc` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Rust Backend` be split into smaller, more focused modules?**
  _Cohesion score 0.11794871794871795 - nodes in this community are weakly interconnected._
- **Should `Rust Backend` be split into smaller, more focused modules?**
  _Cohesion score 0.09852216748768473 - nodes in this community are weakly interconnected._
- **Should `React Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `React Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._