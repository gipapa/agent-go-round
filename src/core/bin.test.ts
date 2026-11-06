// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BinRegistry, type BinFileAccess } from "./bin";
import { DEFAULT_BIN_TOOLS, FILE_METHODS, installDefaultBin } from "./bin-defaults";
import { LEGACY_FILE_TOOL_MANIFESTS } from "./bin-defaults-legacy";
import { RETIRED_DEFAULT_BIN_TOOLS } from "./bin-retired";
import { MemoryFileSystem } from "./fs";
import type { BinExecutor, FileRpc } from "./bin-sandbox";
import { AgentSession, MemorySessionEventStore } from "./session";
import { createScriptedSession } from "./scripted";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { SHELL_COMMANDS, SHELL_BUILTINS } from "./shell-catalog";

// Browser smoke separately exercises the actual opaque iframe + Worker executor.
const testExecutor: BinExecutor = {
  async execute(source, args, rpc: FileRpc) {
    const main = runInNewContext(`(${source})`, {}, { timeout: 1000 });
    return structuredClone(await main(args, { fs: Object.fromEntries(FILE_METHODS.map((method) => [method, (...values: unknown[]) => rpc(method, values)])), host: { readPage: (options: unknown) => rpc("readHostPage", [options]) }, tools: { help: (command?: string) => rpc("commandHelp", [command]), reload: () => rpc("reloadTools", []) }, workspace: { home: () => rpc("home", []) }, agents: { execute: (options: unknown) => rpc("tabAgents", [options]) } }));
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
  it("loads full tool and shell reference through help on demand", async () => {
    const { bin } = await setup();
    const catalog = await bin.execute("help", {}) as { text: string };
    expect(catalog.text).toContain('help({command: "bash"})');
    expect(catalog.text).toContain("~/bin/manifests/<name>.tool.json");
    for (const tool of bin.list()) expect(catalog.text).toContain(tool.name);
    const shell = await bin.execute("HeLp", { command: "BaSh" }) as { text: string };
    expect(shell.text).toContain(`Commands: ${SHELL_COMMANDS.join(", ")}`);
    expect(shell.text).toContain(`Builtins: ${SHELL_BUILTINS.join(", ")}`);
    expect(shell.text).toContain("No host disk, network, Node/Python");
    expect(shell.text).toContain("job-control");
    expect(shell.text).toContain("maxSteps");
    const read = await bin.execute("help", { command: "read" }) as { text: string };
    expect(read.text).toContain("nextOffset");
    expect(read.text).toContain('"path"');
    expect(read.text).not.toContain("Commands:");
  });

  it("retires redundant defaults in existing workspaces while preserving customized tool pairs", async () => {
    for (const customization of ["none", "js", "manifest"] as const) {
      const { fs, bin } = await setup();
      for (const { source, ...manifest } of RETIRED_DEFAULT_BIN_TOOLS) {
        await fs.writeFile(`~/bin/${manifest.name}.js`, source + (customization === "js" ? "\n// My tool" : ""));
        await fs.writeFile(`~/bin/manifests/${manifest.name}.tool.json`, JSON.stringify(customization === "manifest" ? { ...manifest, description: "My tool" } : manifest, null, 2));
      }
      await installDefaultBin(fs); await bin.reload();
      for (const tool of RETIRED_DEFAULT_BIN_TOOLS) {
        if (customization === "none") {
          await expect(fs.stat(`~/bin/${tool.name}.js`)).rejects.toMatchObject({ code: "not_found" });
          await expect(fs.stat(`~/bin/manifests/${tool.name}.tool.json`)).rejects.toMatchObject({ code: "not_found" });
          expect(bin.list().map(tool => tool.name)).not.toContain(tool.name);
        } else {
          expect((await fs.readFile(`~/bin/${tool.name}.js`)).content).toContain(customization === "js" ? "// My tool" : tool.source);
          expect(bin.list().some(current => current.name === tool.name)).toBe(tool.name !== "open_preview");
        }
      }
      await installDefaultBin(fs);
    }
  });

  it("does not remove a retired tool pair when another tab customizes it during cleanup", async () => {
    const { fs } = await setup();
    const { source, ...manifest } = RETIRED_DEFAULT_BIN_TOOLS[0];
    const path = `~/bin/manifests/${manifest.name}.tool.json`;
    await fs.writeFile(`~/bin/${manifest.name}.js`, source);
    await fs.writeFile(path, JSON.stringify(manifest, null, 2));
    const removeFiles = fs.removeFiles.bind(fs);
    fs.removeFiles = async files => {
      await fs.writeFile(path, "customized concurrently");
      return removeFiles(files);
    };
    await installDefaultBin(fs);
    expect((await fs.readFile(path)).content).toBe("customized concurrently");
    expect((await fs.readFile(`~/bin/${manifest.name}.js`)).content).toBe(source);
  });

  it("installs demo files through bin JS without overwriting shared user data", async () => {
    const { fs, bin } = await setup();
    await fs.writeFile("~/agents.md", "personal rules");
    const installed = await bin.execute("INSTALL_JOKE_DEMO", {}) as { created: string[]; kept: string[] };
    expect(installed.created).toHaveLength(7);
    expect(installed.kept).toEqual(["/home/user/agents.md"]);
    await fs.writeFile("~/jokes/笑話1.md", "personal joke");
    expect(await bin.execute("install_joke_demo", {})).toMatchObject({ created: [], kept: expect.any(Array) });
    expect((await fs.readFile("~/jokes/笑話1.md")).content).toBe("personal joke");
    expect((await fs.readFile("~/agents.md")).content).toBe("personal rules");
  });

  it("keeps preview unavailable to AI, including customized legacy manifests", async () => {
    const { fs, bin } = await setup();
    const { source, ...manifest } = RETIRED_DEFAULT_BIN_TOOLS.find(tool => tool.name === "open_preview")!;
    await fs.writeFile("~/bin/open_preview.js", source + "\n// customized");
    await fs.writeFile("~/bin/manifests/open_preview.tool.json", JSON.stringify(manifest));
    await fs.writeFile("~/bin/renamed_preview.js", source);
    await fs.writeFile("~/bin/manifests/renamed_preview.tool.json", JSON.stringify({ ...manifest, name: "renamed_preview" }));
    await bin.reload();
    expect(bin.list().some(tool => /preview/.test(tool.name))).toBe(false);
    await expect(bin.execute("open_preview", {})).rejects.toThrow("Command not found");
    expect((await fs.readFile("~/bin/open_preview.js")).content).toContain("customized");
  });

  it("reloads edited tools through bin while preserving current definitions and recovering from invalid manifests", async () => {
    const { fs, bin } = await setup();
    const original = bin.sessionTools().find(tool => tool.name === "read")!;
    await fs.writeFile("~/value.txt", "original file");
    await fs.writeFile("~/bin/read.js", 'async function main() { return { edited: true }; }');
    await bin.execute("reload_tools", {});
    expect(await bin.execute("read", { path: "value.txt" })).toEqual({ edited: true });
    expect(await original.execute("original-read", { path: "value.txt" })).toMatchObject({ details: { content: "original file" } });
    await fs.writeFile("~/bin/manifests/broken.tool.json", "invalid json");
    await expect(bin.execute("reload_tools", {})).rejects.toThrow();
    expect(await bin.execute("read", { path: "value.txt" })).toEqual({ edited: true });
    await fs.remove("~/bin/manifests/broken.tool.json");
    await expect(bin.execute("reload_tools", {})).resolves.toMatchObject({ tools: expect.arrayContaining(["reload_tools"]) });
    await fs.writeFile("~/bin/help.js", 'async function main(args, api) { return api.fs.writeFile("~/forbidden", "text"); }');
    await bin.reload();
    await expect(bin.execute("help", {})).rejects.toThrow("capability");

  });

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

  it("upgrades known default guidance in existing workspaces, preserving either kind of customization", async () => {
    for (const customization of ["none", "js", "manifest"] as const) {
      const { fs, bin } = await setup();
      for (const legacy of LEGACY_FILE_TOOL_MANIFESTS) {
        await fs.writeFile(`~/bin/manifests/${legacy.name}.tool.json`, JSON.stringify(legacy, null, 2));
      }
      const js = await fs.readFile("~/bin/write.js");
      const manifest = await fs.readFile("~/bin/manifests/write.tool.json");
      const customJs = `${js.content}\n// Personal customization`;
      const customManifest = manifest.content.replace('"Write UTF-8 files.', '"My custom writer.');
      if (customization === "js") await fs.writeFile(js.path, customJs);
      if (customization === "manifest") await fs.writeFile(manifest.path, customManifest);
      await installDefaultBin(fs); await bin.reload();
      expect(bin.list().find(tool => tool.name === "read")!.description).toContain("write.expectedRevision");
      expect((await fs.readFile(js.path)).content).toBe(customization === "js" ? customJs : js.content);
      expect((await fs.readFile(manifest.path)).content).toBe(customization === "none"
        ? JSON.stringify((({ source: _source, ...tool }) => tool)(DEFAULT_BIN_TOOLS.find(tool => tool.name === "write")!), null, 2)
        : customization === "manifest" ? customManifest : manifest.content);
      const installed = await fs.readFile(manifest.path);
      await installDefaultBin(fs);
      expect(await fs.readFile(manifest.path)).toMatchObject({ content: installed.content, revision: installed.revision });
    }
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
  it("executes the three structured file tools and reads paginated content", async () => {
    const { bin } = await setup();
    expect(bin.list()).toHaveLength(DEFAULT_BIN_TOOLS.length);
    await bin.execute("WrItE", { path: "code.ts", content: 'const greeting = "你好";\nconsole.log(greeting);\n' });
    expect(await bin.execute("READ", { path: "code.ts", limit: 1 })).toMatchObject({ content: 'const greeting = "你好";', revision: 1, nextOffset: 2 });
    expect(await bin.execute("edit", { path: "code.ts", oldText: "你好", newText: "世界" })).toMatchObject({ replacements: 1, revision: 2 });
  });

  it("executes the three file tools through Pi's native loop and preserves call/result ordering", async () => {
    const { fs, bin } = await setup();
    const model = createScriptedSession([]).agent.state.model;
    const steps: Array<[string, Record<string, unknown>]> = [
      ["write", { path: "loop.ts", content: "const value = 1;" }],
      ["read", { path: "loop.ts" }],
      ["edit", { path: "loop.ts", oldText: "= 1", newText: "= 2" }],
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
    expect(requests).toHaveLength(4);
    expect(session.agent.state.messages.filter((message) => message.role === "toolResult")).toHaveLength(3);
    expect(store.list().filter((event) => event.type === "tool_finished").map((event) => event.type === "tool_finished" && event.toolName)).toEqual(steps.map(([name]) => name));
  });

  it("rejects ambiguous edits, stale overwrites, and invalid schemas", async () => {
    const { bin, fs } = await setup();
    await bin.execute("write", { path: "repeat.md", content: "same same" });
    await expect(bin.execute("edit", { path: "repeat.md", oldText: "same", newText: "new" })).rejects.toThrow(/ambiguous/);
    await expect(bin.execute("write", { path: "repeat.md", content: "oops" })).rejects.toThrow(/changed/);
    await expect(bin.execute("read", { path: "repeat.md", offset: -1 })).rejects.toThrow();
    expect((await fs.readFile("~/repeat.md")).content).toBe("same same");
    expect(await bin.execute("edit", { path: "repeat.md", oldText: "same", newText: "new", replaceAll: true })).toMatchObject({ replacements: 2 });
  });

  it("explains create-only conflicts and recovers with read revisions without losing batch atomicity", async () => {
    const { fs, bin } = await setup();
    await bin.execute("write", { path: "main.html", content: "Original" });
    const writes = [
      { path: "main.html", content: "Replacement" },
      { path: "main.html", content: "Replacement", expectedRevision: 0 },
      { files: [{ path: "new.html", content: "New" }, { path: "main.html", content: "Replacement" }] }
    ];
    for (const args of writes) {
      await expect(bin.execute("write", args)).rejects.toThrow(/Call read.*returned revision as expectedRevision/);
      expect((await fs.readFile("~/main.html")).content).toBe("Original");
      await expect(fs.readFile("~/new.html")).rejects.toThrow(/Not found/);
    }
    const first = await bin.execute("read", { path: "main.html" }) as { revision: number };
    await fs.writeFile("~/main.html", "Concurrent change");
    await expect(bin.execute("write", { path: "main.html", content: "Replacement", expectedRevision: first.revision })).rejects.toThrow(/Do not retry/);
    const current = await bin.execute("read", { path: "main.html" }) as { revision: number };
    expect(await bin.execute("write", { path: "main.html", content: "Replacement", expectedRevision: current.revision })).toMatchObject({ revision: current.revision + 1 });
    expect((await fs.readFile("~/main.html")).content).toBe("Replacement");
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

  it("reads five files individually and in a batch", async () => {
    const { fs, bin } = await setup();
    await fs.mkdir("~/jokes");
    for (let i = 1; i <= 5; i++) await bin.execute("write", { path: `jokes/笑話${i}.md`, content: `笑話 ${i}` });
    const found = await fs.listDirectory("~/jokes");
    expect(found).toHaveLength(5);
    for (const file of found) expect(await bin.execute("read", { path: file.path })).toMatchObject({ content: expect.stringContaining("笑話") });
    const batch = await bin.execute("read", { path: found.map((file) => file.path) }) as { files: { path: string; content: string }[] };
    expect(batch.files).toHaveLength(5);
    expect(batch.files.every((file) => file.content.startsWith("笑話"))).toBe(true);
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
