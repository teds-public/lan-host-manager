use crate::types::*;
use gloo_net::http::Request;
use serde::de::DeserializeOwned;

const API_BASE: &str = "/api";

pub async fn fetch_projects() -> Result<Vec<Project>, String> {
    fetch_json(&format!("{}/projects", API_BASE)).await
}

pub async fn fetch_project(id: &str) -> Result<Project, String> {
    fetch_json(&format!("{}/projects/{}", API_BASE, id)).await
}

pub async fn start_project(id: &str) -> Result<(), String> {
    post_json(&format!("{}/projects/{}/start", API_BASE, id), &()).await
}

pub async fn stop_project(id: &str) -> Result<(), String> {
    post_json(&format!("{}/projects/{}/stop", API_BASE, id), &()).await
}

pub async fn restart_project(id: &str) -> Result<(), String> {
    post_json(&format!("{}/projects/{}/restart", API_BASE, id), &()).await
}

pub async fn fetch_system_info() -> Result<SystemInfo, String> {
    fetch_json(&format!("{}/system/info", API_BASE)).await
}

async fn fetch_json<T: DeserializeOwned>(url: &str) -> Result<T, String> {
    Request::get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))
}

async fn post_json<T: serde::Serialize>(url: &str, body: &T) -> Result<(), String> {
    Request::post(url)
        .json(body)
        .map_err(|e| format!("Serialization failed: {}", e))?
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    Ok(())
}
