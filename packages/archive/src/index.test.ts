import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { extractZip, detectArchiveKind } from "./index.js";

function crc32(buf: Buffer): number {
  let table: number[] | null = (crc32 as unknown as { t?: number[] }).t ?? null;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as unknown as { t: number[] }).t = table;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[b ^ (crc & 0xff)]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: { name: string; data: Buffer; method?: number }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const name = Buffer.from(e.name, "utf-8");
    const comp = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(method, 10);
    lh.writeUInt32LE(crc32(e.data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(e.data), 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  offset += centralBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

describe("zip", () => {
  it("detects rar vs zip", () => {
    expect(detectArchiveKind("a.RAR")).toBe("rar");
    expect(detectArchiveKind("b.zip")).toBe("zip");
    expect(() => detectArchiveKind("c.7z")).toThrow();
  });

  it("extracts stored and deflated files", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const archive = join(dir, "t.zip");
    writeFileSync(archive, buildZip([
      { name: "index.html", data: Buffer.from("<h1>hi</h1>"), method: 0 },
      { name: "js/app.js", data: Buffer.from("console.log(1)".repeat(100)) },
    ]));
    const r = extractZip(archive, dir, { maxEntries: 100, maxDecompressedMb: 64, timeoutSec: 30 });
    expect(readFileSync(join(r.rootDir, "index.html"), "utf-8")).toBe("<h1>hi</h1>");
    expect(r.entries).toBe(2);
  });

  it("skips traversal entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const archive = join(dir, "t.zip");
    writeFileSync(archive, buildZip([
      { name: "../evil.txt", data: Buffer.from("x"), method: 0 },
      { name: "ok.txt", data: Buffer.from("ok"), method: 0 },
    ]));
    const r = extractZip(archive, dir, { maxEntries: 100, maxDecompressedMb: 64, timeoutSec: 30 });
    expect(existsSync(join(dir, "evil.txt"))).toBe(false);
    expect(readFileSync(join(r.rootDir, "ok.txt"), "utf-8")).toBe("ok");
  });

  it("unwraps a single real dir despite junk entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const archive = join(dir, "t.zip");
    writeFileSync(archive, buildZip([
      { name: "__MACOSX/._root", data: Buffer.from("junk"), method: 0 },
      { name: "root/a/index.html", data: Buffer.from("<h1>a</h1>"), method: 0 },
      { name: "root/b/index.html", data: Buffer.from("<h1>b</h1>"), method: 0 },
      { name: "root/c/index.html", data: Buffer.from("<h1>c</h1>"), method: 0 },
      { name: "root/d/index.html", data: Buffer.from("<h1>d</h1>"), method: 0 },
    ]));
    const r = extractZip(archive, dir, { maxEntries: 100, maxDecompressedMb: 64, timeoutSec: 30 });
    expect(r.entries).toBe(4);
    expect(readFileSync(join(r.rootDir, "a", "index.html"), "utf-8")).toBe("<h1>a</h1>");
    expect(existsSync(join(r.rootDir, "__MACOSX"))).toBe(false);
  });

  it("enforces entry limits", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const archive = join(dir, "t.zip");
    writeFileSync(archive, buildZip([
      { name: "a.txt", data: Buffer.from("a"), method: 0 },
      { name: "b.txt", data: Buffer.from("b"), method: 0 },
    ]));
    expect(() => extractZip(archive, dir, { maxEntries: 1, maxDecompressedMb: 64, timeoutSec: 30 })).toThrow(/over the limit/);
  });
});
