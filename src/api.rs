use crate::{models::*, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use lan_database::Project;

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
) -> Result<Json<SuccessResponse>, StatusCode> {
    let project = lan_database::get_project(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Check if already running
    if lan_hosting::is_hosting(&id, project.pid) {
        return Ok(Json(SuccessResponse { ok: true }));
    }

    // Check port availability
    if !lan_ports::is_port_free(project.port as u16, "0.0.0.0").await {
        return Err(StatusCode::CONFLICT);
    }

    let log_file = lan_process_manager::log_file_for(&state.logs_dir, &id);

    // Start based on project type
    match project.project_type.as_str() {
        "static" | "files" => {
            let serve_dir = project.serve_dir.as_deref().unwrap_or(".");
            let full_dir = std::path::PathBuf::from(&project.path).join(serve_dir);

            lan_hosting::serve_static(
                id.clone(),
                full_dir,
                project.port as u16,
                project.spa_fallback != 0,
                state.config.bind_host.clone(),
                log_file,
            )
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        "node" => {
            let start_cmd = project
                .start_command
                .ok_or(StatusCode::BAD_REQUEST)?;

            lan_hosting::start_node(
                id.clone(),
                std::path::PathBuf::from(&project.path),
                start_cmd,
                project.port as u16,
                state.config.bind_host.clone(),
                log_file,
            )
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        _ => return Err(StatusCode::BAD_REQUEST),
    }

    Ok(Json(SuccessResponse { ok: true }))
}

pub async fn stop_project(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Json<SuccessResponse> {
    lan_hosting::stop_hosting(&id).await;
    Json(SuccessResponse { ok: true })
}

pub async fn restart_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, StatusCode> {
    lan_hosting::stop_hosting(&id).await;
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

pub async fn update_project(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
    Json(_body): Json<serde_json::Value>,
) -> Json<SuccessResponse> {
    // TODO: Implement update logic
    Json(SuccessResponse { ok: true })
}

pub async fn delete_project(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Json<SuccessResponse> {
    lan_hosting::stop_hosting(&id).await;
    // TODO: Implement delete logic
    Json(SuccessResponse { ok: true })
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
