import sys

with open('backend/src/main.rs', 'r') as f:
    content = f.read()

# 1. Add DownloadState to AppState
app_state_idx = content.find('struct AppState {')
if app_state_idx == -1:
    print("AppState not found")
    sys.exit(1)

insert_idx = content.find('}', app_state_idx)
app_state_patch = "    hf_downloads: Mutex<std::collections::HashMap<String, DownloadState>>,\n"
content = content[:insert_idx] + app_state_patch + content[insert_idx:]

# 2. Add DownloadState struct
struct_patch = """
#[derive(Clone, Serialize)]
struct DownloadState {
    repo_id: String,
    filename: String,
    progress: f32,
    status: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct DownloadRequest {
    repo_id: String,
    filename: String,
}

"""
content = content[:app_state_idx] + struct_patch + content[app_state_idx:]

# 3. Initialize hf_downloads in main()
main_idx = content.find('let shared_state = Arc::new(AppState {')
if main_idx == -1:
    print("shared_state init not found")
    sys.exit(1)

main_end_idx = content.find('});', main_idx)
content = content[:main_end_idx] + "        hf_downloads: Mutex::new(std::collections::HashMap::new()),\n" + content[main_end_idx:]

# 4. Add handlers at the bottom before main()
handlers_code = """
#[derive(Deserialize)]
struct HfSearchQuery {
    q: String,
}

async fn hf_search(axum::extract::Query(query): axum::extract::Query<HfSearchQuery>) -> Json<serde_json::Value> {
    let url = format!("https://huggingface.co/api/models?search={}&filter=gguf&limit=20", query.q);
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await;
    match res {
        Ok(r) => {
            if let Ok(json) = r.json::<serde_json::Value>().await {
                Json(json)
            } else {
                Json(serde_json::json!([]))
            }
        },
        Err(_) => Json(serde_json::json!([])),
    }
}

#[derive(Deserialize)]
struct HfModelQuery {
    id: String,
}

async fn hf_model_files(axum::extract::Query(query): axum::extract::Query<HfModelQuery>) -> Json<serde_json::Value> {
    let url = format!("https://huggingface.co/api/models/{}", query.id);
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await;
    match res {
        Ok(r) => {
            if let Ok(json) = r.json::<serde_json::Value>().await {
                Json(json)
            } else {
                Json(serde_json::json!({}))
            }
        },
        Err(_) => Json(serde_json::json!({})),
    }
}

async fn hf_download(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<DownloadRequest>,
) -> Json<StartResponse> {
    let download_id = format!("{}/{}", payload.repo_id, payload.filename);
    {
        let mut downloads = state.hf_downloads.lock().await;
        if downloads.contains_key(&download_id) {
            return Json(StartResponse { success: false, message: "Download already in progress".to_string() });
        }
        downloads.insert(download_id.clone(), DownloadState {
            repo_id: payload.repo_id.clone(),
            filename: payload.filename.clone(),
            progress: 0.0,
            status: "downloading".to_string(),
            error: None,
        });
    }

    let state_clone = state.clone();
    let repo_id = payload.repo_id.clone();
    let filename = payload.filename.clone();
    
    tokio::spawn(async move {
        let url = format!("https://huggingface.co/{}/resolve/main/{}", repo_id, filename);
        let dest_dir = format!("{}/models/{}", base_dir(), repo_id.replace("/", "_"));
        let _ = std::fs::create_dir_all(&dest_dir);
        let dest_path = format!("{}/{}", dest_dir, filename);
        
        let client = reqwest::Client::new();
        match client.get(&url).send().await {
            Ok(mut res) => {
                if res.status().is_success() {
                    let total_size = res.content_length().unwrap_or(0) as f64;
                    if let Ok(mut file) = std::fs::File::create(&dest_path) {
                        use std::io::Write;
                        let mut downloaded: f64 = 0.0;
                        while let Ok(Some(chunk)) = res.chunk().await {
                            if let Err(e) = file.write_all(&chunk) {
                                let mut d = state_clone.hf_downloads.lock().await;
                                if let Some(dl) = d.get_mut(&download_id) {
                                    dl.status = "error".to_string();
                                    dl.error = Some(e.to_string());
                                }
                                return;
                            }
                            downloaded += chunk.len() as f64;
                            if total_size > 0.0 {
                                let mut d = state_clone.hf_downloads.lock().await;
                                if let Some(dl) = d.get_mut(&download_id) {
                                    dl.progress = (downloaded / total_size * 100.0) as f32;
                                }
                            }
                        }
                        let mut d = state_clone.hf_downloads.lock().await;
                        if let Some(dl) = d.get_mut(&download_id) {
                            dl.progress = 100.0;
                            dl.status = "completed".to_string();
                        }
                    } else {
                        let mut d = state_clone.hf_downloads.lock().await;
                        if let Some(dl) = d.get_mut(&download_id) {
                            dl.status = "error".to_string();
                            dl.error = Some("Failed to create file".to_string());
                        }
                    }
                } else {
                    let mut d = state_clone.hf_downloads.lock().await;
                    if let Some(dl) = d.get_mut(&download_id) {
                        dl.status = "error".to_string();
                        dl.error = Some(format!("HTTP {}", res.status()));
                    }
                }
            }
            Err(e) => {
                let mut d = state_clone.hf_downloads.lock().await;
                if let Some(dl) = d.get_mut(&download_id) {
                    dl.status = "error".to_string();
                    dl.error = Some(e.to_string());
                }
            }
        }
    });

    Json(StartResponse { success: true, message: "Download started".to_string() })
}

async fn hf_downloads_status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<std::collections::HashMap<String, DownloadState>> {
    let downloads = state.hf_downloads.lock().await.clone();
    Json(downloads)
}

"""

fn_main_idx = content.find('#[tokio::main]')
if fn_main_idx == -1:
    print("tokio main not found")
    sys.exit(1)

content = content[:fn_main_idx] + handlers_code + content[fn_main_idx:]

# 5. Add routes
router_idx = content.find('let app = Router::new()')
fallback_idx = content.find('.fallback(static_handler)', router_idx)
if fallback_idx == -1:
    print("fallback_handler not found")
    sys.exit(1)

routes_patch = """        .route("/api/huggingface/search", get(hf_search))
        .route("/api/huggingface/model", get(hf_model_files))
        .route("/api/huggingface/download", post(hf_download))
        .route("/api/huggingface/downloads", get(hf_downloads_status))
"""
content = content[:fallback_idx] + routes_patch + content[fallback_idx:]

with open('backend/src/main.rs', 'w') as f:
    f.write(content)

print("Patched successfully")
