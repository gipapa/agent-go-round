// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BinRegistry, type BinFileAccess } from "./bin";
import { DEFAULT_BIN_TOOLS, FILE_METHODS, installDefaultBin } from "./bin-defaults";
import { MemoryFileSystem } from "./fs";
import type { BinExecutor, FileRpc } from "./bin-sandbox";
import { AgentSession, MemorySessionEventStore } from "./session";
import { createScriptedSession } from "./scripted";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

// Browser smoke separately exercises the actual opaque iframe + Worker executor.
const testExecutor: BinExecutor = {
  async execute(source, args, rpc: FileRpc) {
    const main = runInNewContext(`(${source})`, {}, { timeout: 1000 });
    return structuredClone(await main(args, { fs: Object.fromEntries(FILE_METHODS.map((method) => [method, (...values: unknown[]) => rpc(method, values)])), host: { readPage: (options: unknown) => rpc("readHostPage", [options]) }, tools: { help: (command?: string) => rpc("commandHelp", [command]) }, agents: { execute: (options: unknown) => rpc("tabAgents", [options]) } }));
  }
};
async function setup(services: ConstructorParameters<typeof BinRegistry>[2] = {}) {
  const fs = new MemoryFileSystem();
  await installDefaultBin(fs);
  const bin = new BinRegistry(fs, testExecutor, services);
  await bin.reload();
  return { fs, bin };
}

