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
import { serveStatic, startNode, stopHosting, isHosting, nodeExitCode } from "@lan/hosting";
import { logFileFor, readTail, startManaged, writeLog } from "@lan/process-manager";
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
}): Promise<number | null> {
  const logFile = logFileFor(store.logsDir, p.id);
  if (p.type === "static") {
    const dir = p.serveDir ? path.join(p.path, p.serveDir) : p.path;
    if (!fs.existsSync(dir)) throw new Error(`Serve directory missing: ${dir}`);
    return serveStatic(p.id, dir, p.port, !!p.spaFallback, env.BIND_HOST, logFile).then(() => null);
  }
  if (!p.startCommand) throw new Error("No start command configured");
  return Promise.resolve(startNode(p.id, p.path, p.startCommand, p.port, env.BIND_HOST, logFile, (code) => {
    store.db.update(dbSchema.projects).set({ status: "crashed", lastExitCode: code, pid: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    writeLog(logFileFor(store.logsDir, p.id), "sys", `marked crashed (exit ${code})`);
  }));
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

const serveDirSchema = z.string().max(200).refine(
  (s) => {
    if (!s || path.isAbsolute(s) || s.includes("\0")) return false;
    const norm = path.posix.normalize(s.replace(/\\/g, "/"));
    return norm !== ".." && !norm.startsWith("../") && !norm.includes("/../");
  },
  { message: "serveDir must be a relative path inside the project" },
);

const startCommandSchema = z.string().max(500).refine(
  (s) => s.trim().length > 0 && !/[;&|`$<>()\n\r]/.test(s),
  { message: "startCommand must be a plain command without shell operators" },
);

app.get("/api/projects", async () => {
  const rows = await listProjects(store);
  return rows.map((r) => ({ ...r, spaFallback: !!r.spaFallback, autoStart: !!r.autoStart }));
});

app.get("/api/projects/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  let scripts: Record<string, string> | undefined;
  try { scripts = p.scripts ? (JSON.parse(p.scripts) as Record<string, string>) : undefined; }
  catch { scripts = undefined; }
  return { ...p, spaFallback: !!p.spaFallback, autoStart: !!p.autoStart, scripts };
});

function getLimits(): { maxUploadMb: number; maxEntries: number; maxDecompressedMb: number; extractTimeoutSec: number; rarBinary: string } {
  const rows = store.db.select().from(dbSchema.settings).all();
  const all = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (v: string | undefined, fallback: number): number => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    maxUploadMb: num(all.maxUploadMb, 500),
    maxEntries: num(all.maxEntries, 10000),
    maxDecompressedMb: num(all.maxDecompressedMb, 2048),
    extractTimeoutSec: num(all.extractTimeoutSec, 120),
    rarBinary: all.rarBinary ?? process.env.RAR_BINARY ?? "",
  };
}

async function saveUploadWithCap(src: NodeJS.ReadableStream, dest: string, cap: number, capMsg: string): Promise<void> {
  const { Transform } = await import("node:stream");
  let written = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc: string, cb: (err?: Error | null, data?: Buffer) => void) {
      written += chunk.length;
      if (written > cap) { cb(new Error(capMsg)); return; }
      cb(null, chunk);
    },
  });
  await pipeline(src, guard, fs.createWriteStream(dest));
}

app.post("/api/imports/upload", async (req, reply) => {
  const limits = getLimits();
  const file = await req.file();
  if (!file) { reply.code(400); return { error: "bad-request", message: "No file uploaded" }; }
  try { validateArchiveName(file.filename); }
  catch (e) { reply.code(400); return { error: "bad-request", message: (e as Error).message }; }
  const importId = randomUUID();
  const staging = path.join(store.stagingDir, importId);
  fs.mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, path.basename(file.filename));
  try {
    await saveUploadWithCap(file.file, archivePath, limits.maxUploadMb * 1024 * 1024, `Archive exceeds the ${limits.maxUploadMb} MB upload limit.`);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    reply.code(400);
    return { error: "bad-request", message: (e as Error).message };
  }
  const size = fs.statSync(archivePath).size;
  const result = await extractRar(archivePath, staging, limits.rarBinary, {
    maxEntries: limits.maxEntries, maxDecompressedMb: limits.maxDecompressedMb, timeoutSec: limits.extractTimeoutSec,
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
    port: z.number().int().min(env.PORT_RANGE_START).max(env.PORT_RANGE_END).optional(),
    serveDir: serveDirSchema.optional(),
    spaFallback: z.boolean().default(false),
    startCommand: startCommandSchema.optional(),
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
    installCommand: null, scripts: pending.detection.scripts ? JSON.stringify(pending.detection.scripts) : null,
    pid: null, lastExitCode: null,
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
  try {
    writeLog(logFileFor(store.logsDir, projectId), "sys", msg);
  } catch { /* ignore */ }
}

const rateBuckets = new Map<string, number[]>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const arr = (rateBuckets.get(key) ?? []).filter((x) => t - x < windowMs);
  arr.push(t);
  rateBuckets.set(key, arr);
  return arr.length <= max;
}

app.addHook("preHandler", async (req, reply) => {
  const ip = req.ip;
  const authPath = req.url.startsWith("/api/auth/");
  const limit = authPath ? 20 : 300;
  if (req.url.startsWith("/api/") && !rateLimit(`${ip}:${authPath ? "auth" : "api"}`, limit, 60_000)) {
    reply.code(429).send({ error: "rate-limited", message: "Too many requests. Slow down and retry." });
    return;
  }
});

app.post("/api/projects/:id/start", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  if (p.type === "unknown") {
    reply.code(400);
    return { error: "bad-request", message: "Unsupported project type. Cannot start." };
  }
  if (isHosting(p.id, p.pid)) {
    return { ok: true, alreadyRunning: true };
  }
  if (!(await isPortFree(p.port))) {
    reply.code(409);
    return { error: "conflict", message: `Port ${p.port} is occupied by another process. Stop it or change the port.` };
  }
  try {
    const pid = await startProjectRecord(p);
    store.db.update(dbSchema.projects).set({ pid, status: "running", lastExitCode: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    appendSysLog(p.id, `started on port ${p.port}`);
    return { ok: true };
  } catch (e) {
    const code = p.type === "node" ? nodeExitCode(p.id) : null;
    store.db.update(dbSchema.projects).set({ status: "crashed", lastExitCode: code, pid: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    reply.code(500);
    return { error: "start-failed", message: (e as Error).message };
  }
});

app.post("/api/projects/:id/stop", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  stopHosting(p.id);
  store.db.update(dbSchema.projects).set({ status: "stopped", pid: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
  appendSysLog(p.id, "stopped");
  return { ok: true };
});

app.post("/api/projects/:id/restart", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  stopHosting(p.id);
  await new Promise((r) => setTimeout(r, 800));
  if (!(await isPortFree(p.port))) {
    reply.code(409);
    return { error: "conflict", message: `Port ${p.port} is occupied. Free it, then start again.` };
  }
  try {
    const pid = await startProjectRecord(p);
    store.db.update(dbSchema.projects).set({ status: "running", pid, lastExitCode: null, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    return { ok: true };
  } catch (e) {
    store.db.update(dbSchema.projects).set({ status: "crashed", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    reply.code(500);
    return { error: "start-failed", message: (e as Error).message };
  }
});

app.post("/api/projects/:id/install", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  if (p.type !== "node") { reply.code(400); return { error: "bad-request", message: "Only Node.js projects need dependency installation." }; }
  if (!fs.existsSync(path.join(p.path, "package.json"))) {
    reply.code(400);
    return { error: "bad-request", message: "No package.json found." };
  }
  if (p.installCommand && !/^(npm|pnpm|yarn)\b/.test(p.installCommand.trim())) {
    reply.code(400);
    return { error: "bad-request", message: "Stored install command is not an npm-compatible invocation. Refusing to run it." };
  }
  const manager = p.installCommand?.trim().split(/\s+/)[0] ?? "npm";
  const args = p.installCommand ? p.installCommand.trim().split(/\s+/).slice(1) : ["install", "--no-audit", "--no-fund"];
  if (args.some((a) => /[;&|`$<>()\n\r]/.test(a))) {
    reply.code(400);
    return { error: "bad-request", message: "Install arguments contain shell operators. Refusing to run." };
  }
  try {
    const logFile = logFileFor(store.logsDir, p.id);
    const proc = startManaged(p.id, manager, args, { cwd: p.path, logFile });
    appendSysLog(p.id, `dependency install started (pid ${proc.pid ?? "?"})`);
    return { ok: true, pid: proc.pid };
  } catch (e) {
    reply.code(500);
    return { error: "install-failed", message: (e as Error).message };
  }
});

