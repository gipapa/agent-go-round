import "fake-indexeddb/auto";
import { initializeWorkspace } from "../core/workspace-bootstrap";
// @vitest-environment node
import { runInNewContext } from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { BinRegistry } from "../core/bin";
import { FILE_METHODS, installDefaultBin } from "../core/bin-defaults";
import { configureFileAgent } from "../core/file-context";
import { IndexedDbFileSystem } from "../core/fs";
import { installJokeDemo, JOKE_PROMPT } from "../core/joke-demo";
import { AgentSession, MemorySessionEventStore } from "../core/session";
import { createScriptedSession } from "../core/scripted";
import { jokeContextFromFiles, validateJokeAnswer } from "./joke-validation";

it("loads joke rules and skills from persisted VFS, delivers full reads, and refreshes after resume", async () => {
  const factory = new IDBFactory();
  let fs = new IndexedDbFileSystem(factory, "joke-context-regression");
  await initializeWorkspace(fs);
  await installDefaultBin(fs);
  await installJokeDemo(fs);
  // Both documented lowercase aliases must work in the actual runtime too.
  expect((await fs.readFile("~/agents.md")).content).toBe("請回覆繁體中文");
  await fs.rename("~/skills/joke-master/SKILL.md", "~/skills/joke-master/skill.md");
  expect((await installJokeDemo(fs)).kept).toHaveLength(8);
  await expect(fs.stat("~/AGENTS.md")).rejects.toMatchObject({ code: "not_found" });
  await expect(fs.stat("~/skills/joke-master/SKILL.md")).rejects.toMatchObject({ code: "not_found" });
  const skillPath = "/home/user/skills/joke-master/skill.md";
  const scoringPath = "/home/user/skills/joke-master/references/scoring.md";
  await fs.writeFile("~/jokes/笑話1.md", Array.from({ length: 205 }, (_, i) => `笑話內容第 ${i + 1} 行`).join("\n"));
  const events = new MemorySessionEventStore();
  const queue: Array<ToolCall[] | string> = [];
  const prompts: string[] = [];
  const received: unknown[] = [];
  const streamFn: StreamFn = (_model, context) => {
    prompts.push(context.systemPrompt ?? "");
    received.push(structuredClone(context.messages));
    const next = queue.shift();
    if (next === undefined) throw new Error("Unexpected model request");
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant", api: "openai-completions", provider: "scripted", model: "scripted", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      content: typeof next === "string" ? [{ type: "text", text: next }] : next,
      stopReason: typeof next === "string" ? "stop" : "toolUse"
    };
    queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(message); });
    return stream;
  };
  const model = createScriptedSession([]).agent.state.model;
  let session = new AgentSession({ sessionId: "joke-context", model, streamFn, eventStore: events });
  function registry() {
    return new BinRegistry(fs, { async execute(source, args, rpc) {
      const main = runInNewContext(`(${source})`, {}, { timeout: 1000 });
      return structuredClone(await main(args, {
        fs: Object.fromEntries(FILE_METHODS.map(method => [method, (...values: unknown[]) => rpc(method, values)])),
        skills: { load: (name: string) => rpc("loadSkill", [name]) }
      }));
    } });
  }
  const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });
  async function run(round: number) {
    const bin = registry(); await bin.reload();
    const nodes = [];
    for (const directory of ["~", "~/skills/joke-master", "~/skills/joke-master/references"]) {
      for (const entry of await fs.listDirectory(directory)) if (entry.kind === "file") nodes.push(await fs.readFile(entry.path));
    }
    const context = jokeContextFromFiles(nodes);
    const contents = await Promise.all((await fs.listDirectory("~/jokes")).map(file => fs.readFile(file.path)));
    const files = Object.fromEntries(contents.map(file => [file.path, { content: file.content, revision: file.revision }]));
    const paths = Object.keys(files);
    const text = "以下是依照檔案內容的評分。\n```json\n" + JSON.stringify({ scores: paths.map(path => ({ path, score: 8, reason: "有趣的轉折" })), winner: { path: paths[0], text: files[paths[0]].content, reason: "節奏最好" } }) + "\n```";
    await configureFileAgent(session, fs, "/home/user", bin);
    const requestStart = prompts.length;
    if (round === 1) queue.push([call("skill", "skill_load", { name: "joke-master" })]);
    queue.push([call(`reference-${round}`, "read", { path: scoringPath })]);
    queue.push([call(`jokes-${round}`, "read", { path: paths })]);
    queue.push([call(`last-page-${round}`, "read", { path: paths[0], offset: 201 })]);
    queue.push(text);
    const result = await session.prompt(JOKE_PROMPT);
    expect(result.status).toBe("success");
    expect(validateJokeAnswer(result.text, files, events.list(), result.runId, context).scores).toHaveLength(5);
    expect(prompts[requestStart]).toContain(context.agents.content);
    const instructions = context.skill.content.split("---").slice(2).join("---").trim();
    if (round === 1) {
      expect(prompts[requestStart]).not.toContain(instructions);
      expect(JSON.stringify(received.at(-1))).toContain(JSON.stringify(instructions).slice(1, -1));
    } else {
      expect(prompts[requestStart]).toContain(instructions);
      expect(prompts[requestStart]).not.toContain("請回覆繁體中文");
      expect(prompts[requestStart].match(/Workspace instructions from/g)).toHaveLength(1);
    }
    const trace = events.list().filter(event => event.runId === result.runId);
    expect(trace).toContainEqual(expect.objectContaining({ type: "context_loaded", source: { kind: "skill", path: skillPath, revision: context.skill.revision } }));
    expect(() => validateJokeAnswer(result.text, files, trace.filter(event => event.type !== "file_access" || event.toolCallId !== `last-page-${round}`), result.runId, context)).toThrow(/not read completely/);
  }
  await run(1);
  const snapshot = session.snapshot();
  fs = new IndexedDbFileSystem(factory, "joke-context-regression");
  await fs.writeFile("~/agents.md", "新版規則：以繁體中文簡短回答。");
  const skill = await fs.readFile(skillPath);
  await fs.writeFile(skill.path, skill.content + "\n新版 skill：解釋笑點。\n");
  await fs.writeFile(scoringPath, "新版準則：評估節奏與意外性。");
  session = AgentSession.fromSnapshot(snapshot, { streamFn, eventStore: events });
  await run(2);
});
