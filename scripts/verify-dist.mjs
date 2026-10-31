import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

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

console.log(`Verified dist artifacts for base path ${basePath}`);
