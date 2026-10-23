import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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

export type ArchiveKind = "rar" | "zip";

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

const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.Spotlight-V100|\.Trashes|\.fseventsd)($|\/)/i;

function isJunkEntry(rel: string): boolean {
  return JUNK_RE.test(rel.replace(/\\/g, "/"));
}

function stripJunkEntries(outDir: string): void {
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(outDir, full).replace(/\\/g, "/");
      if (isJunkEntry(e.name) || isJunkEntry(rel)) {
        fs.rmSync(full, { recursive: true, force: true });
      } else if (e.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(outDir);
}

export function detectArchiveKind(name: string): ArchiveKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".rar")) return "rar";
  throw new Error("Only .rar and .zip archives are accepted");
}

export function validateArchiveName(name: string): void {
  detectArchiveKind(name);
}

function containedPath(outDir: string, rel: string): string {
  const full = path.resolve(outDir, rel);
  if (full !== outDir && !full.startsWith(`${outDir}${path.sep}`)) {
    throw new Error(`Unsafe entry path: ${rel}`);
  }
  return full;
}

function checkLimits(entries: number, totalBytes: number, limits: ExtractLimits): void {
  if (entries > limits.maxEntries) {
    throw new Error(`Archive has ${entries} entries, over the limit of ${limits.maxEntries}`);
  }
  if (totalBytes > limits.maxDecompressedMb * 1024 * 1024) {
    throw new Error(`Decompressed size exceeds ${limits.maxDecompressedMb} MB limit`);
  }
}

function resolveRarBinary(configured: string): string | null {
  const exeNames = ["Rar.exe", "UnRAR.exe", "unrar", "rar", "WinRAR.exe"];
  const candidates: string[] = [];
  if (configured) {
    const dir = path.dirname(configured);
    for (const exe of ["Rar.exe", "UnRAR.exe"]) {
      const sibling = path.join(dir, exe);
      if (fs.existsSync(sibling)) candidates.push(sibling);
    }
    candidates.push(configured);
  }
  candidates.push(...exeNames);
  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return candidates.length > 0 ? candidates[0]! : null;
}

async function extractRar(
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
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
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

  stripJunkEntries(outDir);
  let total = 0;
  for (const rel of entries) total += fs.statSync(path.join(outDir, rel)).size;
  checkLimits(entries.length, total, limits);
  return { outDir, rootDir: outDir, entries: entries.length };
}

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttrs: number;
  localHeaderOffset: number;
}

function readEocd(buf: Buffer): { centralOffset: number; centralCount: number } {
  const EOCD_SIG = 0x06054b50;
  const tailSize = Math.min(buf.length, 22 + 65535);
  for (let i = buf.length - 22; i >= buf.length - tailSize; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      return {
        centralCount: buf.readUInt16LE(i + 10),
        centralOffset: buf.readUInt32LE(i + 16),
      };
    }
  }
  throw new Error("Invalid zip file: end-of-central-directory not found");
}

function parseCentralDirectory(buf: Buffer, offset: number, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Invalid zip file: corrupt central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf-8");
    entries.push({ name, method, flags, compressedSize, uncompressedSize, externalAttrs, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function isZipSymlink(entry: ZipEntry): boolean {
  const unixMode = (entry.externalAttrs >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

export function extractZip(
  archivePath: string,
  stagingDir: string,
  limits: ExtractLimits,
): ExtractResult {
  const buf = fs.readFileSync(archivePath);
  const { centralOffset, centralCount } = readEocd(buf);
  if (centralOffset > buf.length) throw new Error("Invalid zip file: central directory out of bounds");
  const entries = parseCentralDirectory(buf, centralOffset, centralCount);
  checkLimits(entries.length, entries.reduce((s, e) => s + e.uncompressedSize, 0), limits);

  const outDir = path.join(stagingDir, `extract-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  let total = 0;
  try {
    for (const entry of entries) {
      const rel = entry.name.replace(/\\/g, "/");
      if (!isSafeEntry(rel)) continue;
      if (isJunkEntry(rel)) continue;
      if (entry.flags & 0x1) throw new Error(`Encrypted entry not supported: ${rel}`);
      if (isZipSymlink(entry)) continue;
      const full = containedPath(outDir, rel);
      if (rel.endsWith("/")) { fs.mkdirSync(full, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const lh = entry.localHeaderOffset;
      if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("Invalid zip file: corrupt local header");
      const nameLen = buf.readUInt16LE(lh + 26);
      const extraLen = buf.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + nameLen + extraLen;
      const dataEnd = dataStart + entry.compressedSize;
      if (dataEnd > buf.length) throw new Error("Invalid zip file: entry data out of bounds");
      const raw = buf.subarray(dataStart, dataEnd);
      let content: Buffer;
      if (entry.method === 0) content = Buffer.from(raw);
      else if (entry.method === 8) content = zlib.inflateRawSync(raw, { maxOutputLength: limits.maxDecompressedMb * 1024 * 1024 });
      else throw new Error(`Unsupported compression method ${entry.method} for entry: ${rel}`);
      total += content.length;
      checkLimits(entries.length, total, limits);
      fs.writeFileSync(full, content);
      written.push(rel);
    }
  } catch (err) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw err;
  }
  stripJunkEntries(outDir);
  return { outDir, rootDir: outDir, entries: written.length };
}

export async function extractArchive(
  archivePath: string,
  stagingDir: string,
  rarBinary: string,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const kind = detectArchiveKind(archivePath);
  if (kind === "zip") return extractZip(archivePath, stagingDir, limits);
  return extractRar(archivePath, stagingDir, rarBinary, limits);
}
