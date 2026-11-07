// @vitest-environment node
import "fake-indexeddb/auto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { AgentSession, MemorySessionEventStore } from "./session";
import { createScriptedSession } from "./scripted";
import { IndexedDbFileSystem, MemoryFileSystem, type FileAccess, type VirtualFileSystem } from "./fs";
import { initializeWorkspace } from "./workspace-bootstrap";
import { installDefaultBin, FILE_METHODS } from "./bin-defaults";
import { BinRegistry } from "./bin";
import { configureFileAgent } from "./file-context";
import { JustBashFileSystem } from "./just-bash-fs";
import { runShellScript } from "./shell-execution";
import type { ShellExecutor } from "./shell-runtime";
import { BASH_PARAMETERS } from "./bash-tool";

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
function fixture(queue: Array<ToolCall[] | string>, events = new MemorySessionEventStore()) {
  const received: unknown[] = [];
  const streamFn: StreamFn = (_model, context) => {
    received.push(structuredClone(context.messages));
    const step = queue.shift(); if (step === undefined) throw new Error("Unexpected model request");
    const message: AssistantMessage = {
      role: "assistant", api: "openai-completions", provider: "scripted", model: "scripted", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      content: typeof step === "string" ? [{ type: "text", text: step }] : step,
      stopReason: typeof step === "string" ? "stop" : "toolUse"
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(message); });
    return stream;
  };
  const session = new AgentSession({ sessionId: "mixed-tools", model: createScriptedSession([]).agent.state.model, streamFn, eventStore: events, maxToolCalls: 32 });
  return { session, streamFn, events, received };
}
async function setup(fs: VirtualFileSystem, services: ConstructorParameters<typeof BinRegistry>[2] = {}) {
  await initializeWorkspace(fs); await installDefaultBin(fs);
  const bin = new BinRegistry(fs, { async execute(source, args, rpc) {
    return structuredClone(await runInNewContext(`(${source})`, {}, { timeout: 1000 })(args, {
      fs: Object.fromEntries(FILE_METHODS.map(method => [method, (...values: unknown[]) => rpc(method, values)])),
      skills: { load: (name: string) => rpc("loadSkill", [name]) }, host: { readPage: (options: unknown) => rpc("readHostPage", [options]) },
      workspace: { home: () => rpc("home", []) },
      agents: { execute: (options: unknown) => rpc("tabAgents", [options]) }, tools: { help: (name?: string) => rpc("commandHelp", [name]) }
    }));
  } }, services); await bin.reload();
  await fs.mkdir("/usr"); await fs.mkdir("/tmp");
  // Test-only executor: the browser acceptance runner uses the actual opaque
  // Worker. Both execute the same shell-execution.ts engine and VFS adapter.
  const shell: ShellExecutor = { execute: (script, options) => runShellScript(script, new JustBashFileSystem(fs.withAccessRecorder(options.onAccess ?? (() => {}))), options) };
  return { bin, shell };
}

describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s AI bash", (_name, create) => {
  it("recovers from empty bash arguments and a create-only write using actionable errors and read revisions", async () => {
    const fs = create();
    const { bin, shell } = await setup(fs);
    const html = '<!doctype html>\n<p title="quoted">雨夜\'s $HOME `literal` \\ text</p>\n';
    const { session, events } = fixture([
      [call("initial", "bash", { script: `cat > main.html <<'HTML'\n${html}HTML\n` })],
      [call("empty", "bash", {})],
      [call("conflict", "write", { path: "main.html", content: html + "<!-- revised -->" })],
      [call("read-revision", "read", { path: "main.html" })],
      [call("overwrite", "write", { path: "main.html", content: html + "<!-- revised -->", expectedRevision: 2 })],
      [call("verify", "read", { path: "main.html" })],
      "已儲存並確認 main.html。"
    ]);
    await configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell });
    expect(await session.prompt("將一篇短篇小說寫入 main.html")).toMatchObject({ status: "success" });
    expect(await fs.readFile("~/main.html")).toMatchObject({ content: html + "<!-- revised -->", revision: 3 });
    const results = session.agent.state.messages.filter(message => message.role === "toolResult");
    const invalidBash = results.find(message => message.toolCallId === "empty");
    expect(JSON.stringify(invalidBash)).toContain('Required arguments in every call: [\\"script\\"]');
    expect(JSON.stringify(invalidBash)).toContain("preserving the fields that were already correct");
    expect(events.list().some(event => event.type === "file_access" && event.toolCallId === "empty")).toBe(false);
    expect(JSON.stringify(results.find(message => message.toolCallId === "conflict"))).toContain("returned revision as expectedRevision");
    expect(events.list().filter(event => event.type === "tool_finished" && event.isError).map(event => event.type === "tool_finished" && event.toolCallId)).toEqual(["empty", "conflict"]);
  });

  it("interleaves native bash and structured tools with one run-bound cwd and exact file traces", async () => {
    const fs = create(), hostContexts: unknown[] = [];
    const { bin, shell } = await setup(fs, {
      readHostPage: async (_args, _signal, context) => { hostContexts.push(context); return { html: "calling host" }; },
      tabAgents: async (_args, _signal, context) => { hostContexts.push(context); return { self: "source-tab" }; }
    });
    await fs.mkdir("~/skills/probe/references", { recursive: true });
    await fs.writeFile("~/skills/probe/SKILL.md", "---\nname: probe\ndescription: Check a referenced file.\n---\nRead references/rule.txt.");
    await fs.writeFile("~/skills/probe/references/rule.txt", "first rule\nsecond rule\n");
    const queue: Array<ToolCall[] | string> = [
      [call("create", "bash", { script: "mkdir -p ~/project; cd ~/project; printf 'alpha\\nbeta\\n' > source.txt; cp source.txt copied.txt; grep alpha copied.txt | head -n 1" })],
      [call("read", "read", { path: "source.txt" })],
      [call("edit", "edit", { path: "source.txt", oldText: "beta", newText: "gamma" })],
      [call("subtree", "bash", { script: "cp -r ~/project /tmp/copy; mv /tmp/copy /tmp/moved; grep gamma /tmp/moved/source.txt; cd /tmp" })],
      [call("write", "write", { path: "from-json.txt", content: "structured" })],
      [call("reverse", "bash", { script: "cat from-json.txt; cat ~/project/source.txt; head -n 1 ~/skills/probe/references/rule.txt" })],
      [call("skill", "skill_load", { name: "probe" })], [call("reference", "read", { path: "~/skills/probe/references/rule.txt" })],
      [call("host", "read_host_page", {}), call("agents", "agents", { action: "list" }), call("help", "help", { command: "bash" })], "verified"
    ];
    const { session, events, received } = fixture(queue);
    const cwd: string[] = [];
    await configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell, onCwd: value => cwd.push(value) });
    expect(await session.prompt("Create, inspect, edit and search the workspace")).toMatchObject({ status: "success" });
    expect((await fs.readFile("~/project/source.txt")).content).toBe("alpha\ngamma\n");
    expect((await fs.readFile("/tmp/from-json.txt")).content).toBe("structured");
    expect(cwd).toEqual(["/home/user/project", "/tmp", "/tmp"]);
    const trace = events.list().filter(event => event.type === "file_access");
    expect(trace).toContainEqual(expect.objectContaining({ toolCallId: "create", method: "writeBytes", path: "/home/user/project/source.txt", revision: 1 }));
    expect(trace).toContainEqual(expect.objectContaining({ toolCallId: "subtree", method: "writeBytes", path: "/tmp/moved/source.txt", revision: 2 }));
    expect(trace).toContainEqual(expect.objectContaining({ toolCallId: "subtree", method: "remove", path: "/tmp/copy/source.txt", revision: 1 }));
    expect(trace.filter(event => ["create", "subtree", "reverse"].includes(event.toolCallId)).every(event => !event.readRange)).toBe(true);
    expect(trace).toContainEqual(expect.objectContaining({ toolCallId: "read", method: "readFile", path: "/home/user/project/source.txt", readRange: { startLine: 1, endLine: 3, totalLines: 3 } }));
    expect(trace).toContainEqual(expect.objectContaining({ toolCallId: "reference", readRange: { startLine: 1, endLine: 3, totalLines: 3 } }));
    expect(hostContexts).toEqual([{ sessionId: "mixed-tools", toolCallId: "host" }, { sessionId: "mixed-tools", toolCallId: "agents" }]);
    expect(JSON.stringify(received)).toContain("alpha\\n"); // Actual shell results reached the next model request.
    const results = session.agent.state.messages.filter(message => message.role === "toolResult");
    expect(JSON.stringify(results)).toContain("maxSteps"); // Native bash help schema is available through help.
  });
});

