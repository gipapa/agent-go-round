import { describe, expect, it } from "vitest";
import { createAssistantMessageEventStream, Type, type AssistantMessage, type Model, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { AgentSession, MemorySessionEventStore, ToolOutcomeUnknownError, type SessionTool } from "./session";

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

const MODEL: Model<"openai-completions"> = {
  id: "scripted-tools",
  name: "Scripted tools",
  api: "openai-completions",
  provider: "scripted",
  baseUrl: "https://scripted.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 1_024
};

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "scripted",
    model: "scripted-tools",
    usage: USAGE,
    stopReason,
    timestamp: Date.now()
  };
}

function toolStream(argument: unknown, onRequest?: () => void): StreamFn {
  let responseIndex = 0;
  return (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    onRequest?.();
    void (async () => {
      if (options?.signal?.aborted) {
        const aborted = assistant([], "aborted");
        stream.push({ type: "error", reason: "aborted", error: aborted });
        stream.end(aborted);
        return;
      }
      if (responseIndex++ === 0) {
        const toolCall: ToolCall = { type: "toolCall", id: "call-1", name: "lookup", arguments: argument as Record<string, unknown> };
        const partial = assistant([], "pending");
        const complete = assistant([toolCall], "toolUse");
        stream.push({ type: "start", partial });
        stream.push({ type: "toolcall_start", contentIndex: 0, partial });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: complete });
        stream.push({ type: "done", reason: "toolUse", message: complete });
        stream.end(complete);
        return;
      }
      const text = "tool round complete";
      const start = assistant([], "pending");
      const complete = assistant([{ type: "text", text }], "stop");
      stream.push({ type: "start", partial: start });
      stream.push({ type: "text_start", contentIndex: 0, partial: start });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: complete });
      stream.push({ type: "text_end", contentIndex: 0, content: text, partial: complete });
      stream.push({ type: "done", reason: "stop", message: complete });
      stream.end(complete);
    })();
    return stream;
  };
}

