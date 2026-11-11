use anyhow::{bail, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone)]
pub struct ExtractLimits {
    pub max_entries: usize,
    pub max_decompressed_mb: usize,
    pub timeout_sec: u64,
}

#[derive(Debug, Clone)]
pub struct ExtractResult {
    pub out_dir: PathBuf,
    pub root_dir: PathBuf,
    pub entries: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Rar,
    Zip,
}

pub fn detect_archive_kind(name: &str) -> Result<ArchiveKind> {
    let lower = name.to_lowercase();
    if lower.ends_with(".zip") {
        return Ok(ArchiveKind::Zip);
    }
    if lower.ends_with(".rar") {
        return Ok(ArchiveKind::Rar);
    }
    bail!("Only .rar and .zip archives are accepted");
}

pub fn validate_archive_name(name: &str) -> Result<()> {
    detect_archive_kind(name)?;
    Ok(())
}

fn is_safe_entry(name: &str) -> bool {
    let n = name.replace('\\', "/");

    // Reject absolute paths
    if n.starts_with('/') || n.contains(':') {
        return false;
    }

    // Check for path traversal
    let parts: Vec<&str> = n.split('/').collect();
    let mut depth = 0;
    for part in parts {
        if part == ".." {
            depth -= 1;
            if depth < 0 {
                return false;
            }
        } else if !part.is_empty() && part != "." {
            depth += 1;
        }
    }
    true
}

fn is_junk_entry(rel: &str) -> bool {
    let patterns = [
        "__MACOSX",
        ".DS_Store",
        "Thumbs.db",
        "desktop.ini",
        ".Spotlight-V100",
        ".Trashes",
        ".fseventsd",
    ];

    let normalized = rel.replace('\\', "/");
    for pattern in &patterns {
        if normalized.contains(pattern) {
            return true;
        }
    }
    false
}

fn strip_junk_entries(out_dir: &Path) -> Result<()> {
    fn walk(dir: &Path, out_dir: &Path) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let rel = path.strip_prefix(out_dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            if is_junk_entry(&entry.file_name().to_string_lossy()) || is_junk_entry(&rel) {
                let _ = fs::remove_dir_all(&path);
            } else if path.is_dir() {
                walk(&path, out_dir)?;
            }
        }
        Ok(())
    }
    walk(out_dir, out_dir)
}

fn check_limits(entries: usize, total_bytes: usize, limits: &ExtractLimits) -> Result<()> {
    if entries > limits.max_entries {
        bail!(
            "Archive has {} entries, over the limit of {}",
            entries,
            limits.max_entries
        );
    }

    let max_bytes = limits.max_decompressed_mb * 1024 * 1024;
    if total_bytes > max_bytes {
        bail!(
            "Decompressed size exceeds {} MB limit",
            limits.max_decompressed_mb
        );
    }

    Ok(())
}

pub async fn extract_zip(
    archive_path: &Path,
    staging_dir: &Path,
    limits: &ExtractLimits,
) -> Result<ExtractResult> {
    let file = fs::File::open(archive_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    let entry_count = archive.len();
    let mut total_size = 0u64;

    // Pre-check sizes
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        total_size += file.size();
    }

    check_limits(entry_count, total_size as usize, limits)?;

    let out_dir = staging_dir.join(format!("extract-{}", chrono::Utc::now().timestamp()));
    fs::create_dir_all(&out_dir)?;

    let mut written = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();

        if !is_safe_entry(&name) {
            continue;
        }

        if is_junk_entry(&name) {
            continue;
        }

        // Skip symlinks
        if file.is_symlink() {
            continue;
        }

        let outpath = out_dir.join(&name);

        if file.is_dir() {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                fs::create_dir_all(p)?;
            }

            let mut outfile = fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
            written.push(name);
        }
    }

    strip_junk_entries(&out_dir)?;

    Ok(ExtractResult {
        out_dir: out_dir.clone(),
        root_dir: out_dir,
        entries: written.len(),
    })
}

fn resolve_rar_binary(configured: &str) -> Option<PathBuf> {
    let exe_names = ["Rar.exe", "UnRAR.exe", "unrar", "rar", "WinRAR.exe"];

    let mut candidates = Vec::new();

    if !configured.is_empty() {
        let path = Path::new(configured);
        if let Some(dir) = path.parent() {
            for exe in &["Rar.exe", "UnRAR.exe"] {
                let sibling = dir.join(exe);
                if sibling.exists() {
                    candidates.push(sibling);
                }
            }
        }
        candidates.push(path.to_path_buf());
    }

    for name in &exe_names {
        candidates.push(PathBuf::from(name));
    }

    for candidate in &candidates {
        if candidate.is_absolute() && candidate.exists() {
            return Some(candidate.clone());
        }
    }

    candidates.first().cloned()
}

pub async fn extract_rar(
    archive_path: &Path,
    staging_dir: &Path,
    rar_binary: &str,
    limits: &ExtractLimits,
) -> Result<ExtractResult> {
    let bin = resolve_rar_binary(rar_binary).ok_or_else(|| {
        anyhow::anyhow!(
            "No RAR extraction utility found. Install WinRAR (Windows) or unrar (Linux: apt install unrar), then set the rarBinary path in Settings."
        )
    })?;

    let out_dir = staging_dir.join(format!("extract-{}", chrono::Utc::now().timestamp()));
    fs::create_dir_all(&out_dir)?;

    let out_dir_str = out_dir.to_string_lossy().to_string() + std::path::MAIN_SEPARATOR_STR;

    let extract_future = Command::new(&bin)
        .args(["x", "-o+"])
        .arg(archive_path)
        .arg(&out_dir_str)
        .output();

    let output = timeout(Duration::from_secs(limits.timeout_sec), extract_future)
        .await
        .map_err(|_| anyhow::anyhow!("Extraction timed out after {}s", limits.timeout_sec))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Extraction failed: {}", &stderr[..stderr.len().min(500)]);
    }

    // Count and validate entries
    let mut entries = Vec::new();
    let mut total_size = 0;

    fn walk(dir: &Path, out_dir: &Path, entries: &mut Vec<String>, total: &mut usize) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let rel = path.strip_prefix(out_dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            if !is_safe_entry(&rel) {
                let _ = fs::remove_dir_all(&path);
                continue;
            }

            // Remove symlinks
            if entry.file_type()?.is_symlink() {
                let _ = fs::remove_file(&path);
                continue;
            }

            if entry.file_type()?.is_dir() {
                walk(&path, out_dir, entries, total)?;
            } else {
                *total += entry.metadata()?.len() as usize;
                entries.push(rel);
            }
        }
        Ok(())
    }

    walk(&out_dir, &out_dir, &mut entries, &mut total_size)?;
    strip_junk_entries(&out_dir)?;
    check_limits(entries.len(), total_size, limits)?;

    Ok(ExtractResult {
        out_dir: out_dir.clone(),
        root_dir: out_dir,
        entries: entries.len(),
    })
}

pub async fn extract_archive(
    archive_path: &Path,
    staging_dir: &Path,
    rar_binary: &str,
    limits: &ExtractLimits,
) -> Result<ExtractResult> {
    let kind = detect_archive_kind(&archive_path.to_string_lossy())?;

    match kind {
        ArchiveKind::Zip => extract_zip(archive_path, staging_dir, limits).await,
        ArchiveKind::Rar => extract_rar(archive_path, staging_dir, rar_binary, limits).await,
    }
}
