import { AgentSession, DEFAULT_AUTO_COMPACT_PERCENT, type SessionEventStore, type ToolApproval } from "./session";
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent, type Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

function assistant(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "scripted",
    model: "scripted",
    usage: USAGE,
    stopReason,
    timestamp: Date.now()
  };
}

/** A deterministic streaming provider used by regression tests and the demo. */
export function createScriptedStreamFn(responses: readonly string[], delayMs = 0): StreamFn {
  let responseIndex = 0;
  return (_model: Model<any>, _context, options) => {
    const stream = createAssistantMessageEventStream();
    const text = responses[responseIndex++] ?? "scripted response";
    const signal = options?.signal;
    void (async () => {
      let output = "";
      const start = assistant("");
      stream.push({ type: "start", partial: start });
      stream.push({ type: "text_start", contentIndex: 0, partial: start });
      for (const character of text) {
        if (signal?.aborted) {
          const aborted = assistant(output, "aborted");
          const event: AssistantMessageEvent = { type: "error", reason: "aborted", error: aborted };
          stream.push(event);
          stream.end(aborted);
          return;
        }
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        output += character;
        stream.push({ type: "text_delta", contentIndex: 0, delta: character, partial: assistant(output) });
      }
      const complete = assistant(output);
      stream.push({ type: "text_end", contentIndex: 0, content: output, partial: complete });
      stream.push({ type: "done", reason: "stop", message: complete });
      stream.end(complete);
    })();
    return stream;
  };
}

export function createScriptedSession(responses: readonly string[], options?: { sessionId?: string; delayMs?: number; eventStore?: SessionEventStore; approval?: ToolApproval; deadlineMs?: number; maxOutputCharacters?: number; autoCompactPercent?: number }): AgentSession {
  const model: Model<"openai-completions"> = {
    id: "scripted",
    name: "Scripted model",
    api: "openai-completions",
    provider: "scripted",
    baseUrl: "https://scripted.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 1_024
  };
  return new AgentSession({
    sessionId: options?.sessionId ?? "scripted-session",
    model,
    streamFn: createScriptedStreamFn(responses, options?.delayMs),
    eventStore: options?.eventStore,
    approval: options?.approval,
    deadlineMs: options?.deadlineMs,
    maxOutputCharacters: options?.maxOutputCharacters,
    autoCompactPercent: options?.autoCompactPercent ?? DEFAULT_AUTO_COMPACT_PERCENT
  });
}
