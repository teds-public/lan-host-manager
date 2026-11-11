use crate::{models::*, AppState};
use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    Json,
};
use lan_database::Project;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path as FsPath, PathBuf};

type ApiResult<T> = Result<T, (StatusCode, String)>;

fn internal_error(e: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn bad_request(e: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}

fn get_lan_ipv4() -> Vec<String> {
    use std::net::IpAddr;

    let mut ips = Vec::new();

    if let Ok(interfaces) = get_if_addrs::get_if_addrs() {
        for iface in interfaces {
            if let IpAddr::V4(addr) = iface.ip() {
                if !iface.is_loopback() {
                    ips.push(addr.to_string());
                }
            }
        }
    }

    ips
}

fn project_urls(port: i64, bind_host: &str) -> Vec<String> {
    if bind_host != "0.0.0.0" {
        return vec![format!("http://{}:{}", bind_host, port)];
    }

    let ips = get_lan_ipv4();
    if ips.is_empty() {
        return vec![format!("http://localhost:{}", port)];
    }

    ips.into_iter()
        .map(|ip| format!("http://{}:{}", ip, port))
        .collect()
}

fn project_to_response(project: Project, bind_host: &str) -> ProjectResponse {
    ProjectResponse {
        id: project.id,
        name: project.name,
        project_type: project.project_type,
        status: project.status,
        port: project.port,
        path: project.path,
        serve_dir: project.serve_dir,
        spa_fallback: project.spa_fallback != 0,
        start_command: project.start_command,
        install_command: project.install_command,
        scripts: project.scripts,
        pid: project.pid,
        last_exit_code: project.last_exit_code,
        log_file: project.log_file,
        version: project.version,
        auto_start: project.auto_start != 0,
        archive_name: project.archive_name,
        archive_size: project.archive_size,
        created_at: project.created_at,
        updated_at: project.updated_at,
        lan_urls: project_urls(project.port, bind_host),
    }
}

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

pub async fn list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectResponse>>, StatusCode> {
    let projects = lan_database::list_projects(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let responses = projects
        .into_iter()
        .map(|p| project_to_response(p, &state.config.bind_host))
        .collect();

    Ok(Json(responses))
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ProjectResponse>, StatusCode> {
    let project = lan_database::get_project(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(project_to_response(project, &state.config.bind_host)))
}

pub async fn start_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<SuccessResponse>> {
    let project = lan_database::get_project(&state.db, &id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Project not found".to_string()))?;

    if lan_hosting::is_hosting(&id, project.pid) {
        return Ok(Json(SuccessResponse { ok: true }));
    }

    if !lan_ports::is_port_free(project.port as u16, "0.0.0.0").await {
        return Err((
            StatusCode::CONFLICT,
            format!("Port {} is already in use", project.port),
        ));
    }

    let log_file = lan_process_manager::log_file_for(&state.logs_dir, &id);

    match project.project_type.as_str() {
        "static" | "files" => {
            let serve_dir = project.serve_dir.as_deref().unwrap_or(".");
            let full_dir = PathBuf::from(&project.path).join(serve_dir);

            lan_hosting::serve_static(
                id.clone(),
                full_dir,
                project.port as u16,
                project.spa_fallback != 0,
                state.config.bind_host.clone(),
                log_file,
            )
            .await
            .map_err(internal_error)?;

            lan_database::set_status(&state.db, &id, "running", None)
                .await
                .map_err(internal_error)?;
        }
        "node" => {
            let start_cmd = project.start_command.clone().ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    "Project has no start command".to_string(),
                )
            })?;

            let pid = lan_hosting::start_node(
                id.clone(),
                PathBuf::from(&project.path),
                start_cmd,
                project.port as u16,
                state.config.bind_host.clone(),
                log_file,
            )
            .await
            .map_err(internal_error)?;

            lan_database::set_status(&state.db, &id, "running", Some(pid as i64))
                .await
                .map_err(internal_error)?;
        }
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Unknown project type: {}", other),
            ))
        }
    }

    Ok(Json(SuccessResponse { ok: true }))
}

