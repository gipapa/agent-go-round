import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src", "graphify");
const publicDir = path.join(repoRoot, "public", "graphify");
const files = ["graph.html", "GRAPH_REPORT.md", "graph.json"];

fs.mkdirSync(publicDir, { recursive: true });

for (const entry of fs.readdirSync(publicDir)) {
  const target = path.join(publicDir, entry);
  if (fs.statSync(target).isFile() && !files.includes(entry)) {
    fs.rmSync(target, { force: true });
  }
}

for (const file of files) {
  const src = path.join(srcDir, file);
  const dst = path.join(publicDir, file);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing graphify artifact: ${src}`);
  }
  fs.copyFileSync(src, dst);
}

console.log("graphify assets synced:", files.join(", "));
