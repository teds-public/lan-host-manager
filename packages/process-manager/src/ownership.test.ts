import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logFileFor, writeLog, readTail } from "./log.js";
import { startManaged, stopManaged, isRunning, getExitCode } from "./index.js";

describe("log rotation", () => {
  it("rotates overgrown logs and keeps history", () => {
    const dir = mkdtempSync(join(tmpdir(), "log-"));
    const file = logFileFor(dir, "proj1");
    writeLog(file, "out", Array.from({ length: 6000 }, (_, i) => `line-${i}-` + "x".repeat(1500)).join("\n"));
    expect(existsSync(`${file}.1`)).toBe(true);
    writeLog(file, "out", "fresh-line");
    const tail = readTail(file);
    expect(tail).toContain("fresh-line");
  });

  it("rejects path-traversal log ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "log-"));
    expect(() => logFileFor(dir, "../evil")).toThrow();
  });

  it("readTail returns empty for missing files", () => {
    expect(readTail(join(tmpdir(), "does-not-exist-12345.log"))).toBe("");
  });
});

describe("process ownership", () => {
  it("isRunning is false after owned process exits, even with pid reuse check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-"));
    const logFile = join(dir, "t.log");
    const cmd = process.platform === "win32" ? "cmd" : "sleep";
    const args = process.platform === "win32" ? ["/c", "exit 3"] : ["0.1"];
    const p = startManaged("own-exit", cmd, args, { cwd: dir, logFile });
    expect(p.pid).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1500));
    expect(isRunning("own-exit", p.pid)).toBe(false);
    expect(getExitCode("own-exit")).toBe(3);
  });

  it("stopManaged twice is safe", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-"));
    const cmd = process.platform === "win32" ? "ping" : "sleep";
    const args = process.platform === "win32" ? ["-n", "30", "127.0.0.1"] : ["30"];
    startManaged("twice", cmd, args, { cwd: dir, logFile: join(dir, "t.log") });
    expect(stopManaged("twice")).toBe(true);
    expect(stopManaged("twice")).toBe(false);
  });
});
