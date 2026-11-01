// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BinRegistry } from "./bin";
import { DEFAULT_BIN_TOOLS, FILE_METHODS, installDefaultBin } from "./bin-defaults";
import { MemoryFileSystem } from "./fs";
import type { BinExecutor, FileRpc } from "./bin-sandbox";
import { executeShell } from "./shell";
import { AgentSession, MemorySessionEventStore } from "./session";
import { createScriptedSession } from "./scripted";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

// Browser smoke separately exercises the actual opaque iframe + Worker executor.
const testExecutor: BinExecutor = {
  async execute(source, args, rpc: FileRpc) {
    const main = runInNewContext(`(${source})`, {}, { timeout: 1000 });
    return structuredClone(await main(args, { fs: Object.fromEntries(FILE_METHODS.map((method) => [method, (...values: unknown[]) => rpc(method, values)])) }));
  }
};
async function setup() {
  const fs = new MemoryFileSystem();
  await installDefaultBin(fs);
  const bin = new BinRegistry(fs, testExecutor);
  await bin.reload();
  return { fs, bin };
}

describe("VFS ~/bin JavaScript tools", () => {
  it("executes all six defaults against the same files and reads paginated content", async () => {
    const { bin } = await setup();
    expect(bin.list()).toHaveLength(DEFAULT_BIN_TOOLS.length);
    await bin.execute("write", { path: "code.ts", content: 'const greeting = "你好";\nconsole.log(greeting);\n' });
    expect(await bin.execute("read", { path: "code.ts", limit: 1 })).toMatchObject({ content: 'const greeting = "你好";', revision: 1, nextOffset: 2 });
    expect(await bin.execute("edit", { path: "code.ts", oldText: "你好", newText: "世界" })).toMatchObject({ replacements: 1, revision: 2 });
    expect(await bin.execute("grep", { path: "code.ts", pattern: "世界" })).toMatchObject({ matches: [{ line: 1, text: 'const greeting = "世界";' }] });
    expect(await bin.execute("find", { name: "*.ts", type: "file" })).toMatchObject({ entries: [{ path: "/home/user/code.ts" }], truncated: false });
    expect(await bin.execute("ls", {})).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ path: "/home/user/bin", kind: "directory" })]) });
  });

  it("executes the six bin tools through Pi's native loop and preserves call/result ordering", async () => {
    const { fs, bin } = await setup();
    const model = createScriptedSession([]).agent.state.model;
    const steps: Array<[string, Record<string, unknown>]> = [
      ["write", { path: "loop.ts", content: "const value = 1;" }],
      ["read", { path: "loop.ts" }],
      ["edit", { path: "loop.ts", oldText: "= 1", newText: "= 2" }],
      ["grep", { path: "loop.ts", pattern: "= 2" }],
      ["find", { name: "loop.ts" }],
      ["ls", {}]
    ];
    let turn = 0;
    const requests: unknown[] = [];
    const streamFn: StreamFn = (_model, context) => {
      requests.push(structuredClone(context.messages));
      const step = steps[turn];
      const call: ToolCall | undefined = step ? { type: "toolCall", id: `bin-${turn++}`, name: step[0], arguments: step[1] } : undefined;
      const message: AssistantMessage = {
        role: "assistant", api: "openai-completions", provider: "scripted", model: model.id,
        content: call ? [call] : [{ type: "text", text: "files verified" }],
        stopReason: call ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
      stream.end(message);
      return stream;
    };
    const store = new MemorySessionEventStore();
    const session = new AgentSession({ sessionId: "bin-loop", model, streamFn, tools: bin.sessionTools(), eventStore: store });
    expect(await session.prompt("Create, edit, search, and list code")).toMatchObject({ status: "success", text: "files verified" });
    expect((await fs.readFile("~/loop.ts")).content).toBe("const value = 2;");
    expect(requests).toHaveLength(7);
    expect(session.agent.state.messages.filter((message) => message.role === "toolResult")).toHaveLength(6);
    expect(store.list().filter((event) => event.type === "tool_finished").map((event) => event.type === "tool_finished" && event.toolName)).toEqual(steps.map(([name]) => name));
  });

  it("rejects ambiguous edits, stale overwrites, invalid schemas, and malformed regex", async () => {
    const { bin, fs } = await setup();
    await bin.execute("write", { path: "repeat.md", content: "same same" });
    await expect(bin.execute("edit", { path: "repeat.md", oldText: "same", newText: "new" })).rejects.toThrow(/ambiguous/);
    await expect(bin.execute("write", { path: "repeat.md", content: "oops" })).rejects.toThrow(/changed/);
    await expect(bin.execute("read", { path: "repeat.md", offset: -1 })).rejects.toThrow();
    await expect(bin.execute("grep", { pattern: "[", regex: true })).rejects.toThrow();
    expect((await fs.readFile("~/repeat.md")).content).toBe("same same");
    expect(await bin.execute("edit", { path: "repeat.md", oldText: "same", newText: "new", replaceAll: true })).toMatchObject({ replacements: 2 });
  });

  it("loads new JS tools, enforces capabilities, and pins already-registered tool definitions", async () => {
    const { fs, bin } = await setup();
    const manifest = { version: 1, name: "hello", description: "Test extension", parameters: { type: "object", additionalProperties: false }, capabilities: ["readFile"] };
    await fs.writeFile("~/bin/hello.tool.json", JSON.stringify(manifest));
    await fs.writeFile("~/bin/hello.js", 'async function main(args, api) { return "first"; }');
    await bin.reload();
    const registered = bin.sessionTools().find((tool) => tool.name === "hello")!;
    await fs.writeFile("~/bin/hello.js", 'async function main(args, api) { return api.fs.writeFile("~/oops", "bad"); }');
    await bin.reload();
    expect(await registered.execute("test", {})).toMatchObject({ details: "first" });
    await expect(bin.execute("hello", {})).rejects.toThrow(/capability/);
    await expect(fs.readFile("~/oops")).rejects.toThrow(/Not found/);
    await installDefaultBin(fs);
    expect((await fs.readFile("~/bin/hello.js")).content).toContain("oops");
  });

  it("reads five joke files without the v2 three-resource limit and reports search truncation", async () => {
    const { fs, bin } = await setup();
    await fs.mkdir("~/jokes");
    for (let i = 1; i <= 5; i++) await bin.execute("write", { path: `jokes/笑話${i}.md`, content: `笑話 ${i}` });
    const found = await bin.execute("find", { path: "jokes", name: "*.md" }) as { entries: { path: string }[] };
    expect(found.entries).toHaveLength(5);
    for (const file of found.entries) expect(await bin.execute("read", { path: file.path })).toMatchObject({ content: expect.stringContaining("笑話") });
    const batch = await bin.execute("read", { path: found.entries.map((file) => file.path) }) as { files: { path: string; content: string }[] };
    expect(batch.files).toHaveLength(5);
    expect(batch.files.every((file) => file.content.startsWith("笑話"))).toBe(true);
    expect(await bin.execute("grep", { path: "jokes", pattern: "笑話", limit: 2 })).toMatchObject({ matches: expect.any(Array), truncated: true });
  });

  it("creates a batch of files atomically, with real per-file write traces", async () => {
    const { bin, fs } = await setup();
    const accesses: string[] = [];
    const write = bin.sessionTools("/home/user", (access) => accesses.push(access.path)).find((tool) => tool.name === "write")!;
    await write.execute("batch", { files: Array.from({ length: 5 }, (_, index) => ({ path: `new-jokes/${index}.md`, content: `笑話 ${index}` })), createParents: true });
    expect(await fs.listDirectory("~/new-jokes")).toHaveLength(5);
    expect(accesses).toHaveLength(5);
    await expect(bin.execute("write", { files: [{ path: "new-jokes/extra.md", content: "extra" }, { path: "new-jokes/0.md", content: "collision" }] })).rejects.toThrow(/changed/);
    await expect(fs.readFile("~/new-jokes/extra.md")).rejects.toMatchObject({ code: "not_found" });
  });

  it("classifies interruption after a mutation as unknown and blocks future RPCs", async () => {
    const { fs } = await setup();
    let captured: FileRpc;
    const executor: BinExecutor = { async execute(_source, _args, rpc) { captured = rpc; await rpc("writeFile", ["~/changed", "yes"]); throw new Error("deadline"); } };
    const bin = new BinRegistry(fs, executor);
    await bin.reload();
    await expect(bin.execute("write", { path: "changed", content: "yes" })).rejects.toMatchObject({ code: "outcome_unknown" });
    await expect(captured!("writeFile", ["~/late", "no"])).rejects.toThrow(/cancelled/);
    await expect(fs.readFile("~/late")).rejects.toThrow();
  });

  it("shares commands with Pi and preserves quoted paths through shell parsing", async () => {
    const { fs, bin } = await setup();
    await executeShell('write "space name.md" "hello\\nworld"', fs, bin, "/home/user");
    expect(await executeShell('cat "space name.md"', fs, bin, "/home/user")).toMatchObject({ text: expect.stringContaining("hello\\nworld") });
    await executeShell("mkdir jokes", fs, bin, "/home/user");
    expect(await executeShell("cd jokes", fs, bin, "/home/user")).toMatchObject({ cwd: "/home/user/jokes" });
    expect(await executeShell("ai", fs, bin, "/home/user")).toMatchObject({ mode: "agent" });
    await expect(executeShell("missing", fs, bin, "/home/user")).rejects.toThrow(/not found/);
    expect(DEFAULT_BIN_TOOLS.map((tool) => tool.name).sort()).toEqual(["edit", "find", "grep", "ls", "read", "skill_load", "write"]);
  });

  it("recovers broken bin manifests without depending on executable bin tools", async () => {
    const { fs, bin } = await setup();
    await fs.writeFile("~/bin/read.tool.json", "broken");
    const restarted = new BinRegistry(fs, testExecutor);
    await expect(restarted.reload()).rejects.toThrow();
    await executeShell("restore-bin read", fs, restarted, "/home/user");
    expect(restarted.list()).toHaveLength(DEFAULT_BIN_TOOLS.length);
    await fs.writeFile("~/bin/bad.tool.json", "broken");
    await expect(bin.reload()).rejects.toThrow();
    await executeShell("rm ~/bin/bad.tool.json", fs, restarted, "/home/user");
    expect(await executeShell("rehash", fs, restarted, "/home/user")).toMatchObject({ text: expect.stringContaining("read") });
  });
});
