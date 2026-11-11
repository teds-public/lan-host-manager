#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod api;
mod models;
#[cfg(target_os = "windows")]
mod tray;

use anyhow::Result;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post, delete, patch},
    Router,
};
use lan_config::Config;
use sqlx::SqlitePool;
use tower_http::{
    cors::{CorsLayer, Any},
    services::{ServeDir, ServeFile},
};
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

fn main() {
    if let Err(error) = run() {
        let data_dir = lan_config::default_data_dir();
        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::write(
            data_dir.join("startup-error.log"),
            format!("{:#}\n", error),
        );
        std::process::exit(1);
    }
}

#[tokio::main]
async fn run() -> Result<()> {
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
    lan_database::reset_running_statuses(&db).await?;

    let state = AppState {
        db,
        config: config.clone(),
        data_dir,
        projects_dir,
        staging_dir,
        logs_dir,
    };

    let frontend_dist = frontend_dist_dir();
    if !frontend_dist.join("index.html").is_file() {
        tracing::warn!(
            "Frontend build not found at {}; run trunk build first",
            frontend_dist.display()
        );
    }

    let app = Router::new()
        .route("/api/health", get(api::health))
        .route("/api/projects", get(api::list_projects))
        .route(
            "/api/projects/upload",
            post(api::upload_project)
                .layer(DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
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
        .fallback_service(
            ServeDir::new(&frontend_dist)
                .fallback(ServeFile::new(frontend_dist.join("index.html"))),
        )
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state);

    let addr = format!("{}:{}", config.bind_host, config.dashboard_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!("Dashboard: http://{}", addr);

    #[cfg(target_os = "windows")]
    tray::spawn(format!("http://localhost:{}", config.dashboard_port));

    axum::serve(listener, app).await?;

    Ok(())
}

fn frontend_dist_dir() -> std::path::PathBuf {
    let from_cwd = std::path::PathBuf::from("frontend/dist");
    if from_cwd.is_dir() {
        return from_cwd;
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            if exe_dir.join("index.html").is_file() {
                return exe_dir.to_path_buf();
            }
            let beside_exe = exe_dir.join("dist");
            if beside_exe.is_dir() {
                return beside_exe;
            }
            if let Some(repo_root) = exe_dir.ancestors().nth(2) {
                let from_repo = repo_root.join("frontend/dist");
                if from_repo.is_dir() {
                    return from_repo;
                }
            }
        }
    }

    from_cwd
}
