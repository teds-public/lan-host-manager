import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATED = 3;

export function logFileFor(logsDir: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid log id");
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, `${id}.log`);
}

export function writeLog(logFile: string, tag: string, data: string): void {
  const lines = data.split("\n").filter((l) => l.length > 0).slice(-5000);
  if (lines.length === 0) return;
  const stamped = lines.map((l) => `[${new Date().toISOString()}] [${tag}] ${l.slice(0, 2000)}\n`).join("");
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, stamped);
    rotateIfNeeded(logFile);
  } catch { /* logging must never crash the host */ }
}

function rotateIfNeeded(logFile: string): void {
  let size = 0;
  try { size = fs.statSync(logFile).size; } catch { return; }
  if (size <= MAX_BYTES) return;
  try {
    fs.rmSync(`${logFile}.${KEEP_ROTATED}`, { force: true });
    for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${logFile}.${i + 1}`);
    }
    fs.renameSync(logFile, `${logFile}.1`);
  } catch { /* ignore */ }
}

export function readTail(logFile: string, maxBytes = 200 * 1024): string {
  const parts: string[] = [];
  const files = [logFile, ...Array.from({ length: KEEP_ROTATED }, (_, i) => `${logFile}.${i + 1}`)];
  let remaining = maxBytes;
  try {
    for (const f of files) {
      if (remaining <= 0 || !fs.existsSync(f)) continue;
      const st = fs.statSync(f);
      const take = Math.min(st.size, remaining);
      const buf = Buffer.alloc(take);
      const fd = fs.openSync(f, "r");
      try { fs.readSync(fd, buf, 0, take, st.size - take); } finally { fs.closeSync(fd); }
      parts.unshift(buf.toString("utf-8"));
      remaining -= take;
    }
  } catch { /* return what we have */ }
  return parts.join("");
}
