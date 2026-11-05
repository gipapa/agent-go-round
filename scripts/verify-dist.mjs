import { access, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const dist = new URL("../dist/", import.meta.url);

async function read(relativePath) {
  const path = new URL(relativePath, dist);
  await access(path);
  return readFile(path, "utf8");
}

const index = await read("index.html");
const embed = await read("embed.js");
const example = await read("embed-example.html");
const basePath = process.env.VITE_BASE_PATH || "/";

if (!index.includes("<title>AgentGoRound</title>")) throw new Error("dist/index.html is missing the app title");
if (!index.includes(`${basePath}assets/`)) throw new Error(`dist/index.html does not reference assets under ${basePath}`);
if (!embed.includes("AgentGoRound")) throw new Error("dist/embed.js does not contain the public loader");
if (!example.includes('src="./embed.js"')) throw new Error("dist/embed-example.html does not load the local embed loader");
const probe = await read("poc/just-bash.html");
if (!probe.includes(`${basePath}assets/`)) throw new Error("P0 browser probe has an incorrect base path");
const workers = (await readdir(new URL("assets/", dist))).filter(name => /^just-bash-probe\.worker-.*\.js$/.test(name));
if (workers.length !== 1) throw new Error("Expected the compiled just-bash P0 Worker");
const worker = await read(`assets/${workers[0]}`);
if (worker.includes("VITE_GROQ_API_KEY")) throw new Error("Worker must not contain provider configuration");
const runtimeWorkers = (await readdir(new URL("assets/", dist))).filter(name => /^_virtual_agent-go-round-shell-worker-.*\.js$/.test(name));
if (runtimeWorkers.length !== 1) throw new Error("Expected the isolated shell Worker program chunk");
const program = await read(`assets/${runtimeWorkers[0]}`);
if (!program.includes("AgentGoRound modification: just-bash 3.6.0 public exec result.cwd")) throw new Error("The formal Worker is missing the public cwd patch notice");
await read("licenses/index.html");
const modifications = await read("licenses/just-bash-modifications.txt");
if (!modifications.includes("37977c1541791bb2f5182ba9453566301c15082faee7c1a4c89eaec0ec8e543f")) throw new Error("Missing just-bash modifications notice");
const bashLicense = await read("licenses/just-bash-3.6.0-LICENSE.txt");
const piLicense = await read("licenses/pi-0.84.4-LICENSE.txt");
if (!bashLicense.includes("Apache License") || !bashLicense.includes("Copyright 2025 Vercel Inc.")) throw new Error("Missing full just-bash license");
if (!piLicense.includes("Copyright (c) 2025 Mario Zechner") || !piLicense.includes("Permission is hereby granted")) throw new Error("Missing full Pi license");
const licenses = JSON.parse(await read("licenses/index.json"));
const lock = await readFile(new URL("../package-lock.json", import.meta.url));
if (licenses.lockfileSha256 !== createHash("sha256").update(lock).digest("hex")) throw new Error("License inventory is stale; run npm run licenses:generate");
for (const [name, version] of [["just-bash", "3.6.0"], ["@earendil-works/pi-ai", "0.84.4"], ["@earendil-works/pi-agent-core", "0.84.4"]]) {
  if (!licenses.packages.some(pkg => pkg.name === name && pkg.version === version && pkg.texts.length)) throw new Error(`Missing license record for ${name}@${version}`);
}
const notices = await read("licenses/THIRD_PARTY_NOTICES.txt");
if (!notices.includes("Bundled license information:") || !notices.includes("ieee754")) throw new Error("Missing upstream bundled notices");
if (licenses.noticesSha256 !== createHash("sha256").update(notices).digest("hex")) throw new Error("Third-party license texts do not match the inventory");

console.log(`Verified dist artifacts for base path ${basePath}`);
