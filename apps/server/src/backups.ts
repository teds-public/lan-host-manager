import { eq } from "drizzle-orm";
import * as dbSchema from "@lan/database";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.js";
import { now } from "./store.js";

export interface BackupRecord {
  id: string;
  version: number;
  path: string;
}

export function listBackupRows(store: Store, projectId: string) {
  return store.db.select().from(dbSchema.backups)
    .where(eq(dbSchema.backups.projectId, projectId)).all()
    .sort((a, b) => b.version - a.version);
}

export function createBackup(store: Store, projectId: string, version: number, sourcePath: string): BackupRecord {
  const backupDir = path.join(store.backupsDir, projectId, `v${version}-${Date.now()}`);
  fs.mkdirSync(path.dirname(backupDir), { recursive: true });
  fs.cpSync(sourcePath, backupDir, { recursive: true });
  const backupId = randomUUID();
  store.db.insert(dbSchema.backups).values({
    id: backupId, projectId, path: backupDir, version, createdAt: now(),
  }).run();
  pruneBackups(store, projectId);
  return { id: backupId, version, path: backupDir };
}

export function pruneBackups(store: Store, projectId: string, keep = 5): void {
  for (const extra of listBackupRows(store, projectId).slice(keep)) {
    fs.rmSync(extra.path, { recursive: true, force: true });
    store.db.delete(dbSchema.backups).where(eq(dbSchema.backups.id, extra.id)).run();
  }
}

export function activateDirectory(store: Store, projectId: string, srcDir: string): void {
  const managedRoot = path.resolve(store.projectsDir);
  const dest = path.resolve(path.join(store.projectsDir, projectId));
  if (!dest.startsWith(managedRoot)) throw new Error("Refusing to write outside managed directory");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(srcDir, dest, { recursive: true });
}

export function restoreBackup(store: Store, projectId: string, backupId: string): BackupRecord {
  const backup = listBackupRows(store, projectId).find((b) => b.id === backupId);
  if (!backup || !fs.existsSync(backup.path)) throw new Error("Backup not found");
  activateDirectory(store, projectId, backup.path);
  store.db.update(dbSchema.projects).set({
    version: backup.version, status: "stopped", pid: null, updatedAt: now(),
  }).where(eq(dbSchema.projects.id, projectId)).run();
  return { id: backup.id, version: backup.version, path: backup.path };
}

export function getBackup(store: Store, backupId: string) {
  return store.db.select().from(dbSchema.backups).where(eq(dbSchema.backups.id, backupId)).all()[0] ?? null;
}
