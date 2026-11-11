use crate::types::*;
use gloo_net::http::{Request, Response};
use serde::de::DeserializeOwned;

const API_BASE: &str = "/api";

pub async fn fetch_projects() -> Result<Vec<Project>, String> {
    fetch_json(&format!("{}/projects", API_BASE)).await
}

pub async fn upload_archive(file: &web_sys::File) -> Result<Project, String> {
    let form = web_sys::FormData::new().map_err(|_| "Cannot build upload form".to_string())?;
    form.append_with_blob("file", file)
        .map_err(|_| "Cannot attach file".to_string())?;

    let response = Request::post(&format!("{}/projects/upload", API_BASE))
        .body(form)
        .map_err(|e| format!("Request failed: {}", e))?
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.ok() {
        return Err(error_text(response).await);
    }

    response
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))
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

pub async fn delete_project(id: &str) -> Result<(), String> {
    let response = Request::delete(&format!("{}/projects/{}", API_BASE, id))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.ok() {
        return Err(error_text(response).await);
    }

    Ok(())
}

pub async fn fetch_logs(id: &str) -> Result<String, String> {
    let value: serde_json::Value =
        fetch_json(&format!("{}/projects/{}/logs", API_BASE, id)).await?;

    Ok(value
        .get("logs")
        .and_then(|logs| logs.as_str())
        .unwrap_or_default()
        .to_string())
}

async fn fetch_json<T: DeserializeOwned>(url: &str) -> Result<T, String> {
    let response = Request::get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.ok() {
        return Err(error_text(response).await);
    }

    response
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))
}

async fn post_json<T: serde::Serialize>(url: &str, body: &T) -> Result<(), String> {
    let response = Request::post(url)
        .json(body)
        .map_err(|e| format!("Serialization failed: {}", e))?
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.ok() {
        return Err(error_text(response).await);
    }

    Ok(())
}

async fn error_text(response: Response) -> String {
    let status = response.status();
    match response.text().await {
        Ok(text) if !text.is_empty() => text,
        _ => format!("Request failed with status {}", status),
    }
}
