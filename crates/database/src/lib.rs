use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub project_type: String,
    pub status: String,
    pub port: i64,
    pub path: String,
    pub serve_dir: Option<String>,
    pub spa_fallback: i64,
    pub start_command: Option<String>,
    pub install_command: Option<String>,
    pub scripts: Option<String>,
    pub pid: Option<i64>,
    pub last_exit_code: Option<i64>,
    pub log_file: Option<String>,
    pub version: i64,
    pub auto_start: i64,
    pub archive_name: Option<String>,
    pub archive_size: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

pub struct NewProject {
    pub id: String,
    pub name: String,
    pub project_type: String,
    pub port: i64,
    pub path: String,
    pub serve_dir: Option<String>,
    pub spa_fallback: bool,
    pub start_command: Option<String>,
    pub archive_name: Option<String>,
    pub archive_size: Option<i64>,
    pub log_file: Option<String>,
}

pub async fn init_database(database_url: &str) -> Result<SqlitePool> {
    let pool = SqlitePool::connect(database_url).await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;
    Ok(pool)
}

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>> {
    let projects = sqlx::query_as::<_, Project>("SELECT * FROM projects")
        .fetch_all(pool)
        .await?;
    Ok(projects)
}

pub async fn get_project(pool: &SqlitePool, id: &str) -> Result<Option<Project>> {
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(project)
}

pub async fn list_settings(pool: &SqlitePool) -> Result<Vec<Setting>> {
    let settings = sqlx::query_as::<_, Setting>("SELECT * FROM settings")
        .fetch_all(pool)
        .await?;
    Ok(settings)
}

pub async fn insert_project(pool: &SqlitePool, project: &NewProject) -> Result<()> {
    let ts = now();
    sqlx::query(
        "INSERT INTO projects (
            id, name, type, status, port, path, serve_dir, spa_fallback,
            start_command, archive_name, archive_size, log_file, created_at, updated_at
        ) VALUES (?, ?, ?, 'stopped', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&project.id)
    .bind(&project.name)
    .bind(&project.project_type)
    .bind(project.port)
    .bind(&project.path)
    .bind(&project.serve_dir)
    .bind(project.spa_fallback as i64)
    .bind(&project.start_command)
    .bind(&project.archive_name)
    .bind(project.archive_size)
    .bind(&project.log_file)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    pid: Option<i64>,
) -> Result<()> {
    sqlx::query("UPDATE projects SET status = ?, pid = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(pid)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_project(
    pool: &SqlitePool,
    id: &str,
    name: Option<String>,
    serve_dir: Option<String>,
    spa_fallback: Option<bool>,
    start_command: Option<String>,
) -> Result<()> {
    sqlx::query(
        "UPDATE projects SET
            name = COALESCE(?, name),
            serve_dir = COALESCE(?, serve_dir),
            spa_fallback = COALESCE(?, spa_fallback),
            start_command = COALESCE(?, start_command),
            updated_at = ?
        WHERE id = ?",
    )
    .bind(name)
    .bind(serve_dir)
    .bind(spa_fallback.map(|v| v as i64))
    .bind(start_command)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_project(pool: &SqlitePool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reset_running_statuses(pool: &SqlitePool) -> Result<()> {
    sqlx::query("UPDATE projects SET status = 'stopped', pid = NULL WHERE status = 'running'")
        .execute(pool)
        .await?;
    Ok(())
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
