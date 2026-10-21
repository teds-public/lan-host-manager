import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as dbSchema from "@lan/database";
import { createSession, destroySession, getSession, hashPassword, verifyPassword } from "./auth.js";
import { getLanIPv4 } from "./lan.js";
import { initStore, listProjects, getProject, now } from "./store.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { extractRar, validateArchiveName } from "@lan/archive";
import { detectProject } from "@lan/detector";
import { findFreePort, isPortFree } from "@lan/ports";
import { serveStatic, startNode, stopHosting } from "@lan/hosting";
import { logFileFor, stopManaged } from "@lan/process-manager";
import { activateDirectory, createBackup, listBackupRows, pruneBackups, restoreBackup } from "./backups.js";
import { envSchema } from "@lan/config";

const env = envSchema.parse(process.env);
const store = initStore();

for (const d of [store.projectsDir, store.stagingDir, store.backupsDir, store.logsDir, store.archivesDir]) {
  fs.mkdirSync(d, { recursive: true });
}

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 1024 });
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } });

type SessionUser = { username: string } | null;
declare module "fastify" {
  interface FastifyRequest { user: SessionUser; }
}

app.addHook("preHandler", async (req, reply) => {
  const publicPaths = ["/api/auth/login", "/api/auth/setup-needed", "/api/auth/setup", "/api/health"];
  if (req.url.startsWith("/api/") && !publicPaths.some((p) => req.url.startsWith(p))) {
    const token = req.cookies.session;
    req.user = getSession(token);
    if (!req.user) { reply.code(401).send({ error: "unauthorized", message: "Login required" }); return; }
  }
});

const pendingImports = new Map<string, {
  id: string; archivePath: string; archiveName: string; archiveSize: number;
  outDir: string; rootDir: string; entries: number;
  detection: ReturnType<typeof detectProject>;
}>();

const pendingUpdates = new Map<string, {
  id: string; projectId: string; archivePath: string; archiveName: string; archiveSize: number;
  outDir: string; rootDir: string; entries: number;
  detection: ReturnType<typeof detectProject>;
}>();

function startProjectRecord(p: {
  id: string; type: string; path: string; serveDir: string | null;
  spaFallback: number; port: number; startCommand: string | null;
}): number | null {
  if (p.type === "static") {
    const dir = p.serveDir ? path.join(p.path, p.serveDir) : p.path;
    if (!fs.existsSync(dir)) throw new Error(`Serve directory missing: ${dir}`);
    serveStatic(p.id, dir, p.port, !!p.spaFallback, env.BIND_HOST);
    return null;
  }
  if (!p.startCommand) throw new Error("No start command configured");
  return startNode(p.id, p.path, p.startCommand, p.port, env.BIND_HOST, (tag, data) => {
    const file = logFileFor(store.logsDir, p.id);
    fs.appendFileSync(file, data.split("\n").filter(Boolean).map((l) => `[${new Date().toISOString()}] [${tag}] ${l}\n`).join(""));
  });
}

async function verifyRunning(id: string, pid: number | null): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const res = await fetch(`http://127.0.0.1:${(await getProject(store, id))?.port ?? 0}/`, { signal: AbortSignal.timeout(3000) });
    await res.arrayBuffer().catch(() => undefined);
    return true;
  } catch {
    if (pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
    return true;
  }
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/auth/setup-needed", async () => {
  const users = store.db.select().from(dbSchema.users).all();
  return { setupNeeded: users.length === 0 };
});

app.post("/api/auth/setup", async (req, reply) => {
  const body = z.object({ username: z.string().min(1), password: z.string().min(8) }).parse(req.body);
  const existing = store.db.select().from(dbSchema.users).all();
  if (existing.length > 0) { reply.code(400); return { error: "bad-request", message: "Already set up" }; }
  const id = randomUUID();
  store.db.insert(dbSchema.users).values({
    id, username: body.username, passwordHash: await hashPassword(body.password), createdAt: now(),
  }).run();
  const token = createSession(body.username);
  reply.setCookie("session", token, { path: "/", httpOnly: true, sameSite: "lax" });
  return { ok: true };
});

