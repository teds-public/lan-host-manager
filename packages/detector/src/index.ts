import fs from "node:fs";
import path from "node:path";

export interface DetectionResult {
  type: "static" | "node" | "unknown";
  rootDir: string;
  serveDirCandidates: string[];
  entryFile?: string;
  scripts?: Record<string, string>;
  notes: string[];
}

const BUILD_DIRS = ["dist", "build", "out", "public", "_site"];

export function detectProject(rootDir: string): DetectionResult {
  const notes: string[] = [];
  const pkgFile = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8")) as { scripts?: Record<string, string> };
      return {
        type: "node",
        rootDir,
        serveDirCandidates: [],
        scripts: pkg.scripts ?? {},
        notes: ["package.json found. Choose a start script; dependencies install only with your approval."],
      };
    } catch {
      notes.push("package.json exists but is not valid JSON.");
    }
  }
  const serveDirCandidates: string[] = [];
  for (const d of BUILD_DIRS) {
    if (fs.existsSync(path.join(rootDir, d, "index.html"))) serveDirCandidates.push(d);
  }
  if (fs.existsSync(path.join(rootDir, "index.html"))) serveDirCandidates.unshift(".");
  if (serveDirCandidates.length > 0) {
    return { type: "static", rootDir, serveDirCandidates, entryFile: "index.html", notes };
  }
  return { type: "unknown", rootDir, serveDirCandidates: [], notes: ["No index.html or package.json detected. Unsupported runtime."] };
}
