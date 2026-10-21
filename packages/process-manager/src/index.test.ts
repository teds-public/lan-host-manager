import { describe, expect, it } from "vitest";
import { startManaged, stopManaged, isRunning } from "./index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("process-manager", () => {
  it("starts and stops a process by ownership handle", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-"));
    const logFile = path.join(dir, "t.log");
    const cmd = process.platform === "win32" ? "ping" : "sleep";
    const args = process.platform === "win32" ? ["-n", "30", "127.0.0.1"] : ["30"];
    const p = startManaged("test-proc", cmd, args, { cwd: dir, logFile });
    expect(p.pid).toBeTruthy();
    expect(isRunning("test-proc", p.pid)).toBe(true);
    stopManaged("test-proc");
    await new Promise((r) => setTimeout(r, 1500));
    expect(isRunning("test-proc", p.pid)).toBe(false);
  });
});