describe("VFS ~/bin JavaScript tools", () => {
  it("routes structured calls through editable agents bin JS with trusted caller context", async () => {
    const calls: unknown[] = [];
    const { fs, bin } = await setup({ tabAgents: async (args, _signal, context) => { calls.push({ args, context }); return { status: "pending", requestId: "request-a" }; } });
    expect(await bin.execute("agents", { action: "list" }, "/home/user", undefined, { tabId: "main" })).toMatchObject({ requestId: "request-a" });
    await bin.execute("agents", { action: "send", target: "other", text: "請講一個笑話" }, "/home/user", undefined, { tabId: "main" });
    await bin.sessionTools("/home/user", undefined, undefined, "session-b").find(tool => tool.name === "agents")!.execute("call-b", { action: "read", requestId: "request-a", waitMs: 0 });
    expect(calls).toEqual([
      { args: { action: "list" }, context: { tabId: "main" } },
      { args: { action: "send", target: "other", text: "請講一個笑話" }, context: { tabId: "main" } },
      { args: { action: "read", requestId: "request-a", waitMs: 0 }, context: { sessionId: "session-b", toolCallId: "call-b" } }
    ]);
    await fs.writeFile("~/bin/agents.js", 'async function main(args, api) { return { custom: true }; }'); await bin.reload();
    expect(await bin.execute("agents", { action: "list" })).toEqual({ custom: true });
    expect(await bin.sessionTools().find(tool => tool.name === "agents")!.execute("edited", { action: "list" })).toMatchObject({ details: { custom: true } });
  });

  it("validates cross-tab RPCs after JS edits and requires the declared capability", async () => {
    let dispatched = 0;
    const { fs, bin } = await setup({ tabAgents: async () => { dispatched++; return {}; } });
    await fs.writeFile("~/bin/agents.js", 'async function main(args, api) { return api.agents.execute({action:"send",target:"other",text:"hi",sourceTabId:"spoofed"}); }'); await bin.reload();
    await expect(bin.execute("agents", { action: "list" })).rejects.toThrow();
    expect(dispatched).toBe(0);
    await fs.writeFile("~/bin/agents.js", 'async function main(args, api) { return api.agents.execute({action:"list"}); }');
    const manifest = JSON.parse((await fs.readFile("~/bin/manifests/agents.tool.json")).content);
    await fs.writeFile("~/bin/manifests/agents.tool.json", JSON.stringify({ ...manifest, capabilities: [] })); await bin.reload();
    await expect(bin.execute("agents", { action: "list" })).rejects.toThrow("capability");
    expect(dispatched).toBe(0);
  });

  it("marks a lost dispatch result unknown and includes the existing requestId for recovery", async () => {
    const { fs } = await setup();
    const bin = new BinRegistry(fs, { async execute(_source, _args, rpc) { await rpc("tabAgents", [{ action: "send", target: "other", text: "hi" }]); throw new Error("worker stopped"); } }, { tabAgents: async () => ({ status: "pending", requestId: "recover-me" }) });
    await bin.reload();
    await expect(bin.execute("agents", { action: "send", target: "other", text: "hi" })).rejects.toMatchObject({ code: "outcome_unknown", message: expect.stringContaining("recover-me") });
  });

  it("preserves custom tool JS and manifests across installation and reloads", async () => {
    const { fs, bin } = await setup();
    const definition = { ...DEFAULT_BIN_TOOLS.find(tool => tool.name === "read")!, description: "My custom read description" };
    const { source: _source, ...manifest } = definition;
    const customJson = JSON.stringify(manifest, null, 4);
    const customJs = 'async function main(args, api) { return { custom: true }; }';
    await fs.writeFile("~/bin/manifests/read.tool.json", customJson);
    await fs.writeFile("~/bin/read.js", customJs);
    await installDefaultBin(fs);
    await bin.reload();
    expect((await fs.readFile("~/bin/manifests/read.tool.json")).content).toBe(customJson);
    expect((await fs.readFile("~/bin/read.js")).content).toBe(customJs);
    expect((await fs.listDirectory("~/bin")).some(file => file.path.endsWith(".tool.json"))).toBe(false);
    expect(await bin.execute("read", { path: "any" })).toEqual({ custom: true });
    const revision = (await fs.readFile("~/bin/manifests/read.tool.json")).revision;
    await installDefaultBin(fs); await bin.reload();
    expect((await fs.readFile("~/bin/manifests/read.tool.json")).revision).toBe(revision);
  });

  it("runs host reads from editable bin JS with source identity, with explicit no-host errors", async () => {
    const plain = await setup();
    await expect(plain.bin.execute("read_host_page", {})).rejects.toThrow("目前沒有連接宿主頁");
    await expect(plain.bin.sessionTools().find(tool => tool.name === "read_host_page")!.execute("no-host", {})).rejects.toThrow("目前沒有連接宿主頁");
    const calls: unknown[] = [];
    const { fs, bin } = await setup({ readHostPage: async (args, _signal, context) => { calls.push({ args, context }); return { html: "這一頁的作者是gipapa" }; } });
    expect(await bin.execute("read_host_page", {})).toMatchObject({ html: expect.stringContaining("gipapa") });
    const tool = bin.sessionTools("/home/user", undefined, undefined, "session-a").find(tool => tool.name === "read_host_page")!;
    expect(await tool.execute("call-a", { limit: 20 })).toMatchObject({ details: { html: expect.stringContaining("gipapa") } });
    expect(calls.at(-1)).toEqual({ args: { limit: 20 }, context: { sessionId: "session-a", toolCallId: "call-a" } });
    await fs.writeFile("~/bin/read_host_page.js", 'async function main(args, api) { return { edited: true }; }');
    await bin.reload();
    expect(await bin.execute("read_host_page", {})).toEqual({ edited: true });
    expect(await bin.sessionTools().find(tool => tool.name === "read_host_page")!.execute("edited", {})).toMatchObject({ details: { edited: true } });
  });

  it("enforces host capability and range checks even when bin JS is edited", async () => {
    const { fs, bin } = await setup({ readHostPage: async () => { throw new Error("must not dispatch"); } });
    await fs.writeFile("~/bin/read_host_page.js", 'async function main(args, api) { return api.host.readPage({limit: -1}); }');
    await bin.reload();
    await expect(bin.execute("read_host_page", {})).rejects.toThrow("Invalid host page range");
    const manifest = JSON.parse((await fs.readFile("~/bin/manifests/read_host_page.tool.json")).content);
    await fs.writeFile("~/bin/manifests/read_host_page.tool.json", JSON.stringify({ ...manifest, capabilities: [] }));
    await bin.reload();
    await expect(bin.execute("read_host_page", {})).rejects.toThrow("capability");
  });
  it("executes all six defaults against the same files and reads paginated content", async () => {
    const { bin } = await setup();
    expect(bin.list()).toHaveLength(DEFAULT_BIN_TOOLS.length);
    await bin.execute("WrItE", { path: "code.ts", content: 'const greeting = "你好";\nconsole.log(greeting);\n' });
    expect(await bin.execute("READ", { path: "code.ts", limit: 1 })).toMatchObject({ content: 'const greeting = "你好";', revision: 1, nextOffset: 2 });
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
      const call: ToolCall | undefined = step ? { type: "toolCall", id: `bin-${turn++}`, name: turn % 2 ? step[0].toUpperCase() : step[0][0].toUpperCase() + step[0].slice(1), arguments: step[1] } : undefined;
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
    await fs.writeFile("~/bin/manifests/hello.tool.json", JSON.stringify(manifest));
    await fs.writeFile("~/bin/hello.js", 'async function main(args, api) { return "first"; }');
    await bin.reload();
    const registered = bin.sessionTools().find((tool) => tool.name === "hello")!;
    expect(await bin.execute("hello", {})).toBe("first");
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

  it("records delivered read ranges only when output matches the actual VFS content", async () => {
    const { fs, bin } = await setup();
    await fs.writeFile("~/pages.md", "第一行\n第二行\n第三行");
    const accesses: BinFileAccess[] = [];
    const read = () => bin.sessionTools("/home/user", access => accesses.push(access)).find(tool => tool.name === "read")!;
    await read().execute("page", { path: "pages.md", offset: 2, limit: 1 });
    expect(accesses.filter(access => access.readRange).map(access => access.readRange)).toEqual([{ startLine: 2, endLine: 2, totalLines: 3 }]);
    for (const output of ["return { path: file.path, revision: file.revision };", "return { path: file.path, revision: file.revision, content: '虛構內容', totalLines: 3 };", "throw new Error('failed after read');"]) {
      accesses.length = 0;
      await fs.writeFile("~/bin/read.js", `async function main(args, api) { const file = await api.fs.readFile(args.path); ${output} }`);
      await bin.reload();
      try { await read().execute("withheld", { path: "pages.md" }); } catch (error) { expect(String(error)).toContain("failed after read"); }
      expect(accesses).toHaveLength(1);
      expect(accesses[0]).not.toHaveProperty("readRange");
    }
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

  it("recovers broken bin manifests without depending on executable bin tools", async () => {
    const { fs, bin } = await setup();
    await fs.writeFile("~/bin/manifests/read.tool.json", "broken");
    const restarted = new BinRegistry(fs, testExecutor);
    await expect(restarted.reload()).rejects.toThrow();
    const { source: _source, ...manifest } = DEFAULT_BIN_TOOLS.find(tool => tool.name === "read")!;
    await fs.writeFile("~/bin/manifests/read.tool.json", JSON.stringify(manifest));
    await restarted.reload();
    expect(restarted.list()).toHaveLength(DEFAULT_BIN_TOOLS.length);
    await fs.writeFile("~/bin/manifests/bad.tool.json", "broken");
    await expect(bin.reload()).rejects.toThrow();
    await fs.remove("~/bin/manifests/bad.tool.json");
    await restarted.reload();
    expect(restarted.list().some(tool => tool.name === "read")).toBe(true);
  });
});