pub async fn stop_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<SuccessResponse>> {
    if lan_database::get_project(&state.db, &id)
        .await
        .map_err(internal_error)?
        .is_none()
    {
        return Err((StatusCode::NOT_FOUND, "Project not found".to_string()));
    }

    lan_hosting::stop_hosting(&id).await;
    lan_database::set_status(&state.db, &id, "stopped", None)
        .await
        .map_err(internal_error)?;

    Ok(Json(SuccessResponse { ok: true }))
}

pub async fn restart_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<SuccessResponse>> {
    if lan_database::get_project(&state.db, &id)
        .await
        .map_err(internal_error)?
        .is_none()
    {
        return Err((StatusCode::NOT_FOUND, "Project not found".to_string()));
    }

    lan_hosting::stop_hosting(&id).await;
    lan_database::set_status(&state.db, &id, "stopped", None)
        .await
        .map_err(internal_error)?;
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;

    start_project(State(state), Path(id)).await
}

pub async fn get_project_logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let log_file = lan_process_manager::log_file_for(&state.logs_dir, &id);
    let logs = lan_process_manager::read_tail(&log_file, 200 * 1024);

    Ok(Json(serde_json::json!({ "logs": logs })))
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectBody {
    pub name: Option<String>,
    #[serde(rename = "serveDir")]
    pub serve_dir: Option<String>,
    #[serde(rename = "spaFallback")]
    pub spa_fallback: Option<bool>,
    #[serde(rename = "startCommand")]
    pub start_command: Option<String>,
}

pub async fn update_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateProjectBody>,
) -> ApiResult<Json<SuccessResponse>> {
    if let Some(dir) = &body.serve_dir {
        if dir.contains("..") || FsPath::new(dir).is_absolute() {
            return Err(bad_request(
                "serveDir must be a relative path inside the project",
            ));
        }
    }

    if lan_database::get_project(&state.db, &id)
        .await
        .map_err(internal_error)?
        .is_none()
    {
        return Err((StatusCode::NOT_FOUND, "Project not found".to_string()));
    }

    lan_database::update_project(
        &state.db,
        &id,
        body.name,
        body.serve_dir,
        body.spa_fallback,
        body.start_command,
    )
    .await
    .map_err(internal_error)?;

    Ok(Json(SuccessResponse { ok: true }))
}

