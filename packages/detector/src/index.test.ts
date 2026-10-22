import { describe, expect, it } from "vitest";
import { detectProject } from "./index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "detect-"));
  return d;
}

describe("detector", () => {
  it("detects node projects", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { start: "node index.js" } }));
    const r = detectProject(d);
    expect(r.type).toBe("node");
    expect(r.scripts?.start).toBe("node index.js");
  });

  it("detects static projects with dist/index.html", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "dist"));
    fs.writeFileSync(path.join(d, "dist", "index.html"), "<h1>hi</h1>");
    const r = detectProject(d);
    expect(r.type).toBe("static");
    expect(r.serveDirCandidates).toContain("dist");
  });

  it("hosts other archives as plain files", () => {
    const r = detectProject(tmp());
    expect(r.type).toBe("files");
    expect(r.serveDirCandidates).toContain(".");
  });
});
