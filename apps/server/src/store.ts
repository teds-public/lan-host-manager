import { eq } from "drizzle-orm";
import { openDatabase, migrate } from "@lan/database";
import * as schema from "@lan/database";
import { resolveDataDir } from "@lan/config";
import path from "node:path";

export interface Store {
  db: ReturnType<typeof openDatabase>["db"];
  dataDir: string;
  projectsDir: string;
  stagingDir: string;
  backupsDir: string;
  logsDir: string;
  archivesDir: string;
}

export function initStore(): Store {
  const dataDir = resolveDataDir();
  const { db, raw } = openDatabase(path.join(dataDir, "app.db"));
  migrate(raw);
  return {
    db,
    dataDir,
    projectsDir: path.join(dataDir, "projects"),
    stagingDir: path.join(dataDir, "staging"),
    backupsDir: path.join(dataDir, "backups"),
    logsDir: path.join(dataDir, "logs"),
    archivesDir: path.join(dataDir, "archives"),
  };
}

export async function listProjects(store: Store) {
  return store.db.select().from(schema.projects).all();
}

export async function getProject(store: Store, id: string) {
  const rows = store.db.select().from(schema.projects).where(eq(schema.projects.id, id)).all();
  return rows[0] ?? null;
}

export function now(): string {
  return new Date().toISOString();
}
