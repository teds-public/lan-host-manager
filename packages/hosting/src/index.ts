import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

const servers = new Map<string, http.Server>();
const nodeProcs = new Map<string, ChildProcess>();

export function serveStatic(id: string, dir: string, port: number, spaFallback: boolean, host: string): void {
  stopHosting(id);
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      let file = path.resolve(root, `.${urlPath}`);
      if (!file.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file) && spaFallback) file = path.join(root, "index.html");
      if (!fs.existsSync(file) || !file.startsWith(root)) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(500); res.end("Error"); }
  });
  server.listen(port, host);
  servers.set(id, server);
}

export function startNode(
  id: string, cwd: string, startCommand: string, port: number, host: string,
  onLog: (tag: string, data: string) => void,
): number | null {
  stopHosting(id);
  const parts = startCommand.split(/\s+/).filter(Boolean);
  const cmd = parts[0]!;
  const args = parts.slice(1);
  const child = spawn(cmd, args, {
    cwd, shell: false, windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: host },
  });
  child.stdout?.on("data", (d: Buffer) => onLog("out", d.toString()));
  child.stderr?.on("data", (d: Buffer) => onLog("err", d.toString()));
  nodeProcs.set(id, child);
  return child.pid ?? null;
}

export function stopHosting(id: string): void {
  servers.get(id)?.close();
  servers.delete(id);
  const c = nodeProcs.get(id);
  if (c && c.exitCode === null) {
    try {
      if (process.platform === "win32" && c.pid) {
        spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      } else c.kill("SIGTERM");
    } catch { /* noop */ }
  }
  nodeProcs.delete(id);
}

export function isHosting(id: string): boolean {
  return servers.has(id) || (nodeProcs.get(id)?.exitCode === null && nodeProcs.has(id));
}