app.get("/api/projects/:id/logs", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const file = p.logFile ?? logFileFor(store.logsDir, p.id);
  const limit = Math.min(Number((req.query as { tail?: string }).tail ?? 200) || 200, 2000) * 1024;
  return { logs: readTail(file, limit) };
});

app.patch("/api/projects/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const p = await getProject(store, req.params.id);
  if (!p) { reply.code(404); return { error: "not-found", message: "Project not found" }; }
  const body = z.object({
    name: z.string().min(1).max(100).optional(),
    serveDir: serveDirSchema.optional(),
    spaFallback: z.boolean().optional(),
    startCommand: startCommandSchema.nullable().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    autoStart: z.boolean().optional(),
  }).parse(req.body);
  if (body.port !== undefined && body.port !== p.port) {
    if (isHosting(p.id, p.pid)) {
      reply.code(409);
      return { error: "conflict", message: "Stop the project before changing its port." };
    }
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
  const limits = getLimits();
  const file = await req.file();
  if (!file) { reply.code(400); return { error: "bad-request", message: "No file uploaded" }; }
  try { validateArchiveName(file.filename); }
  catch (e) { reply.code(400); return { error: "bad-request", message: (e as Error).message }; }
  const updateId = randomUUID();
  const staging = path.join(store.stagingDir, updateId);
  fs.mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, path.basename(file.filename));
  try {
    await saveUploadWithCap(file.file, archivePath, limits.maxUploadMb * 1024 * 1024, `Archive exceeds the ${limits.maxUploadMb} MB upload limit.`);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    reply.code(400);
    return { error: "bad-request", message: (e as Error).message };
  }
  const size = fs.statSync(archivePath).size;
  let result;
  try {
    result = await extractRar(archivePath, staging, limits.rarBinary, {
      maxEntries: limits.maxEntries, maxDecompressedMb: limits.maxDecompressedMb, timeoutSec: limits.extractTimeoutSec,
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
    serveDir: serveDirSchema.optional(),
    spaFallback: z.boolean().default(!!p.spaFallback),
    startCommand: startCommandSchema.nullable().optional(),
  }).parse(req.body);
  if (pending.detection.type === "unknown") {
    reply.code(400);
    return { error: "bad-request", message: "Unsupported project type in update archive." };
  }

  stopHosting(p.id);
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
      scripts: pending.detection.scripts ? JSON.stringify(pending.detection.scripts) : p.scripts,
      version: newVersion,
      archiveName: pending.archiveName, archiveSize: pending.archiveSize,
      pid: null, lastExitCode: null, status: "stopped", updatedAt: now(),
    }).where(eq(dbSchema.projects.id, p.id)).run();

    const updated = (await getProject(store, p.id))!;
    if (!(await isPortFree(updated.port))) throw new Error(`Port ${updated.port} is occupied. Restore the backup or free the port.`);
    const pid = await startProjectRecord(updated);
    const healthy = await verifyRunning(updated.id, pid);
    if (!healthy) throw new Error("New version failed to start. Restoring previous version.");
    store.db.update(dbSchema.projects).set({ status: "running", pid, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
    appendSysLog(p.id, `updated to v${newVersion} (backup ${backupId})`);
    return { ok: true, version: newVersion, backupId };
  } catch (e) {
    try {
      stopHosting(p.id);
      activateDirectory(store, p.id, backupDir);
      const restored = (await getProject(store, p.id))!;
      const pid = await isPortFree(restored.port) ? await startProjectRecord(restored) : null;
      store.db.update(dbSchema.projects).set({
        status: pid !== null || restored.type === "static" ? "running" : "crashed",
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

const SETTING_KEYS = ["rarBinary", "maxUploadMb", "maxEntries", "maxDecompressedMb", "extractTimeoutSec"] as const;

app.get("/api/settings", async () => {
  const rows = store.db.select().from(dbSchema.settings).all();
  const all = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) if (all[k] !== undefined) out[k] = all[k];
  return out;
});

app.put("/api/settings", async (req, reply) => {
  const body = z.object({
    rarBinary: z.string().max(500).optional(),
    maxUploadMb: z.coerce.number().int().min(1).max(4096).optional(),
    maxEntries: z.coerce.number().int().min(1).max(100000).optional(),
    maxDecompressedMb: z.coerce.number().int().min(1).max(16384).optional(),
    extractTimeoutSec: z.coerce.number().int().min(10).max(1800).optional(),
  }).parse(req.body);
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    const str = String(v);
    if (/[\0\n\r]/.test(str)) { reply.code(400); return { error: "bad-request", message: `Invalid value for ${k}` }; }
    store.db.insert(dbSchema.settings).values({ key: k, value: str, updatedAt: now() })
      .onConflictDoUpdate({ target: dbSchema.settings.key, set: { value: str, updatedAt: now() } }).run();
  }
  return { ok: true };
});

app.post("/api/auth/change-password", async (req, reply) => {
  const body = z.object({ current: z.string().min(1), next: z.string().min(12).max(200) }).parse(req.body);
  const rows = store.db.select().from(dbSchema.users).all();
  const user = rows[0];
  if (!user || !req.user || user.username !== req.user.username) {
    reply.code(401);
    return { error: "unauthorized", message: "Login required" };
  }
  if (!(await verifyPassword(body.current, user.passwordHash))) {
    reply.code(401);
    return { error: "unauthorized", message: "Current password is wrong." };
  }
  store.db.update(dbSchema.users).set({ passwordHash: await hashPassword(body.next) }).where(eq(dbSchema.users.id, user.id)).run();
  return { ok: true };
});

async function reconcile(): Promise<void> {
  const rows = await listProjects(store);
  for (const p of rows) {
    const owned = isHosting(p.id, p.pid);
    if (p.status === "running" && !owned) {
      const code = nodeExitCode(p.id);
      store.db.update(dbSchema.projects).set({ status: "crashed", pid: null, lastExitCode: code, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
      appendSysLog(p.id, `process gone (exit ${code ?? "?"}), marked crashed`);
      continue;
    }
    if (p.status === "starting") {
      store.db.update(dbSchema.projects).set({ status: owned ? "running" : "unknown", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
      continue;
    }
    if (p.status === "unknown" && owned) {
      store.db.update(dbSchema.projects).set({ status: "running", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
      continue;
    }
    if (p.autoStart && (p.status === "stopped" || p.status === "crashed") && !owned) {
      if (!fs.existsSync(p.path)) {
        store.db.update(dbSchema.projects).set({ status: "unknown", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
        appendSysLog(p.id, "managed files missing, marked unknown");
        continue;
      }
      if (!(await isPortFree(p.port))) {
        appendSysLog(p.id, `auto-start skipped, port ${p.port} occupied`);
        continue;
      }
      try {
        store.db.update(dbSchema.projects).set({ status: "starting", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
        const pid = await startProjectRecord(p);
        store.db.update(dbSchema.projects).set({ status: "running", pid, updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
      } catch (e) {
        store.db.update(dbSchema.projects).set({ status: "crashed", updatedAt: now() }).where(eq(dbSchema.projects.id, p.id)).run();
        appendSysLog(p.id, `auto-start failed: ${(e as Error).message}`);
      }
    }
  }
}

function sweepStaleStaging(maxAgeMs = 24 * 3600 * 1000): void {
  try {
    for (const entry of fs.readdirSync(store.stagingDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(store.stagingDir, entry.name);
      try {
        const age = Date.now() - fs.statSync(full).mtimeMs;
        if (age > maxAgeMs) fs.rmSync(full, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  } catch { /* staging may not exist yet */ }
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
sweepStaleStaging();
setInterval(() => { reconcile().catch(() => undefined); }, 30000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, stopping hosted projects...`);
  try {
    const rows = await listProjects(store);
    for (const p of rows) stopHosting(p.id);
    await app.close();
  } catch { /* exiting anyway */ }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: env.DASHBOARD_PORT, host: env.BIND_HOST });
} catch (e) {
  console.error(`Cannot listen on ${env.BIND_HOST}:${env.DASHBOARD_PORT}: ${(e as Error).message}`);
  process.exit(1);
}
console.log(`Dashboard: http://${env.BIND_HOST}:${env.DASHBOARD_PORT}`);