it("Bash cd updates relative file tools within the same Pi run", async () => {
  const fs = new MemoryFileSystem(), { bin, shell } = await setup(fs);
  await fs.writeFile("~/at-home.txt", "home content");
  const { session } = fixture([
    [call("leave-home", "bash", { script: "cd /tmp" })],
    [call("return-home", "bash", { script: "cd ~" })],
    [call("read-home", "read", { path: "at-home.txt" })],
    [call("bash-home", "bash", { script: "pwd; cat at-home.txt" })],
    "completed"
  ]);
  const cwd: string[] = [];
  await configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell, onCwd: value => cwd.push(value) });
  expect(await session.prompt("return home and inspect the file")).toMatchObject({ status: "success" });
  const results = session.agent.state.messages.filter(message => message.role === "toolResult");
  expect(results.every(result => !result.isError)).toBe(true);
  expect(JSON.stringify(results)).toContain("/home/user\\nhome content");
  expect(cwd).toEqual(["/tmp", "/home/user", "/home/user"]);
});

it("binds late committed writes to their original run and never replays an unknown script on resume", async () => {
  const fs = new MemoryFileSystem(), { bin } = await setup(fs);
  const queue: Array<ToolCall[] | string> = [[call("cancelled-bash", "bash", { script: "append once" })]];
  const { session, streamFn, events } = fixture(queue);
  let deliver!: () => void, executions = 0;
  const shell: ShellExecutor = { async execute(_script, options) {
    executions++;
    const buffered: FileAccess[] = [];
    await fs.withAccessRecorder(access => buffered.push(access)).appendBytes("~/once", new TextEncoder().encode("once"));
    deliver = () => buffered.forEach(access => options.onAccess?.(access));
    throw Object.assign(new Error("Worker stopped after dispatch; read back"), { code: "outcome_unknown" });
  } };
  await configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell });
  const first = await session.prompt("write once"); expect(first.status).toBe("outcome_unknown");
  queue.push("second run");
  const unsubscribe = session.subscribe(event => { if (event.type === "run_started" && event.runId !== first.runId) deliver(); });
  await configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell });
  const second = await session.prompt("inspect, do not repeat"); unsubscribe();
  const writes = events.list().filter(event => event.type === "file_access" && event.path === "/home/user/once" && event.method === "writeBytes");
  expect(writes).toEqual([expect.objectContaining({ runId: first.runId, toolCallId: "cancelled-bash", revision: 1 })]);
  expect(second.runId).not.toBe(first.runId);
  const restored = AgentSession.fromSnapshot(session.snapshot(), { streamFn, eventStore: events });
  expect(restored.recovery().unfinishedRuns).toEqual([]);
  expect(executions).toBe(1); expect((await fs.readFile("~/once")).content).toBe("once");
});

it("rejects unrestricted tool options and a user JS tool that conflicts with native bash", async () => {
  const fs = new MemoryFileSystem(), { bin, shell } = await setup(fs);
  const { session } = fixture([]);
  await configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell });
  const bash = session.agent.state.tools.find(tool => tool.name === "bash")!;
  expect(bash.parameters).toEqual(BASH_PARAMETERS);
  for (const args of [{ script: "echo hi", cwd: "/tmp" }, { script: "echo hi", timeoutMs: 30001 }, { script: "echo hi", maxSteps: 10001 }, { script: "echo hi", maxOutputBytes: 128001 }]) await expect(bash.execute("invalid", args)).rejects.toThrow();
  await fs.writeFile("~/bin/bash.js", "async function main() { return 'untrusted'; }");
  await fs.writeFile("~/bin/manifests/bash.tool.json", JSON.stringify({ version: 1, name: "bash", description: "custom", parameters: { type: "object" }, capabilities: [] }));
  await bin.reload();
  await expect(configureFileAgent(session, fs, "/home/user", bin, undefined, [], { shell })).rejects.toThrow("conflicts");
});
