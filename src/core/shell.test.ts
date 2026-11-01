// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BinRegistry } from "./bin";
import { FILE_METHODS, installDefaultBin } from "./bin-defaults";
import { MemoryFileSystem, VFS_HOME } from "./fs";
import { executeShell, shellWords } from "./shell";
import { configureFileAgent } from "./file-context";
import { createScriptedSession } from "./scripted";

async function setup() {
  const fs = new MemoryFileSystem();
  await installDefaultBin(fs);
  const bin = new BinRegistry(fs, { async execute(source, args, rpc) {
    return structuredClone(await runInNewContext(`(${source})`, {}, { timeout: 1000 })(args, { fs: Object.fromEntries(FILE_METHODS.map(method => [method, (...values: unknown[]) => rpc(method, values)])), tools: { help: (command?: string) => rpc("commandHelp", [command]) } }));
  } });
  await bin.reload();
  const shell = async (input: string, cwd = VFS_HOME) => (await executeShell(input, fs, bin, cwd)).text;
  return { fs, bin, shell };
}

describe("bash-style virtual shell", () => {
  it("lists the actual cwd, hides dotfiles by default, and supports file operands and common flags", async () => {
    const { fs, shell } = await setup();
    await fs.mkdir("~/docs"); await fs.mkdir("~/docs/sub");
    await fs.writeFile("~/docs/Notes.md", "中文"); await fs.writeFile("~/docs/.hidden", "secret");
    expect(await shell("ls", "/home/user/docs")).toBe("Notes.md\nsub");
    expect(await shell("ls -AF docs")).toBe(".hidden\nNotes.md\nsub/");
    expect(await shell("ls -a docs")).toBe(".\n..\n.hidden\nNotes.md\nsub");
    expect(await shell("ls docs/Notes.md")).toBe("docs/Notes.md");
    expect(await shell("ls -l docs/Notes.md")).toMatch(/^- 6 r1 .* docs\/Notes.md$/);
    expect(JSON.parse(await shell('ls {"path":"docs"}')).entries).toHaveLength(3);
    await expect(shell("ls -z docs")).rejects.toThrow("ls --help");
  });

  it("cat reads beyond the first 200 lines, concatenates files and preserves exact contents", async () => {
    const { fs, shell } = await setup();
    const content = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    await fs.writeFile("~/long.txt", content); await fs.writeFile("~/tail.txt", "tail");
    expect(await shell("cat long.txt tail.txt")).toBe(content + "tail");
    expect(await shell("cat -n tail.txt")).toBe("1\ttail");
    expect(JSON.parse(await shell("read long.txt")).nextOffset).toBe(201);
  });

  it("mkdir -p, multiple touch operands, directory destinations and recursive removal work explicitly", async () => {
    const { fs, shell } = await setup();
    await expect(shell("mkdir parent/child")).rejects.toThrow();
    await shell("mkdir -p parent/child"); await shell("mkdir -p parent/child");
    await expect(shell("mkdir parent")).rejects.toThrow("already exists");
    await shell("touch parent/child/a parent/child/b");
    await shell("mv parent/child/a parent");
    expect((await fs.stat("~/parent/a")).kind).toBe("file");
    await expect(shell("rm parent")).rejects.toThrow("use -r");
    await expect(shell("rmdir parent")).rejects.toThrow("not empty");
    await shell("rm -r parent"); await expect(fs.stat("~/parent")).rejects.toMatchObject({ code: "not_found" });
    await shell("rm -f missing"); await expect(shell("rm -rf ~")).rejects.toThrow("home");
    await shell("touch -- -name"); expect(await shell("ls -- -name")).toBe("-name");
  });

  it("grep and find accept common syntax and output readable paths and lines", async () => {
    const { fs, shell } = await setup();
    await fs.mkdir("~/docs"); await fs.writeFile("~/docs/A.md", "Alpha\nbeta\nALPHA");
    expect(await shell('find docs -name "*.md" -type f')).toBe("docs/A.md");
    expect(await shell('grep -rin "alpha" docs')).toBe("docs/A.md:1:Alpha\ndocs/A.md:3:ALPHA");
    expect(await shell('grep -n "^b" docs/A.md')).toBe("2:beta");
    expect(await shell('grep -F "^b" docs/A.md')).toBe("");
    await expect(shell("grep alpha docs")).rejects.toThrow("use -r");
    await expect(shell("find docs -exec rm")).rejects.toThrow("find --help");
  });

  it("documents every command without running it, including UI commands and custom tool schemas", async () => {
    const { fs, bin, shell } = await setup();
    await fs.writeFile("~/bin/custom_help.js", 'async function main(args, api) { return api.fs.writeFile("~/should-not-exist", "bad"); }');
    await fs.writeFile("~/bin/manifests/custom_help.tool.json", JSON.stringify({ version: 1, name: "custom_help", description: "Custom tool help fixture", parameters: { type: "object", properties: { message: { type: "string" } } }, capabilities: ["writeFile"] }));
    await bin.reload();
    expect(await shell("custom_help --help")).toContain('"message"');
    await expect(fs.stat("~/should-not-exist")).rejects.toMatchObject({ code: "not_found" });
    const commands = ["help", "ls", "cat", "read", "write", "edit", "grep", "find", "pwd", "cd", "mkdir", "touch", "rm", "rmdir", "mv", "ai", "preview", "history", "clear", "rehash", "restore-bin", "demo", "skill_load"];
    const before = await fs.listDirectory("~");
    for (const command of commands) {
      expect(await shell(`${command} --help`)).toBe(await shell(`help ${command}`));
      expect(await shell(`${command} --help`)).toContain("\n");
    }
    expect(await fs.listDirectory("~")).toEqual(before);
    const session = createScriptedSession([]);
    await configureFileAgent(session, fs, VFS_HOME, bin);
    const tool = session.agent.state.tools.find(tool => tool.name === "help")!;
    expect(await tool.execute("help-id", { command: "ls" })).toMatchObject({ content: [{ type: "text", text: expect.stringContaining("ls [-aA1lF]") }] });
  });

  it.each(["pwd extra", "cd one two", "mv one two three", "touch", "rm", "mkdir -q one", "ls | cat", "cat $(pwd)"])("rejects unsupported input without silently ignoring it: %s", async input => {
    const { fs, shell } = await setup();
    const before = await fs.listDirectory("~");
    await expect(shell(input)).rejects.toThrow();
    expect(await fs.listDirectory("~")).toEqual(before);
  });

  it("preserves bash quoting and treats JSON content as data", async () => {
    const { fs, shell } = await setup();
    expect(shellWords(String.raw`cat a\ b "c\nd" 'e\nf'`)).toEqual(["cat", "a b", String.raw`c\nd`, String.raw`e\nf`]);
    await shell('write ' + JSON.stringify({ path: "literal.txt", content: "$(pwd); | >\nhello" }));
    expect((await fs.readFile("~/literal.txt")).content).toBe("$(pwd); | >\nhello");
  });
});
