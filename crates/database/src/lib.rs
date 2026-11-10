use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
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

pub async fn init_database(database_url: &str) -> Result<SqlitePool> {
    let pool = SqlitePool::connect(database_url).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
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

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
