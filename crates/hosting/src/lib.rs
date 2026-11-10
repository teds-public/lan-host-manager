use anyhow::Result;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

lazy_static::lazy_static! {
    static ref STATIC_SERVERS: Arc<Mutex<HashMap<String, ()>>> = Arc::new(Mutex::new(HashMap::new()));
}

pub async fn serve_static(
    id: String,
    dir: PathBuf,
    _port: u16,
    _spa_fallback: bool,
    _host: String,
    log_file: PathBuf,
) -> Result<()> {
    stop_hosting(&id).await;

    lan_process_manager::write_log(
        &log_file,
        "sys",
        &format!("serving static files from {}", dir.display()),
    );

    STATIC_SERVERS.lock().unwrap().insert(id, ());
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
    STATIC_SERVERS.lock().unwrap().remove(id);
    lan_process_manager::stop_managed(id).await;
}

pub fn is_hosting(id: &str, pid: Option<i64>) -> bool {
    STATIC_SERVERS.lock().unwrap().contains_key(id)
        || lan_process_manager::is_running(id, pid)
}

pub fn node_exit_code(id: &str) -> Option<i32> {
    lan_process_manager::get_exit_code(id)
}