app.post("/api/auth/login", async (req, reply) => {
  const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
  const rows = store.db.select().from(dbSchema.users).where(eq(dbSchema.users.username, body.username)).all();
  const user = rows[0];
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    reply.code(401);
    return { error: "unauthorized", message: "Invalid credentials" };
  }
  const token = createSession(user.username);
  reply.setCookie("session", token, { path: "/", httpOnly: true, sameSite: "lax" });
  return { ok: true };
});

app.post("/api/auth/logout", async (req, reply) => {
  if (req.cookies.session) destroySession(req.cookies.session);
  reply.clearCookie("session", { path: "/" });
  return { ok: true };
});

app.get("/api/projects", async () => {
  const rows = await listProjects(store);
  return rows.map((r) => ({ ...r, spaFallback: !!r.spaFallback, autoStart: !!r.autoStart }));
});

app.get("/api/projects/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  return { ...p, spaFallback: !!p.spaFallback, autoStart: !!p.autoStart };
});

app.post("/api/imports/upload", async (req, reply) => {
  const file = await req.file();
  if (!file) { reply.code(400); return { error: "bad-request", message: "No file uploaded" }; }
  try { validateArchiveName(file.filename); }
  catch (e) { reply.code(400); return { error: "bad-request", message: (e as Error).message }; }
  const importId = randomUUID();
  const staging = path.join(store.stagingDir, importId);
  fs.mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, path.basename(file.filename));
  await pipeline(file.file, fs.createWriteStream(archivePath));
  const size = fs.statSync(archivePath).size;
  const result = await extractRar(archivePath, staging, process.env.RAR_BINARY ?? "", {
    maxEntries: 10000, maxDecompressedMb: 2048, timeoutSec: 120,
  });
  const detection = detectProject(result.rootDir);
  pendingImports.set(importId, {
    id: importId, archivePath, archiveName: file.filename, archiveSize: size,
    outDir: result.outDir, rootDir: result.rootDir, entries: result.entries, detection,
  });
  return { importId, entries: result.entries, detection };
});

app.post("/api/imports/:id/confirm", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const pending = pendingImports.get(req.params.id);
  if (!pending) { reply.code(404); return { error: "not-found", message: "Import not found or expired" }; }
  const body = z.object({
    name: z.string().min(1).max(100),
    port: z.number().int().min(1).max(65535).optional(),
    serveDir: z.string().optional(),
    spaFallback: z.boolean().default(false),
    startCommand: z.string().max(500).optional(),
  }).parse(req.body);
  const taken = new Set((await listProjects(store)).map((p) => p.port));
  const port = body.port ?? await findFreePort(env.PORT_RANGE_START, env.PORT_RANGE_END, taken);
  if (taken.has(port) || !(await isPortFree(port))) {
    reply.code(409);
    return { error: "conflict", message: `Port ${port} is already in use. Choose another port.` };
  }
  const id = randomUUID();
  const dest = path.join(store.projectsDir, id);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(pending.rootDir, dest, { recursive: true });
  fs.rmSync(path.dirname(pending.outDir) === store.stagingDir ? stagingOf(pending) : pending.outDir, { recursive: true, force: true });
  pendingImports.delete(req.params.id);
  const projectPath = path.join(dest, "");
  store.db.insert(dbSchema.projects).values({
    id, name: body.name, type: pending.detection.type, status: "stopped", port,
    path: projectPath, serveDir: body.serveDir ?? pending.detection.serveDirCandidates[0] ?? null,
    spaFallback: body.spaFallback ? 1 : 0, startCommand: body.startCommand ?? null,
    installCommand: null, pid: null, lastExitCode: null,
    logFile: logFileFor(store.logsDir, id), version: 1, autoStart: 0,
    archiveName: pending.archiveName, archiveSize: pending.archiveSize,
    createdAt: now(), updatedAt: now(),
  }).run();
  return { id, port };
});

function stagingOf(pending: { outDir: string }): string {
  return path.dirname(pending.outDir);
}

function appendSysLog(projectId: string, msg: string): void {
  const file = logFileFor(store.logsDir, projectId);
  fs.appendFileSync(file, `[${new Date().toISOString()}] [sys] ${msg}\n`);
}

