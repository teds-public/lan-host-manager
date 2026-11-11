use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub project_type: String,
    pub status: String,
    pub port: i64,
    pub path: String,
    #[serde(rename = "serveDir")]
    pub serve_dir: Option<String>,
    #[serde(rename = "spaFallback")]
    pub spa_fallback: bool,
    #[serde(rename = "startCommand")]
    pub start_command: Option<String>,
    #[serde(rename = "installCommand")]
    pub install_command: Option<String>,
    pub scripts: Option<String>,
    pub pid: Option<i64>,
    #[serde(rename = "lastExitCode")]
    pub last_exit_code: Option<i64>,
    #[serde(rename = "logFile")]
    pub log_file: Option<String>,
    pub version: i64,
    #[serde(rename = "autoStart")]
    pub auto_start: bool,
    #[serde(rename = "archiveName")]
    pub archive_name: Option<String>,
    #[serde(rename = "archiveSize")]
    pub archive_size: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "lanUrls")]
    pub lan_urls: Vec<String>,
}
