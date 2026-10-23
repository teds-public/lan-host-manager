import { spawn, type ChildProcess } from "node:child_process";
import { writeLog, logFileFor } from "./log.js";

export { writeLog, logFileFor, readTail } from "./log.js";

export interface ManagedProcess {
  id: string;
  pid: number | null;
  exitCode: number | null;
  logFile: string;
}

interface Entry {
  child: ChildProcess;
  logFile: string;
  exitCode: number | null;
  onExit?: (code: number | null) => void;
  killTimer?: NodeJS.Timeout;
}

const procs = new Map<string, Entry>();

export function startManaged(
  id: string,
  command: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; logFile: string; onExit?: (code: number | null) => void },
): ManagedProcess {
  stopManaged(id);
  // Windows: npm/node are .cmd shims, resolvable only via the shell.
  // Callers must reject shell metacharacters before reaching here.
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: process.platform === "win32",
    windowsHide: true,
  });
  const entry: Entry = { child, logFile: opts.logFile, exitCode: null, onExit: opts.onExit };
  procs.set(id, entry);
  writeLog(opts.logFile, "sys", `spawned pid ${child.pid ?? "?"}: ${command} ${args.join(" ")}`);
  child.stdout?.on("data", (d: Buffer) => writeLog(entry.logFile, "out", d.toString()));
  child.stderr?.on("data", (d: Buffer) => writeLog(entry.logFile, "err", d.toString()));
  child.on("error", (err) => writeLog(entry.logFile, "sys", `spawn error: ${err.message}`));
  child.on("exit", (code, signal) => {
    entry.exitCode = code;
    writeLog(entry.logFile, "sys", `process exited code=${code} signal=${signal ?? "none"}`);
    try { entry.onExit?.(code); } catch { /* never throw from exit handler */ }
  });
  return { id, pid: child.pid ?? null, exitCode: null, logFile: opts.logFile };
}

/** Stop only the process this manager started for id. Never kills by raw PID. */
export function stopManaged(id: string, timeoutMs = 8000): boolean {
  const entry = procs.get(id);
  if (!entry || entry.exitCode !== null) { procs.delete(id); return false; }
  const { child } = entry;
  try {
    if (process.platform === "win32") {
      if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      procs.delete(id);
    } else {
      child.kill("SIGTERM");
      entry.killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        procs.delete(id);
      }, timeoutMs);
      entry.killTimer.unref?.();
      child.once("exit", () => {
        if (entry.killTimer) clearTimeout(entry.killTimer);
        procs.delete(id);
      });
    }
  } catch {
    procs.delete(id);
  }
  return true;
}

/** True only if this manager still owns a live child for id. Falls back to PID liveness. */
export function isRunning(id: string, pid: number | null): boolean {
  const entry = procs.get(id);
  if (entry) return entry.exitCode === null;
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function getExitCode(id: string): number | null {
  return procs.get(id)?.exitCode ?? null;
}
