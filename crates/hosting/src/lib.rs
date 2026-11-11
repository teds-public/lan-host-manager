use anyhow::Result;
use axum::Router;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
};

type Servers = Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>;

lazy_static::lazy_static! {
    static ref STATIC_SERVERS: Servers = Arc::new(Mutex::new(HashMap::new()));
}

pub async fn serve_static(
    id: String,
    dir: PathBuf,
    port: u16,
    spa_fallback: bool,
    host: String,
    log_file: PathBuf,
) -> Result<()> {
    stop_hosting(&id).await;

    let service = ServeDir::new(&dir);
    let app = if spa_fallback {
        Router::new().fallback_service(service.fallback(ServeFile::new(dir.join("index.html"))))
    } else {
        Router::new().fallback_service(service)
    }
    .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any));

    let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port)).await?;
    let (tx, rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });

    STATIC_SERVERS.lock().unwrap().insert(id, tx);

    lan_process_manager::write_log(
        &log_file,
        "sys",
        &format!("serving {} on {}:{}", dir.display(), host, port),
    );

    Ok(())
}

pub async fn start_node(
    id: String,
    cwd: PathBuf,
    start_command: String,
    port: u16,
    host: String,
    log_file: PathBuf,
) -> Result<u32> {
    stop_hosting(&id).await;

    let parts: Vec<String> = start_command
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    if parts.is_empty() {
        anyhow::bail!("Invalid start command");
    }

    let cmd = parts[0].clone();
    let args = parts[1..].to_vec();

    // Security check
    if start_command.contains(';')
        || start_command.contains('&')
        || start_command.contains('|')
        || start_command.contains('`')
        || start_command.contains('$')
    {
        anyhow::bail!("Invalid start command");
    }

    let mut env = HashMap::new();
    env.insert("PORT".to_string(), port.to_string());
    env.insert("HOST".to_string(), host);

    let pid = lan_process_manager::start_managed(id.clone(), cmd, args, cwd, env, log_file).await?;

    Ok(pid)
}

pub async fn stop_hosting(id: &str) {
    if let Some(tx) = STATIC_SERVERS.lock().unwrap().remove(id) {
        let _ = tx.send(());
    }
    lan_process_manager::stop_managed(id).await;
}

pub fn is_hosting(id: &str, pid: Option<i64>) -> bool {
    STATIC_SERVERS.lock().unwrap().contains_key(id)
        || lan_process_manager::is_running(id, pid)
}

pub fn node_exit_code(id: &str) -> Option<i32> {
    lan_process_manager::get_exit_code(id)
}
