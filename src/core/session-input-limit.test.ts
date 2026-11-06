import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, Type, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { AgentSession, type SessionEvent } from "./session";
import { createScriptedSession, createScriptedStreamFn } from "./scripted";
import { validateSessionSnapshot } from "./persistence";

const ERROR = '413: {"message":"Request too large for model `qwen/qwen3.8-27b` on input tokens per minute (ITPM): Limit 7000, Requested 7033, please reduce your message size and try again.","type":"tokens","code":"rate_limit_exceeded"}';
const MODEL = { ...createScriptedSession([]).agent.state.model, id: "qwen/qwen3.8-27b", contextWindow: 131_072 };
const OLD = "old conversation ".repeat(1200);
const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function response(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"], errorMessage?: string) {
  const message: AssistantMessage = { role: "assistant", content, stopReason, api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage: USAGE, timestamp: Date.now(), ...(errorMessage ? { errorMessage } : {}) };
  const stream = createAssistantMessageEventStream();
  if (stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
  else stream.push({ type: "done", reason: stopReason as "stop" | "toolUse", message });
  stream.end(message);
  return stream;
}

function createSession(streamFn: StreamFn, history = true) {
  return new AgentSession({ sessionId: "input-limit", model: MODEL, streamFn,
    initialMessages: history ? [{ role: "user", content: OLD, timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "previous reply" }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage: USAGE, stopReason: "stop", timestamp: 2 }] : [] });
}