app.post("/api/projects/:id/start", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  if (p.type === "unknown") {
    reply.code(400);
    return { error: "bad-request", message: "Unsupported project type. Cannot start." };
  }
  if (!(await isPortFree(p.port))) {
    reply.code(409);
    return { error: "conflict", message: `Port ${p.port} is occupied by another process. Stop it or change the port.` };
  }
  try {
    if (p.type === "static") {
      const dir = p.serveDir ? path.join(p.path, p.serveDir) : p.path;
      serveStatic(p.id, dir, p.port, !!p.spaFallback, env.BIND_HOST);
    } else {
      if (!p.startCommand) { reply.code(400); return { error: "bad-request", message: "No start command configured" }; }
      const pid = startNode(p.id, p.path, p.startCommand, p.port, env.BIND_HOST, (tag, data) => {
        const file = logFileFor(store.logsDir, p.id);
        fs.appendFileSync(file, data.split("\n").filter(Boolean).map((l) => `[${new Date().toISOString()}] [${tag}] ${l}\n`).join(""));
      });
      store.db.update(dbSchema.projects).set({ pid, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    }
    store.db.update(dbSchema.projects).set({ status: "running", lastExitCode: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    appendSysLog(p.id, `started on port ${p.port}`);
    return { ok: true };
  } catch (e) {
    store.db.update(dbSchema.projects).set({ status: "crashed", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    reply.code(500);
    return { error: "start-failed", message: (e as Error).message };
  }
});

app.post("/api/projects/:id/stop", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  stopHosting(p.id);
  stopManaged(p.id);
  store.db.update(dbSchema.projects).set({ status: "stopped", pid: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
  appendSysLog(p.id, "stopped");
  return { ok: true };
});

app.post("/api/projects/:id/restart", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  stopHosting(p.id);
  stopManaged(p.id);
  await new Promise((r) => setTimeout(r, 500));
  if (!(await isPortFree(p.port))) {
    reply.code(409);
    return { error: "conflict", message: `Port ${p.port} is occupied. Free it, then start again.` };
  }
  if (p.type === "static") {
    const dir = p.serveDir ? path.join(p.path, p.serveDir) : p.path;
    serveStatic(p.id, dir, p.port, !!p.spaFallback, env.BIND_HOST);
  } else if (p.startCommand) {
    const pid = startNode(p.id, p.path, p.startCommand, p.port, env.BIND_HOST, () => undefined);
    store.db.update(dbSchema.projects).set({ pid }).where(eq(dbSchema.projects.id, p.id)).run();
  }
  store.db.update(dbSchema.projects).set({ status: "running", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
  return { ok: true };
});

app.get("/api/projects/:id/logs", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const file = p.logFile ?? logFileFor(store.logsDir, p.id);
  if (!fs.existsSync(file)) return { logs: "" };
  const st = fs.statSync(file);
  const tail = Math.min(st.size, 200 * 1024);
  const buf = Buffer.alloc(tail);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, buf, 0, tail, st.size - tail);
  fs.closeSync(fd);
  return { logs: buf.toString("utf-8") };
});

app.patch("/api/projects/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const body = z.object({
    name: z.string().min(1).max(100).optional(),
    serveDir: z.string().optional(),
    spaFallback: z.boolean().optional(),
    startCommand: z.string().max(500).nullable().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    autoStart: z.boolean().optional(),
  }).parse(req.body);
  if (body.port !== undefined && body.port !== p.port) {
    if (!(await isPortFree(body.port))) {
      reply.code(409);
      return { error: "conflict", message: `Port ${body.port} is occupied.` };
    }
  }
  store.db.update(dbSchema.projects).set({
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.serveDir !== undefined ? { serveDir: body.serveDir } : {}),
    ...(body.spaFallback !== undefined ? { spaFallback: body.spaFallback ? 1 : 0 } : {}),
    ...(body.startCommand !== undefined ? { startCommand: body.startCommand } : {}),
    ...(body.port !== undefined ? { port: body.port } : {}),
    ...(body.autoStart !== undefined ? { autoStart: body.autoStart ? 1 : 0 } : {}),
    updatedAt: now(),
  }).where(eq(dbSchema.projects.id, p.id)).run();
  return { ok: true };
});

app.post("/api/projects/:id/updates/upload", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const file = await req.file();
  if (!file) { reply.code(400); return { error: "bad-request", message: "No file uploaded" }; }
  try { validateArchiveName(file.filename); }
  catch (e) { reply.code(400); return { error: "bad-request", message: (e as Error).message }; }
  const updateId = randomUUID();
  const staging = path.join(store.stagingDir, updateId);
  fs.mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, path.basename(file.filename));
  await pipeline(file.file, fs.createWriteStream(archivePath));
  const size = fs.statSync(archivePath).size;
  let result;
  try {
    result = await extractRar(archivePath, staging, process.env.RAR_BINARY ?? "", {
      maxEntries: 10000, maxDecompressedMb: 2048, timeoutSec: 120,
    });
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    reply.code(400);
    return { error: "bad-request", message: (e as Error).message };
  }
  const detection = detectProject(result.rootDir);
  pendingUpdates.set(updateId, {
    id: updateId, projectId: p.id, archivePath, archiveName: file.filename, archiveSize: size,
    outDir: result.outDir, rootDir: result.rootDir, entries: result.entries, detection,
  });
  return { updateId, entries: result.entries, detection };
});

