use anyhow::Result;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    #[serde(default = "default_dashboard_port")]
    pub dashboard_port: u16,

    #[serde(default = "default_bind_host")]
    pub bind_host: String,

    #[serde(default = "default_port_range_start")]
    pub port_range_start: u16,

    #[serde(default = "default_port_range_end")]
    pub port_range_end: u16,

    pub data_dir: Option<PathBuf>,
}

fn default_dashboard_port() -> u16 { 5000 }
fn default_bind_host() -> String { "0.0.0.0".to_string() }
fn default_port_range_start() -> u16 { 4100 }
fn default_port_range_end() -> u16 { 4999 }

impl Default for Config {
    fn default() -> Self {
        Self {
            dashboard_port: default_dashboard_port(),
            bind_host: default_bind_host(),
            port_range_start: default_port_range_start(),
            port_range_end: default_port_range_end(),
            data_dir: None,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let dashboard_port = std::env::var("DASHBOARD_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(default_dashboard_port);

        let bind_host = std::env::var("BIND_HOST")
            .unwrap_or_else(|_| default_bind_host());

        let port_range_start = std::env::var("PORT_RANGE_START")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(default_port_range_start);

        let port_range_end = std::env::var("PORT_RANGE_END")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(default_port_range_end);

        let data_dir = std::env::var("DATA_DIR")
            .ok()
            .map(PathBuf::from);

        Ok(Self {
            dashboard_port,
            bind_host,
            port_range_start,
            port_range_end,
            data_dir,
        })
    }

    pub fn data_dir(&self) -> PathBuf {
        self.data_dir.clone().unwrap_or_else(default_data_dir)
    }
}

pub fn default_data_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("LanHostManager")
    } else {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("lanhostmanager")
    }
}