function createLookupTool(calls: string[], requiresApproval = false, outcomeUnknown = false): SessionTool {
  return {
    name: "lookup",
    label: "Lookup",
    description: "Look up a value",
    requiresApproval,
    parameters: Type.Object({ value: Type.String({ minLength: 1 }) }),
    execute: async (_toolCallId, params) => {
      const value = (params as { value: string }).value;
      calls.push(value);
      if (outcomeUnknown) throw new ToolOutcomeUnknownError("Remote write was sent but confirmation timed out");
      return { content: [{ type: "text", text: `value:${value}` }], details: { value } };
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("AgentSession tools", () => {
  it("validates typed arguments, executes an approved tool, and records versioned events", async () => {
    const calls: string[] = [];
    const approvals: string[] = [];
    const store = new MemorySessionEventStore();
    const session = new AgentSession({
      sessionId: "tool-session",
      model: MODEL,
      streamFn: toolStream({ value: "alpha" }),
      tools: [createLookupTool(calls, true)],
      approval: async ({ toolName, args }) => {
        approvals.push(`${toolName}:${(args as { value: string }).value}`);
        return true;
      },
      eventStore: store
    });

    const result = await session.prompt("look up alpha");
    const events = store.list();

    expect(result).toMatchObject({ status: "success", text: "tool round complete" });
    expect(calls).toEqual(["alpha"]);
    expect(approvals).toEqual(["lookup:alpha"]);
    expect(new Set(events.map((event) => event.version))).toEqual(new Set([1]));
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "tool_started",
      "tool_approval_requested",
      "tool_approval_resolved",
      "tool_finished",
      "tool_result_ready",
      "text_delta",
      "run_finished"
    ]);
    expect(events.find((event) => event.type === "tool_finished")).toMatchObject({ isError: false, toolName: "lookup" });
    expect(events.find((event) => event.type === "tool_started")).not.toHaveProperty("args");
  });

  it("blocks a tool without running its side effect when approval is denied", async () => {
    const calls: string[] = [];
    const events: string[] = [];
    const session = new AgentSession({
      sessionId: "denied-tool-session",
      model: MODEL,
      streamFn: toolStream({ value: "blocked" }),
      tools: [createLookupTool(calls, true)],
      approval: () => false
    });
    session.subscribe((event) => events.push(event.type));

    const result = await session.prompt("do the protected lookup");

    expect(result.status).toBe("success");
    expect(calls).toEqual([]);
    expect(events).toContain("tool_approval_requested");
    expect(events).toContain("tool_blocked");
  });

  it("enforces the per-run tool-call limit before execution", async () => {
    const calls: string[] = [];
    const store = new MemorySessionEventStore();
    const session = new AgentSession({
      sessionId: "limited-tool-session",
      model: MODEL,
      streamFn: toolStream({ value: "limited" }),
      tools: [createLookupTool(calls)],
      maxToolCalls: 0,
      eventStore: store
    });

    await session.prompt("do not call tools");

    expect(calls).toEqual([]);
    expect(store.list().find((event) => event.type === "tool_blocked")).toMatchObject({ reason: "Tool call limit reached (0)" });
  });

  it("rejects schema-invalid arguments before the tool side effect", async () => {
    const calls: string[] = [];
    const store = new MemorySessionEventStore();
    const session = new AgentSession({
      sessionId: "invalid-tool-session",
      model: MODEL,
      streamFn: toolStream({ value: "" }),
      tools: [createLookupTool(calls)],
      eventStore: store
    });

    await session.prompt("use an invalid value");

    expect(calls).toEqual([]);
    expect(store.list().find((event) => event.type === "tool_finished")).toMatchObject({ toolName: "lookup", isError: true });
  });

  it("does not execute a tool when the run is aborted while approval is pending", async () => {
    const calls: string[] = [];
    const approvalStarted = deferred<void>();
    const approvalDecision = deferred<boolean>();
    const session = new AgentSession({
      sessionId: "aborted-approval-session",
      model: MODEL,
      streamFn: toolStream({ value: "late" }),
      tools: [createLookupTool(calls, true)],
      approval: async () => {
        approvalStarted.resolve();
        return approvalDecision.promise;
      }
    });

    const run = session.prompt("abort protected lookup");
    await approvalStarted.promise;
    expect(session.stop()).toBe(true);
    approvalDecision.resolve(true);

    const result = await run;
    expect(result.status).toBe("aborted");
    expect(calls).toEqual([]);
  });

  it("preserves an unknown side-effect outcome and does not start an automatic retry turn", async () => {
    const calls: string[] = [];
    let providerRequests = 0;
    const store = new MemorySessionEventStore();
    const session = new AgentSession({
      sessionId: "unknown-outcome-session",
      model: MODEL,
      streamFn: toolStream({ value: "write" }, () => providerRequests++),
      tools: [createLookupTool(calls, false, true)],
      eventStore: store
    });

    const result = await session.prompt("perform the write");

    expect(result).toMatchObject({ status: "outcome_unknown", error: "Tool outcome is unknown; no automatic retry was started" });
    expect(calls).toEqual(["write"]);
    expect(providerRequests).toBe(1);
    expect(store.list().find((event) => event.type === "tool_outcome_unknown")).toMatchObject({
      toolName: "lookup",
      reason: "Remote write was sent but confirmation timed out"
    });
  });

  it("updates the idle tool allow-list without replacing transcript state", async () => {
    const calls: string[] = [];
    const session = new AgentSession({
      sessionId: "dynamic-tools-session",
      model: MODEL,
      streamFn: toolStream({ value: "dynamic" })
    });

    session.setTools([createLookupTool(calls)]);
    await session.prompt("use the newly registered tool");

    expect(calls).toEqual(["dynamic"]);
    expect(session.agent.state.messages.length).toBeGreaterThan(0);
    expect(() => session.setTools([createLookupTool([]), createLookupTool([])])).toThrow("Duplicate tool name");
  });
});
