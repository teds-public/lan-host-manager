-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'stopped',
    port INTEGER NOT NULL UNIQUE,
    path TEXT NOT NULL,
    serve_dir TEXT,
    spa_fallback INTEGER NOT NULL DEFAULT 0,
    start_command TEXT,
    install_command TEXT,
    scripts TEXT,
    pid INTEGER,
    last_exit_code INTEGER,
    log_file TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    auto_start INTEGER NOT NULL DEFAULT 0,
    archive_name TEXT,
    archive_size INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