app.post("/api/updates/:id/confirm", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const pending = pendingUpdates.get(req.params.id);
  if (!pending) { reply.code(404); return { error: "not-found", message: "Update not found or expired" }; }
  const p = await getProject(store, pending.projectId);
  if (!p) { pendingUpdates.delete(req.params.id); reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const body = z.object({
    serveDir: z.string().optional(),
    spaFallback: z.boolean().default(!!p.spaFallback),
    startCommand: z.string().max(500).nullable().optional(),
  }).parse(req.body);
  if (pending.detection.type === "unknown") {
    reply.code(400);
    return { error: "bad-request", message: "Unsupported project type in update archive." };
  }

  stopHosting(p.id);
  stopManaged(p.id);
  const backup = createBackup(store, p.id, p.version, p.path);
  const backupId = backup.id;
  const backupDir = backup.path;

  const newVersion = p.version + 1;
  try {
    activateDirectory(store, p.id, pending.rootDir);
    fs.rmSync(path.dirname(pending.outDir), { recursive: true, force: true });
    pendingUpdates.delete(req.params.id);
    store.db.update(dbSchema.projects).set({
      type: pending.detection.type,
      serveDir: body.serveDir ?? pending.detection.serveDirCandidates[0] ?? p.serveDir,
      spaFallback: body.spaFallback ? 1 : 0,
      startCommand: body.startCommand !== undefined ? body.startCommand : p.startCommand,
      version: newVersion,
      archiveName: pending.archiveName, archiveSize: pending.archiveSize,
      pid: null, lastExitCode: null, status: "stopped", updatedAt: now(),
    }).where(eq(dbSchema.projects.id, p.id)).run();

    const updated = (await getProject(store, p.id))!;
    if (!(await isPortFree(updated.port))) throw new Error(`Port ${updated.port} is occupied. Restore the backup or free the port.`);
    const pid = startProjectRecord(updated);
    const healthy = await verifyRunning(updated.id, pid);
    if (!healthy) throw new Error("New version failed to start. Restoring previous version.");
    store.db.update(dbSchema.projects).set({ status: "running", pid, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    appendSysLog(p.id, `updated to v${newVersion} (backup ${backupId})`);
    return { ok: true, version: newVersion, backupId };
  } catch (e) {
    try {
      stopHosting(p.id);
      stopManaged(p.id);
      activateDirectory(store, p.id, backupDir);
      const restored = (await getProject(store, p.id))!;
      const pid = await isPortFree(restored.port) ? startProjectRecord(restored) : null;
      store.db.update(dbSchema.projects).set({
        status: pid || restored.type === "static" ? "running" : "crashed",
        pid, updatedAt: now(),
      }).where(eq(dbSchema.projects.id, p.id)).run();
      appendSysLog(p.id, `update failed, restored v${p.version}: ${(e as Error).message}`);
    } catch { /* backup dir retained for manual recovery */ }
    reply.code(500);
    return { error: "update-failed", message: (e as Error).message, restored: true, backupId };
  }
});

app.get("/api/projects/:id/backups", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  return listBackupRows(store, p.id);
});

app.post("/api/projects/:id/backups", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const backup = createBackup(store, p.id, p.version, p.path);
  return { backupId: backup.id, version: p.version };
});