describe("input-limit auto compaction", () => {
  it("learns the ITPM cap below the context threshold, compacts and retries only the rejected request", async () => {
    const requests: Context[] = [];
    const session = createSession((_model, context) => {
      requests.push(JSON.parse(JSON.stringify(context)));
      return requests.length === 1 ? response([], "error", ERROR) : response([{ type: "text", text: "recovered" }], "stop");
    });
    expect(session.contextUsage().percent).toBeLessThan(40);
    const finished: string[] = [];
    const progress: SessionEvent[] = [];
    session.subscribe(event => {
      if (event.type === "run_finished") finished.push(event.status);
      if (event.type.startsWith("compaction_") || event.type === "request_retry") progress.push(event);
    });
    const result = await session.prompt("latest request");
    expect(result).toMatchObject({ status: "success", text: "recovered" });
    expect(progress).toMatchObject([
      { type: "compaction_started", runId: result.runId, reason: "input_limit" },
      { type: "compaction_finished", runId: result.runId, reason: "input_limit", removedTurns: 1 },
      { type: "request_retry", runId: result.runId, reason: "input_limit", attempt: 1 }
    ]);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0])).toContain(OLD);
    expect(JSON.stringify(requests[1])).not.toContain(OLD);
    expect(JSON.stringify(requests[1])).toContain("latest request");
    expect(JSON.stringify(requests[1])).not.toContain("413");
    expect(finished).toEqual(["success"]);
    expect(session.contextUsage()).toMatchObject({ contextWindow: 131_072, inputTokenLimit: 7000 });
    expect(session.contextUsage().compactTargetTokens).toBeLessThanOrEqual(6300);
  });

  it("retains the latest tool call/result pair without replaying the tool", async () => {
    const requests: Context[] = [];
    let executions = 0;
    const session = createSession((_model, context) => {
      requests.push(JSON.parse(JSON.stringify(context)));
      if (requests.length === 1) return response([{ type: "toolCall", id: "call-1", name: "write", arguments: { text: "CaseSensitive" } }], "toolUse");
      if (requests.length === 2) return response([], "error", ERROR);
      return response([{ type: "text", text: "written" }], "stop");
    });
    session.setTools([{ name: "write", label: "Write", description: "Write once", parameters: Type.Object({ text: Type.String() }), execute: async () => {
      executions++;
      return { content: [{ type: "text", text: "committed CaseSensitive" }], details: {} };
    } }]);
    expect(await session.prompt("write the value")).toMatchObject({ status: "success", text: "written" });
    expect(executions).toBe(1);
    expect(requests).toHaveLength(3);
    const retried = requests[2].messages;
    expect(retried.filter(message => message.role === "toolResult")).toMatchObject([{ toolCallId: "call-1", content: [{ text: "committed CaseSensitive" }] }]);
    expect(retried.filter(message => message.role === "assistant")).toMatchObject([{ content: [{ type: "toolCall", id: "call-1", arguments: { text: "CaseSensitive" } }] }]);
    expect(JSON.stringify(retried)).not.toContain(OLD);
  });

  it("reports a useful error when the current turn alone is too large and does not retry", async () => {
    let requests = 0;
    const session = createSession(() => { requests++; return response([], "error", ERROR); }, false);
    expect(await session.prompt("large current input")).toMatchObject({ status: "error", error: expect.stringContaining("無法再靠壓縮舊回合") });
    expect(requests).toBe(1);
    expect(session.contextUsage().inputTokenLimit).toBe(7000);
  });

  it("bounds recovery to one retry even when the provider keeps rejecting it", async () => {
    let requests = 0;
    const session = createSession(() => { requests++; return response([], "error", ERROR); });
    expect(await session.prompt("current input")).toMatchObject({ status: "error", error: expect.stringContaining("壓縮後重試仍超限") });
    expect(requests).toBe(2);
  });

  it.each([ERROR.replace("413", "429"), ERROR.replace("input tokens per minute (ITPM)", "tokens per minute (TPM)"), "413: payload too large", ERROR.replace("Limit 7000", "Limit 0")])("does not apply input-limit recovery to unrelated or invalid errors: %s", async error => {
    let requests = 0;
    const session = createSession(() => { requests++; return response([], "error", error); });
    expect(await session.prompt("current input")).toMatchObject({ status: "error", error });
    expect(requests).toBe(1);
    expect(session.contextUsage().inputTokenLimit).toBeUndefined();
  });

  it("honors Stop before starting a recovery request", async () => {
    let requests = 0;
    const session = createSession(() => { requests++; return response([], "error", ERROR); });
    session.agent.subscribe(event => { if (event.type === "message_end" && event.message.role === "assistant") session.stop(); });
    expect(await session.prompt("current input")).toMatchObject({ status: "aborted" });
    expect(requests).toBe(1);
  });

  it("persists learned limits and applies them proactively after restore, scoped to the model", async () => {
    const session = createSession(() => response([], "error", ERROR), false);
    await session.prompt("current input");
    const snapshot = validateSessionSnapshot(session.snapshot());
    expect(snapshot.inputTokenBudget).toMatchObject({ limit: 7000 });
    const requests: Context[] = [];
    const restored = AgentSession.fromSnapshot({ ...snapshot, messages: [{ role: "user", content: OLD, timestamp: 1 }] }, { streamFn: (model, context, options) => {
      requests.push(JSON.parse(JSON.stringify(context)));
      return createScriptedStreamFn(["restored"])(model, context, options);
    } });
    expect(await restored.prompt("after reload")).toMatchObject({ status: "success" });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).not.toContain(OLD);
    expect(restored.contextUsage().inputTokenLimit).toBe(7000);
    restored.agent.state.model = { ...MODEL, contextWindow: 10_000 };
    expect(restored.contextUsage().compactTargetTokens).toBeLessThanOrEqual(4000);
    restored.agent.state.model = { ...MODEL, id: "other-model" };
    expect(restored.contextUsage().inputTokenLimit).toBeUndefined();
    expect(restored.snapshot().inputTokenBudget).toBeUndefined();
    for (const budget of [{ limit: 0, estimateScale: 1 }, { limit: 7000, estimateScale: 0 }, { limit: 7000, estimateScale: Infinity }]) {
      expect(() => validateSessionSnapshot({ ...snapshot, inputTokenBudget: budget })).toThrow("Invalid input token budget");
    }
  });
});
