import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src", "graphify");
const publicDir = path.join(repoRoot, "public", "graphify");
const fileArtifacts = ["graph.html", "GRAPH_REPORT.md", "graph.json"];
const dirArtifacts = ["wiki"];

fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });

for (const file of fileArtifacts) {
  const src = path.join(srcDir, file);
  const dst = path.join(publicDir, file);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing graphify artifact: ${src}`);
  }
  fs.copyFileSync(src, dst);
}

for (const dir of dirArtifacts) {
  const src = path.join(srcDir, dir);
  const dst = path.join(publicDir, dir);
  if (!fs.existsSync(src)) {
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

console.log("graphify assets synced:", [...fileArtifacts, ...dirArtifacts].join(", "));