pub async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<SuccessResponse>> {
    let project = lan_database::get_project(&state.db, &id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Project not found".to_string()))?;

    lan_hosting::stop_hosting(&id).await;

    let projects_root = std::fs::canonicalize(&state.projects_dir).map_err(internal_error)?;
    if let Ok(canonical) = std::fs::canonicalize(&project.path) {
        if !canonical.starts_with(&projects_root) {
            return Err(bad_request(
                "Refusing to delete a path outside the projects directory",
            ));
        }
        tokio::fs::remove_dir_all(&canonical)
            .await
            .map_err(internal_error)?;
    }

    if let Some(log_file) = &project.log_file {
        let _ = tokio::fs::remove_file(log_file).await;
    }

    lan_database::delete_project(&state.db, &id)
        .await
        .map_err(internal_error)?;

    Ok(Json(SuccessResponse { ok: true }))
}

const MAX_UPLOAD_BYTES: usize = 512 * 1024 * 1024;

pub async fn upload_project(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> ApiResult<(StatusCode, Json<ProjectResponse>)> {
    let mut uploaded: Option<(String, Vec<u8>)> = None;

    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = field.file_name().unwrap_or_default().to_string();
        let data = field.bytes().await.map_err(bad_request)?.to_vec();
        uploaded = Some((file_name, data));
        break;
    }

    let (file_name, data) = uploaded.ok_or_else(|| bad_request("Missing multipart field 'file'"))?;

    if file_name.is_empty() {
        return Err(bad_request("Uploaded file has no name"));
    }
    if data.is_empty() {
        return Err(bad_request("Uploaded file is empty"));
    }
    if data.len() > MAX_UPLOAD_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Archive is too large".to_string(),
        ));
    }

    lan_archive::validate_archive_name(&file_name).map_err(bad_request)?;

    let id = uuid::Uuid::new_v4().to_string();
    let extension = FsPath::new(&file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("zip");
    let archive_path = state.staging_dir.join(format!("{}.{}", id, extension));

    tokio::fs::write(&archive_path, &data)
        .await
        .map_err(internal_error)?;

    let limits = lan_archive::ExtractLimits {
        max_entries: 20_000,
        max_decompressed_mb: 2048,
        timeout_sec: 120,
    };
    let rar_binary = std::env::var("RAR_BINARY").unwrap_or_default();

    let extracted =
        lan_archive::extract_archive(&archive_path, &state.staging_dir, &rar_binary, &limits)
            .await
            .map_err(bad_request)?;

    let root = project_root(&extracted.out_dir);
    let project_path = state.projects_dir.join(&id);

    if let Err(e) = tokio::fs::rename(&root, &project_path).await {
        let _ = tokio::fs::remove_dir_all(&extracted.out_dir).await;
        let _ = tokio::fs::remove_file(&archive_path).await;
        return Err(internal_error(e));
    }
    let _ = tokio::fs::remove_dir_all(&extracted.out_dir).await;
    let _ = tokio::fs::remove_file(&archive_path).await;

    let detection = lan_detector::detect_project(&project_path);
    let project_type = match detection.project_type {
        lan_detector::ProjectType::Static => "static",
        lan_detector::ProjectType::Node => "node",
        lan_detector::ProjectType::Files => "files",
    };
    let serve_dir = detection.serve_dir_candidates.first().cloned();

    let taken: HashSet<u16> = lan_database::list_projects(&state.db)
        .await
        .map_err(internal_error)?
        .iter()
        .map(|project| project.port as u16)
        .collect();

    let port = lan_ports::find_free_port(
        state.config.port_range_start,
        state.config.port_range_end,
        &taken,
    )
    .await
    .map_err(internal_error)?;

    let name = FsPath::new(&file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("project")
        .to_string();

    let log_file = lan_process_manager::log_file_for(&state.logs_dir, &id)
        .display()
        .to_string();

    let start_command = if project_type == "node" {
        detection
            .scripts
            .as_ref()
            .filter(|scripts| scripts.contains_key("start"))
            .map(|_| "npm start".to_string())
    } else {
        None
    };

    let new_project = lan_database::NewProject {
        id: id.clone(),
        name,
        project_type: project_type.to_string(),
        port: port as i64,
        path: project_path.display().to_string(),
        serve_dir: if project_type == "node" {
            None
        } else {
            serve_dir
        },
        spa_fallback: project_type == "static",
        start_command,
        archive_name: Some(file_name),
        archive_size: Some(data.len() as i64),
        log_file: Some(log_file),
    };

    lan_database::insert_project(&state.db, &new_project)
        .await
        .map_err(internal_error)?;

    let project = lan_database::get_project(&state.db, &id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| internal_error("Project disappeared after insert"))?;

    Ok((
        StatusCode::CREATED,
        Json(project_to_response(project, &state.config.bind_host)),
    ))
}

fn project_root(extracted: &FsPath) -> PathBuf {
    let Ok(entries) = std::fs::read_dir(extracted) else {
        return extracted.to_path_buf();
    };
    let items: Vec<_> = entries.filter_map(|entry| entry.ok()).collect();
    if items.len() == 1 && items[0].path().is_dir() {
        items[0].path()
    } else {
        extracted.to_path_buf()
    }
}

pub async fn system_info(State(state): State<AppState>) -> Json<SystemInfo> {
    Json(SystemInfo {
        lan_ips: get_lan_ipv4(),
        dashboard_port: state.config.dashboard_port,
        bind_host: state.config.bind_host.clone(),
        port_range: (state.config.port_range_start, state.config.port_range_end),
        paths: Paths {
            data_dir: state.data_dir.display().to_string(),
            projects_dir: state.projects_dir.display().to_string(),
            staging_dir: state.staging_dir.display().to_string(),
            logs_dir: state.logs_dir.display().to_string(),
        },
    })
}

pub async fn get_settings(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let settings = lan_database::list_settings(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let map: std::collections::HashMap<String, String> = settings
        .into_iter()
        .map(|s| (s.key, s.value))
        .collect();

    Ok(Json(serde_json::to_value(map).unwrap()))
}

pub async fn update_settings(
    State(_state): State<AppState>,
    Json(_body): Json<serde_json::Value>,
) -> Json<SuccessResponse> {
    // TODO: Implement settings update
    Json(SuccessResponse { ok: true })
}
