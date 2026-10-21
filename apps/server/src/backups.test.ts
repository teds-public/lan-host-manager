import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate } from "@lan/database";
import { eq } from "drizzle-orm";
import * as dbSchema from "@lan/database";
import { activateDirectory, createBackup, listBackupRows, pruneBackups, restoreBackup } from "./backups.js";
import type { Store } from "./store.js";

function makeStore(): Store {
  const base = mkdtempSync(join(tmpdir(), "backup-test-"));
  const { db, raw } = openDatabase(join(base, "app.db"));
  migrate(raw);
  return {
    db,
    dataDir: base,
    projectsDir: join(base, "projects"),
    stagingDir: join(base, "staging"),
    backupsDir: join(base, "backups"),
    logsDir: join(base, "logs"),
    archivesDir: join(base, "archives"),
  };
}

describe("backups", () => {
  let store: Store;
  let projectId: string;

  beforeEach(() => {
    store = makeStore();
    projectId = "proj-1";
    mkdirSync(join(store.projectsDir, projectId), { recursive: true });
    writeFileSync(join(store.projectsDir, projectId, "index.html"), "<h1>v1</h1>");
    store.db.insert(dbSchema.projects).values({
      id: projectId, name: "demo", type: "static", status: "stopped", port: 4501,
      path: join(store.projectsDir, projectId), version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).run();
  });

  it("creates a backup containing the current files", () => {
    const b = createBackup(store, projectId, 1, join(store.projectsDir, projectId));
    expect(existsSync(join(b.path, "index.html"))).toBe(true);
    expect(readFileSync(join(b.path, "index.html"), "utf-8")).toBe("<h1>v1</h1>");
    expect(listBackupRows(store, projectId)).toHaveLength(1);
  });

  it("restores a previous version after activate", () => {
    const b = createBackup(store, projectId, 1, join(store.projectsDir, projectId));
    const v2 = mkdtempSync(join(tmpdir(), "v2-"));
    writeFileSync(join(v2, "index.html"), "<h1>v2</h1>");
    activateDirectory(store, projectId, v2);
    expect(readFileSync(join(store.projectsDir, projectId, "index.html"), "utf-8")).toBe("<h1>v2</h1>");
    restoreBackup(store, projectId, b.id);
    expect(readFileSync(join(store.projectsDir, projectId, "index.html"), "utf-8")).toBe("<h1>v1</h1>");
    const row = store.db.select().from(dbSchema.projects).where(eq(dbSchema.projects.id, projectId)).all()[0]!;
    expect(row.version).toBe(1);
    expect(row.status).toBe("stopped");
  });

  it("refuses to restore an unknown backup", () => {
    expect(() => restoreBackup(store, projectId, "missing")).toThrow("Backup not found");
  });

  it("prunes to the newest 5 backups", () => {
    for (let v = 1; v <= 7; v++) {
      createBackup(store, projectId, v, join(store.projectsDir, projectId));
    }
    pruneBackups(store, projectId);
    expect(listBackupRows(store, projectId)).toHaveLength(5);
  });
});
