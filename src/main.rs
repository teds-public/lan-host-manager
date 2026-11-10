mod api;
mod db;
mod models;

use anyhow::Result;
use axum::{
    routing::{get, post, delete, patch},
    Router,
};
use lan_config::Config;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Config,
    pub data_dir: std::path::PathBuf,
    pub projects_dir: std::path::PathBuf,
    pub staging_dir: std::path::PathBuf,
    pub logs_dir: std::path::PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    let data_dir = config.data_dir();

    // Ensure directories exist
    let projects_dir = data_dir.join("projects");
    let staging_dir = data_dir.join("staging");
    let logs_dir = data_dir.join("logs");

    for dir in [&data_dir, &projects_dir, &staging_dir, &logs_dir] {
        std::fs::create_dir_all(dir)?;
    }

    // Initialize database
    let db_path = data_dir.join("app.db");
    let database_url = format!("sqlite:{}?mode=rwc", db_path.display());
    let db = lan_database::init_database(&database_url).await?;

    let state = AppState {
        db,
        config: config.clone(),
        data_dir,
        projects_dir,
        staging_dir,
        logs_dir,
    };

    let app = Router::new()
        .route("/api/health", get(api::health))
        .route("/api/projects", get(api::list_projects))
        .route("/api/projects/:id", get(api::get_project))
        .route("/api/projects/:id/start", post(api::start_project))
        .route("/api/projects/:id/stop", post(api::stop_project))
        .route("/api/projects/:id/restart", post(api::restart_project))
        .route("/api/projects/:id/logs", get(api::get_project_logs))
        .route("/api/projects/:id", patch(api::update_project))
        .route("/api/projects/:id", delete(api::delete_project))
        .route("/api/system/info", get(api::system_info))
        .route("/api/settings", get(api::get_settings))
        .route("/api/settings", post(api::update_settings))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state);

    let addr = format!("{}:{}", config.bind_host, config.dashboard_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!("Dashboard: http://{}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}
