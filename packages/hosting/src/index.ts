import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startManaged, stopManaged, isRunning, getExitCode } from "@lan/process-manager";
import { writeLog } from "@lan/process-manager";

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".map": "application/json", ".txt": "text/plain",
};

const servers = new Map<string, http.Server>();

function resolveServeFile(root: string, url: string | undefined, spaFallback: boolean): string | null {
  const urlPath = decodeURIComponent(new URL(url ?? "/", "http://x").pathname);
  const file = path.resolve(root, `.${urlPath}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  let target = file;
  try {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  } catch { return null; }
  if (!fs.existsSync(target) && spaFallback) target = path.join(root, "index.html");
  if (!fs.existsSync(target) || (target !== root && !target.startsWith(`${root}${path.sep}`))) return null;
  return target;
}

export function serveStatic(
  id: string, dir: string, port: number, spaFallback: boolean, host: string,
  logFile: string,
): Promise<void> {
  stopHosting(id);
  const root = path.resolve(dir);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end("Method not allowed"); return; }
      try {
        const target = resolveServeFile(root, req.url, spaFallback);
        if (!target) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream" });
        if (req.method === "HEAD") { res.end(); return; }
        fs.createReadStream(target).on("error", () => {
          try { res.writeHead(500); res.end("Error"); } catch { /* closed */ }
        }).pipe(res);
      } catch { res.writeHead(500); res.end("Error"); }
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      servers.delete(id);
      writeLog(logFile, "sys", `static server error: ${err.message}`);
      reject(err);
    });
    server.listen(port, host, () => {
      servers.set(id, server);
      writeLog(logFile, "sys", `serving ${root} on ${host}:${port}`);
      resolve();
    });
  });
}

export function startNode(
  id: string, cwd: string, startCommand: string, port: number, host: string,
  logFile: string, onExit?: (code: number | null) => void,
): number | null {
  stopHosting(id);
  const parts = startCommand.split(/\s+/).filter(Boolean);
  const cmd = parts[0];
  if (!cmd || /[;&|`$%!^"'<>()\n\r]/.test(startCommand)) throw new Error("Invalid start command");
  const args = parts.slice(1);
  const p = startManaged(id, cmd, args, {
    cwd, logFile, onExit,
    env: { PORT: String(port), HOST: host },
  });
  return p.pid;
}

export function stopHosting(id: string): void {
  const srv = servers.get(id);
  if (srv) {
    try { srv.close(); } catch { /* ignore */ }
    servers.delete(id);
  }
  stopManaged(id);
}

export function isHosting(id: string, pid: number | null = null): boolean {
  return servers.has(id) || isRunning(id, pid);
}

export function nodeExitCode(id: string): number | null {
  return getExitCode(id);
}
