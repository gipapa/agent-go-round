import { expect, it } from "vitest";
import { getCommandNames } from "just-bash/browser";
import { MemoryFileSystem } from "./fs";
import { DEFAULT_BIN_TOOLS } from "./bin-defaults";
import { SHELL_COMMANDS } from "./shell-catalog";
import { initializeWorkspace, DEFAULT_AGENT_RULES, DEFAULT_TOOL_CATALOG, TOOL_CATALOG_START, TOOL_CATALOG_END } from "./workspace-bootstrap";
import { FILE_AGENT_PROMPT, prepareFileContext } from "./file-context";

it("keeps a short discovery entry, preserves personal rules and stays idempotent", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("~/AGENTS.md", "Personal rules.\n");
  await initializeWorkspace(fs);
  const first = await fs.readFile("~/AGENTS.md");
  expect(first.content).toContain("Personal rules.");
  expect(first.content).toContain("優先使用 bash");
  expect(first.content).toContain('help({command: "bash"})');
  expect(first.content).not.toContain(SHELL_COMMANDS.join(", "));
  for (const tool of DEFAULT_BIN_TOOLS) expect(first.content).not.toContain(tool.description);
  expect(DEFAULT_AGENT_RULES.length).toBeLessThan(700);
  expect(FILE_AGENT_PROMPT.length).toBeLessThan(1500);
  await initializeWorkspace(fs);
  expect(await fs.readFile(first.path)).toMatchObject({ content: first.content, revision: first.revision });
  expect(first.content.split(TOOL_CATALOG_START)).toHaveLength(2);
  expect((await prepareFileContext(fs, "/home/user")).systemPrompt).toContain(first.content);
});

it("replaces an old generated catalog without changing surrounding custom instructions", async () => {
  const fs = new MemoryFileSystem();
  const prefix = "Personal rules before.\n\n";
  const suffix = "\n\nPersonal rules after.\n";
  await fs.writeFile("~/agents.md", `${prefix}${TOOL_CATALOG_START}\nOld verbose tool catalog.\n${TOOL_CATALOG_END}${suffix}`);
  await initializeWorkspace(fs);
  const file = await fs.readFile("~/agents.md");
  expect(file.content).toBe(`${prefix}${DEFAULT_TOOL_CATALOG}${suffix}`);
  expect(file.revision).toBe(2);
  await initializeWorkspace(fs);
  expect((await fs.readFile(file.path)).revision).toBe(file.revision);
});

it("documents exactly the external commands enabled in the pinned browser runtime", () => {
  expect(SHELL_COMMANDS).toEqual(getCommandNames().filter(name => !["gzip", "gunzip", "zcat", "sqlite3", "python", "python3", "node", "js-exec", "curl", "wget"].includes(name)));
});