app.post("/api/projects/:id/rollback/:backupId", async (
  req: FastifyRequest<{ Params: { id: string; backupId: string } }>, reply,
) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  stopHosting(p.id);
  stopManaged(p.id);
  let version: number;
  try {
    version = restoreBackup(store, p.id, req.params.backupId).version;
  } catch {
    reply.code(404);
    return { error: "not-found", message: "Backup not found" };
  }
  appendSysLog(p.id, `rolled back to backup ${req.params.backupId} (v${version})`);
  return { ok: true, version };
});

app.delete("/api/projects/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const body = z.object({
    removeFiles: z.boolean().default(false),
    deleteBackups: z.boolean().default(false),
  }).parse(req.body ?? {});
  stopHosting(p.id);
  stopManaged(p.id);
  const managedRoot = path.resolve(store.projectsDir);
  const projectPath = path.resolve(p.path);
  if (body.removeFiles) {
    if (!projectPath.startsWith(managedRoot)) {
      reply.code(400);
      return { error: "bad-request", message: "Refusing to delete outside managed directory" };
    }
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
  if (body.deleteBackups) {
    const rows = store.db.select().from(dbSchema.backups).where(eq(dbSchema.backups.projectId, p.id)).all();
    for (const b of rows) fs.rmSync(b.path, { recursive: true, force: true });
    store.db.delete(dbSchema.backups).where(eq(dbSchema.backups.projectId, p.id)).run();
  }
  store.db.delete(dbSchema.projects).where(eq(dbSchema.projects.id, p.id)).run();
  return { ok: true };
});

app.get("/api/system/info", async () => ({
  lanIps: getLanIPv4(),
  dashboardPort: env.DASHBOARD_PORT,
  bindHost: env.BIND_HOST,
  portRange: [env.PORT_RANGE_START, env.PORT_RANGE_END],
}));

app.get("/api/settings", async () => {
  const rows = store.db.select().from(dbSchema.settings).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

app.put("/api/settings", async (req) => {
  const body = z.record(z.string()).parse(req.body);
  for (const [k, v] of Object.entries(body)) {
    store.db.insert(dbSchema.settings).values({ key: k, value: v, updatedAt: now() })
      .onConflictDoUpdate({ target: dbSchema.settings.key, set: { value: v, updatedAt: now() } }).run();
  }
  return { ok: true };
});

async function reconcile(): Promise<void> {
  const rows = await listProjects(store);
  for (const p of rows) {
    const alive = p.pid ? (() => { try { process.kill(p.pid, 0); return true; } catch { return false; } })() : false;
    if (p.status === "running" && !alive) {
      store.db.update(dbSchema.projects).set({ status: "crashed", pid: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    }
    if (p.autoStart && (p.status === "stopped" || p.status === "crashed")) {
      try {
        if (p.type === "static") {
          const dir = p.serveDir ? path.join(p.path, p.serveDir) : p.path;
          if (fs.existsSync(dir) && await isPortFree(p.port)) {
            serveStatic(p.id, dir, p.port, !!p.spaFallback, env.BIND_HOST);
            store.db.update(dbSchema.projects).set({ status: "running", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
          }
        } else if (p.startCommand && await isPortFree(p.port)) {
          const pid = startNode(p.id, p.path, p.startCommand, p.port, env.BIND_HOST, () => undefined);
          store.db.update(dbSchema.projects).set({ status: "running", pid, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
        }
      } catch { /* mark crashed on next cycle */ }
    }
  }
}

const webDist = new URL("../../web/dist", import.meta.url);
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) { reply.code(404).send({ error: "not-found", message: "No such endpoint" }); return; }
    reply.sendFile("index.html");
  });
}

await reconcile();
setInterval(() => { reconcile().catch(() => undefined); }, 30000);

await app.listen({ port: env.DASHBOARD_PORT, host: env.BIND_HOST });
console.log(`Dashboard: http://${env.BIND_HOST}:${env.DASHBOARD_PORT}`);
