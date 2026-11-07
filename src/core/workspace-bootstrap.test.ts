import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { getCommandNames } from "just-bash/browser";
import { IndexedDbFileSystem, MemoryFileSystem, type VirtualFileSystem } from "./fs";
import { INITIAL_WORKSPACE_FILES, INITIAL_WORKSPACE_DIRECTORIES } from "./workspace-template";
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

async function snapshot(fs: VirtualFileSystem, path = "/"): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const node of await fs.listDirectory(path)) {
    result.push({ path: node.path, kind: node.kind, mode: node.mode, ...(node.kind === "file" ? { content: (await fs.readFile(node.path)).content } : {}) });
    if (node.kind === "directory") result.push(...await snapshot(fs, node.path));
  }
  return result;
}

describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s workspace reset", (_name, create) => {
  it("restores exactly the checked-in initial files, removes all custom entries and stays reusable", async () => {
    const fresh = create(), fs = create();
    await initializeWorkspace(fresh);
    const initial = await snapshot(fresh);
    for (const file of INITIAL_WORKSPACE_FILES) expect((await fresh.readFile(file.path)).content).toBe(file.content);
    for (const path of INITIAL_WORKSPACE_DIRECTORIES) expect((await fresh.stat(path)).kind).toBe("directory");
    await initializeWorkspace(fs);
    const oldRules = await fs.readFile("~/agents.md");
    await fs.writeFile("~/agents.md", "custom rules");
    await fs.rename("~/bin", "~/old-bin");
    await fs.symlink("~/old-bin", "~/bin");
    await fs.mkdir("~/skills/custom/empty", { recursive: true });
    await fs.writeBytes("~/skills/custom/binary", new Uint8Array([255, 0, 128]));
    await fs.mkdir("/tmp/nested", { recursive: true });
    await fs.writeFile("/tmp/nested/custom", "outside home");
    await fs.symlink("/", "~/loop");
    await fs.chmod("~", 0o700);
    await initializeWorkspace(fs, { reset: true });
    expect(await snapshot(fs)).toEqual(initial);
    await expect(fs.writeFile(oldRules.path, "stale overwrite", { expectedRevision: oldRules.revision })).rejects.toMatchObject({ code: "conflict" });
    await initializeWorkspace(fs);
    expect(await snapshot(fs)).toEqual(initial);
    await initializeWorkspace(fs, { reset: true });
    expect(await snapshot(fs)).toEqual(initial);
    await fs.writeFile("~/after-reset", "can still write");
  });

  it("rolls back the entire replacement if the new workspace exceeds quota", async () => {
    const fs = create();
    await initializeWorkspace(fs);
    await fs.writeFile("~/personal", "keep after failure");
    const before = await snapshot(fs);
    await expect(fs.replaceWorkspace(Array.from({ length: 33 }, (_, index) => ({ path: `/large-${index}`, content: "x".repeat(512 * 1024) })), [])).rejects.toMatchObject({ code: "quota" });
    expect(await snapshot(fs)).toEqual(before);
  });
});

it("resets only the selected IndexedDB workspace and persists the result across instances", async () => {
  const factory = new IDBFactory();
  const fs = new IndexedDbFileSystem(factory, "reset"), other = new IndexedDbFileSystem(factory, "keep");
  await initializeWorkspace(fs); await initializeWorkspace(other);
  await fs.writeFile("~/custom", "remove");
  await other.writeFile("~/custom", "preserve");
  await initializeWorkspace(fs, { reset: true });
  expect((await other.readFile("~/custom")).content).toBe("preserve");
  expect(await snapshot(new IndexedDbFileSystem(factory, "reset"))).toEqual(await snapshot(fs));
  await expect(fs.stat("~/custom")).rejects.toMatchObject({ code: "not_found" });
});
