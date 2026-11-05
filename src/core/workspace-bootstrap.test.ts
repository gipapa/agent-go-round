import { expect, it } from "vitest";
import { getCommandNames } from "just-bash/browser";
import { MemoryFileSystem } from "./fs";
import { DEFAULT_BIN_TOOLS } from "./bin-defaults";
import { SHELL_COMMANDS } from "./shell-catalog";
import { initializeWorkspace, TOOL_CATALOG_START } from "./workspace-bootstrap";
import { prepareFileContext } from "./file-context";

it("upgrades existing rules with both catalogs, preserves personal rules and stays idempotent", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("~/AGENTS.md", "Personal rules.\n");
  await initializeWorkspace(fs);
  const first = await fs.readFile("~/AGENTS.md");
  expect(first.content).toContain("Personal rules.");
  expect(first.content).toContain("優先使用 bash");
  for (const name of [...SHELL_COMMANDS, ...DEFAULT_BIN_TOOLS.map(tool => tool.name)]) expect(first.content).toContain(name);
  await initializeWorkspace(fs);
  expect(await fs.readFile(first.path)).toMatchObject({ content: first.content, revision: first.revision });
  expect(first.content.split(TOOL_CATALOG_START)).toHaveLength(2);
  expect((await prepareFileContext(fs, "/home/user")).systemPrompt).toContain(first.content);
});

it("documents exactly the external commands enabled in the pinned browser runtime", () => {
  expect(SHELL_COMMANDS).toEqual(getCommandNames().filter(name => !["gzip", "gunzip", "zcat", "sqlite3", "python", "python3", "node", "js-exec", "curl", "wget"].includes(name)));
});
