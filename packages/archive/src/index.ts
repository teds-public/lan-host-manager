import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ExtractLimits {
  maxEntries: number;
  maxDecompressedMb: number;
  timeoutSec: number;
}

export interface ExtractResult {
  outDir: string;
  rootDir: string;
  entries: number;
}

function isSafeEntry(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:\//.test(n)) return false;
  const parts = n.split("/");
  let depth = 0;
  for (const p of parts) {
    if (p === "..") { depth -= 1; if (depth < 0) return false; }
    else if (p !== "" && p !== ".") depth += 1;
  }
  return true;
}

function findRoot(outDir: string): string {
  const entries = fs.readdirSync(outDir);
  if (entries.length === 1) {
    const only = path.join(outDir, entries[0]!);
    if (fs.statSync(only).isDirectory()) return only;
  }
  return outDir;
}

export function validateArchiveName(name: string): void {
  if (!name.toLowerCase().endsWith(".rar")) throw new Error("Only .rar archives are accepted");
}

function resolveRarBinary(configured: string): string | null {
  const candidates = [configured, "unrar", "rar", "WinRAR.exe"].filter(Boolean);
  for (const c of candidates) {
    if (path.isAbsolute(c) && fs.existsSync(c)) return c;
  }
  return candidates.length > 0 ? candidates[0]! : null;
}

export async function extractRar(
  archivePath: string,
  stagingDir: string,
  rarBinary: string,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const bin = resolveRarBinary(rarBinary);
  if (!bin) {
    throw new Error(
      "No RAR extraction utility found. Install WinRAR (Windows) or unrar (Linux: apt install unrar), then set the rarBinary path in Settings.",
    );
  }
  const outDir = path.join(stagingDir, `extract-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["x", "-o+", archivePath, `${outDir}${path.sep}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Extraction timed out after ${limits.timeoutSec}s`));
    }, limits.timeoutSec * 1000);
    child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`RAR utility not usable (${bin}): ${err.message}. Install WinRAR/unrar and set rarBinary in Settings.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Extraction failed (exit ${code}): ${output.slice(0, 500)}`));
      else resolve();
    });
  });

  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(outDir, full).replace(/\\/g, "/");
      if (!isSafeEntry(rel)) {
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      if (e.isSymbolicLink()) { fs.rmSync(full, { force: true }); continue; }
      if (e.isDirectory()) walk(full);
      else entries.push(rel);
    }
  };
  walk(outDir);

  if (entries.length > limits.maxEntries) {
    throw new Error(`Archive has ${entries.length} entries, over the limit of ${limits.maxEntries}`);
  }
  let total = 0;
  for (const rel of entries) total += fs.statSync(path.join(outDir, rel)).size;
  if (total > limits.maxDecompressedMb * 1024 * 1024) {
    throw new Error(`Decompressed size exceeds ${limits.maxDecompressedMb} MB limit`);
  }
  return { outDir, rootDir: findRoot(outDir), entries: entries.length };
}
