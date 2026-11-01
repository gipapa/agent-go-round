// @vitest-environment node
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { BinRegistry } from "../core/bin";
import { FILE_METHODS, installDefaultBin } from "../core/bin-defaults";
import { IndexedDbFileSystem } from "../core/fs";
import { configureFileAgent } from "../core/file-context";
import { installJokeDemo, JOKE_PROMPT } from "../core/joke-demo";
import { createGroqRuntime, DEFAULT_GROQ_MODEL } from "../core/provider";
import { AgentSession } from "../core/session";
import { IndexedDbConversationStore, IndexedDbSessionEventStore, IndexedWorkspaceRecords } from "../core/conversations";
import { validateJokeAnswer } from "./joke-validation";

try { loadEnvFile(".env.local"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }

describe("Groq real-model file/skill joke acceptance", () => {
  it("reads five files in Chinese, reloads history and rescans changes, then creates five new files", async () => {
    const apiKey = process.env.AGENT_GO_ROUND_GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Set AGENT_GO_ROUND_GROQ_API_KEY in .env.local before running test:jokes");
    const factory = new IDBFactory();
    let fs = new IndexedDbFileSystem(factory, "joke-acceptance");
    await installDefaultBin(fs); await installJokeDemo(fs);
    const records = new IndexedWorkspaceRecords(factory, "joke-acceptance");
    const events = new IndexedDbSessionEventStore(records); await events.hydrate();
    const store = new IndexedDbConversationStore(records);
    const runtime = await createGroqRuntime({ apiKey, model: process.env.AGENT_GO_ROUND_GROQ_MODEL || DEFAULT_GROQ_MODEL });
    const requests: Array<{ messages: unknown; systemPrompt: string }> = [];
    const streamFn: typeof runtime.streamFn = (model, context, options) => {
      requests.push({ messages: structuredClone(context.messages), systemPrompt: context.systemPrompt ?? "" });
      return runtime.streamFn(model, context, options);
    };
    const bin = new BinRegistry(fs, {
      // Same on-disk JS as the browser; browser smoke separately uses the real sandbox Worker.
      async execute(source, args, rpc) {
        const fn = runInNewContext(`(${source})`, {}, { timeout: 1000 });
        return structuredClone(await fn(args, { fs: Object.fromEntries(FILE_METHODS.map((method) => [method, (...values: unknown[]) => rpc(method, values)])), skills: { load: (name: string) => rpc("loadSkill", [name]) }, host: { readPage: (options: unknown) => rpc("readHostPage", [options]) }, tools: { help: (command?: string) => rpc("commandHelp", [command]) } }));
      }
    });
    await bin.reload();
    let session = new AgentSession({ sessionId: "joke-live", model: runtime.model, streamFn, eventStore: events, maxToolCalls: 32, deadlineMs: 360_000 });
    const report = { provider: "groq", model: runtime.model.id, piVersion: "0.84.4", startedAt: new Date().toISOString(), tasks: [] as Array<Record<string, unknown>>, status: "running" };
    async function task(id: string, prompt: string, directory: string) {
      await configureFileAgent(session, fs, "/home/user", bin);
      const started = Date.now();
      const result = await session.prompt(prompt);
      await events.flush();
      const files: Record<string, { content: string; revision: number }> = {};
      const entries = await fs.listDirectory(directory).catch((error) => { if (error?.code === "not_found") return []; throw error; });
      for (const entry of entries) if (entry.kind === "file" && entry.path.endsWith(".md")) {
        const file = await fs.readFile(entry.path); files[file.path] = { content: file.content, revision: file.revision };
      }
      let failure: string | undefined;
      try {
        if (result.status !== "success") throw new Error(result.error || result.status);
        if (Object.keys(files).length !== 5) throw new Error("Expected five actual joke files");
        validateJokeAnswer(result.text, files, events.list(session.sessionId), result.runId);
      } catch (error) { failure = error instanceof Error ? error.message : String(error); }
      const trace = events.list(session.sessionId).filter((event) => event.runId === result.runId && ["file_access", "context_loaded", "tool_finished"].includes(event.type));
      report.tasks.push({ id, status: failure ? "fail" : "pass", elapsedMs: Date.now() - started, runStatus: result.status, text: result.text, trace, ...(failure ? { failure, finalAssistant: session.agent.state.messages.filter((message) => message.role === "assistant").at(-1), toolErrors: session.agent.state.messages.filter((message) => message.role === "toolResult" && message.isError) } : {}) });
      console.log(JSON.stringify({ task: id, status: failure ? "fail" : "pass", elapsedMs: Date.now() - started }));
      if (failure) throw new Error(`${id}: ${failure}`);
    }
    try {
      await task("five-existing-jokes", JOKE_PROMPT, "~/jokes");
      const firstAnswer = report.tasks[0].text as string;
      const snapshot = session.snapshot();
      await store.remember({ id: "main", name: "Joke acceptance", branch: "master", path: "~", cwd: "/home/user", agentCwd: "/home/user", provider: "groq", mode: "agent", draft: "", transcript: [], session: snapshot });
      const resumed = await new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory, "joke-acceptance")).resume("joke-live");
      fs = new IndexedDbFileSystem(factory, "joke-acceptance");
      await fs.writeFile("~/jokes/笑話1.md", "圖書館的電腦說自己很安靜，因為所有問題都用靜音模式回答。今天換成了全新的版本。");
      session = AgentSession.fromSnapshot(resumed.session, { streamFn, eventStore: events, maxToolCalls: 32, deadlineMs: 360_000 });
      const requestStart = requests.length;
      await task("reload-reconnect-and-rescore", "I changed one of the files. Use joke-master again, reread all five current files in ~/jokes, score each, and choose the funniest one.", "~/jokes");
      expect((requests[requestStart].messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>).some((message) => message.role === "assistant" && message.content.some((block) => block.type === "text" && block.text === firstAnswer))).toBe(true);
      expect(JSON.stringify(requests[requestStart].messages)).toContain(JOKE_PROMPT);
      expect(requests[requestStart].systemPrompt.match(/Workspace instructions from/g)).toHaveLength(1);
      await task("create-and-read-back-five", "Use joke-master. First create exactly five original short jokes as separate .md files in ~/new-jokes using write with createParents true, then actually read each file back, score all five, and select the funniest one.", "~/new-jokes");
      report.status = "pass";
    } catch (error) {
      report.status = "fail";
      throw error;
    } finally {
      await mkdir("test-results", { recursive: true });
      const usage = session.agent.state.messages.filter((message) => message.role === "assistant").reduce((sum, message) => sum + message.usage.totalTokens, 0);
      await writeFile(process.env.AGENT_GO_ROUND_JOKE_REPORT || "test-results/jokes-live.json", JSON.stringify({ ...report, finishedAt: new Date().toISOString(), requestCount: requests.length, totalTokens: usage }, null, 2));
      console.log(JSON.stringify({ provider: report.provider, model: report.model, status: report.status, tasks: report.tasks.map(({ id, status, elapsedMs, failure }) => ({ id, status, elapsedMs, failure })) }));
    }
  }, 600_000);
});
