import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ManagedProcess {
  id: string;
  pid: number | null;
  exitCode: number | null;
  logFile: string;
}

const procs = new Map<string, ChildProcess>();

export function logFileFor(logsDir: string, id: string): string {
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, `${id}.log`);
}

function appendLog(logFile: string, tag: string, data: string): void {
  const line = data.split("\n").filter(Boolean).map((l) => `[${new Date().toISOString()}] [${tag}] ${l}\n`).join("");
  fs.appendFileSync(logFile, line);
  rotateIfNeeded(logFile);
}

function rotateIfNeeded(logFile: string): void {
  try {
    const st = fs.statSync(logFile);
    if (st.size > 5 * 1024 * 1024) {
      fs.renameSync(logFile, `${logFile}.1`);
    }
  } catch { /* ignore */ }
}

export function startManaged(
  id: string,
  command: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; logFile: string },
): ManagedProcess {
  stopManaged(id);
  const logFile = opts.logFile;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: false,
    windowsHide: true,
  });
  procs.set(id, child);
  child.stdout?.on("data", (d: Buffer) => appendLog(logFile, "out", d.toString()));
  child.stderr?.on("data", (d: Buffer) => appendLog(logFile, "err", d.toString()));
  child.on("exit", (code) => appendLog(logFile, "sys", `process exited with code ${code}`));
  return { id, pid: child.pid ?? null, exitCode: null, logFile };
}

export function stopManaged(id: string): boolean {
  const child = procs.get(id);
  if (!child || child.exitCode !== null) { procs.delete(id); return false; }
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, 5000).unref?.();
    }
  } catch { /* noop */ }
  procs.delete(id);
  return true;
}

export function isRunning(id: string, pid: number | null): boolean {
  const child = procs.get(id);
  if (child) return child.exitCode === null;
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function getChild(id: string): ChildProcess | undefined {
  return procs.get(id);
}
