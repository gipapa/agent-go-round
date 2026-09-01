import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const BUDGET_PATH = path.join(ROOT, "bundle-budget.json");

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function relativeDistPath(absolutePath) {
  return path.relative(DIST_DIR, absolutePath).split(path.sep).join("/");
}

function formatBytes(value) {
  return `${value.toLocaleString("en-US")} B (${(value / 1024).toFixed(1)} KiB)`;
}

async function findInitialRouteJavaScript(indexHtml, files) {
  const scriptSources = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]);
  if (scriptSources.length === 0) {
    throw new Error("Could not find an initial route script in dist/index.html");
  }

  const fileByBasename = new Map();
  for (const file of files.filter((candidate) => candidate.endsWith(".js"))) {
    const basename = path.basename(file);
    const existing = fileByBasename.get(basename) ?? [];
    existing.push(file);
    fileByBasename.set(basename, existing);
  }

  const initialFiles = [];
  for (const source of scriptSources) {
    const basename = path.basename(new URL(source, "https://bundle-budget.invalid").pathname);
    const matches = fileByBasename.get(basename) ?? [];
    if (matches.length !== 1) {
      throw new Error(`Could not resolve initial route script ${source}`);
    }
    initialFiles.push(matches[0]);
  }
  return [...new Set(initialFiles)];
}

async function main() {
  const [budgetRaw, indexHtml, files] = await Promise.all([
    fs.readFile(BUDGET_PATH, "utf8"),
    fs.readFile(path.join(DIST_DIR, "index.html"), "utf8"),
    collectFiles(DIST_DIR)
  ]);
  const budget = JSON.parse(budgetRaw);
  const stats = new Map();
  for (const file of files) {
    const data = await fs.readFile(file);
    stats.set(file, {
      bytes: data.byteLength,
      gzipBytes: gzipSync(data, { level: 9 }).byteLength
    });
  }

  const javascriptFiles = files.filter((file) => file.endsWith(".js"));
  const initialFiles = await findInitialRouteJavaScript(indexHtml, files);
  const metrics = {
    initialRouteJsGzipBytes: initialFiles.reduce((total, file) => total + stats.get(file).gzipBytes, 0),
    maxSingleChunkGzipBytes: Math.max(...javascriptFiles.map((file) => stats.get(file).gzipBytes)),
    totalGzipBytes: files.reduce((total, file) => total + stats.get(file).gzipBytes, 0),
    distBytes: files.reduce((total, file) => total + stats.get(file).bytes, 0),
    initialRouteFiles: initialFiles.map(relativeDistPath),
    largestChunk: javascriptFiles
      .map((file) => ({ file: relativeDistPath(file), gzipBytes: stats.get(file).gzipBytes }))
      .sort((left, right) => right.gzipBytes - left.gzipBytes)[0]
  };

  const budgetMetrics = budget?.budgets;
  if (!budgetMetrics || typeof budgetMetrics !== "object") {
    throw new Error(`${path.relative(ROOT, BUDGET_PATH)} must contain a budgets object`);
  }

  console.log(`Initial route JS gzip: ${formatBytes(metrics.initialRouteJsGzipBytes)} (${metrics.initialRouteFiles.join(", ")})`);
  console.log(`Largest JS chunk gzip: ${formatBytes(metrics.maxSingleChunkGzipBytes)} (${metrics.largestChunk.file})`);
  console.log(`Total dist gzip: ${formatBytes(metrics.totalGzipBytes)}`);
  console.log(`Total dist bytes: ${formatBytes(metrics.distBytes)}`);

  const failures = [];
  for (const key of ["initialRouteJsGzipBytes", "maxSingleChunkGzipBytes", "totalGzipBytes"]) {
    const measured = metrics[key];
    const allowed = budgetMetrics[key];
    if (!Number.isFinite(allowed)) {
      failures.push(`${key}: budget is not a finite number`);
    } else if (measured > allowed) {
      failures.push(`${key}: ${formatBytes(measured)} exceeds ${formatBytes(allowed)}`);
    } else {
      console.log(`Budget ${key}: PASS (<= ${formatBytes(allowed)})`);
    }
  }

  if (failures.length > 0) {
    console.error("Bundle budget check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
