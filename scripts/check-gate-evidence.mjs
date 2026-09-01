import fs from "node:fs";
import { execFileSync } from "node:child_process";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  console.log("Gate evidence check: local run (no GitHub pull-request event); PASS");
  process.exit(0);
}

const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
const labels = (event.pull_request?.labels ?? [])
  .map((label) => (typeof label?.name === "string" ? label.name.toLowerCase() : ""))
  .filter((label) => /^milestone-[a-e]$/.test(label));

if (labels.length === 0) {
  console.log("Gate evidence check: no milestone label; PASS");
  process.exit(0);
}

const baseSha = event.pull_request?.base?.sha;
const headSha = event.pull_request?.head?.sha;
if (typeof baseSha !== "string" || typeof headSha !== "string") {
  throw new Error("Could not resolve the pull request base/head commit for gate evidence check");
}

const changedFiles = execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha}`], { encoding: "utf8" })
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);
const missing = [...new Set(labels)]
  .map((label) => `docs/gates/${label}.md`)
  .filter((expected) => !changedFiles.includes(expected));

if (missing.length > 0) {
  console.error("Gate evidence check failed. Milestone-labeled PRs must change:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Gate evidence check: PASS (${[...new Set(labels)].join(", ")})`);
