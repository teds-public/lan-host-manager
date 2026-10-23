import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export * from "./schema.js";

export function openDatabase(dbFile: string): { raw: Database.Database; db: BetterSQLite3Database } {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const raw = new Database(dbFile);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  return { raw, db: drizzle(raw) };
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'stopped', port INTEGER NOT NULL UNIQUE,
    path TEXT NOT NULL, serve_dir TEXT, spa_fallback INTEGER NOT NULL DEFAULT 0,
    start_command TEXT, install_command TEXT, scripts TEXT, pid INTEGER, last_exit_code INTEGER,
    log_file TEXT, version INTEGER NOT NULL DEFAULT 1, auto_start INTEGER NOT NULL DEFAULT 0,
    archive_name TEXT, archive_size INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );`,
];

export function migrate(raw: Database.Database): void {
  for (const sql of MIGRATIONS) raw.exec(sql);
  const cols = raw.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "scripts")) {
    raw.exec("ALTER TABLE projects ADD COLUMN scripts TEXT");
  }
}
