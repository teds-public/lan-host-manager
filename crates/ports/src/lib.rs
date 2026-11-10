use anyhow::Result;
use std::collections::HashSet;
use tokio::net::TcpListener;

pub async fn is_port_free(port: u16, host: &str) -> bool {
    TcpListener::bind(format!("{}:{}", host, port))
        .await
        .is_ok()
}

pub async fn find_free_port(
    start: u16,
    end: u16,
    taken: &HashSet<u16>,
) -> Result<u16> {
    for port in start..=end {
        if taken.contains(&port) {
            continue;
        }
        if is_port_free(port, "0.0.0.0").await {
            return Ok(port);
        }
    }
    anyhow::bail!("No free port in range {}-{}", start, end)
}
