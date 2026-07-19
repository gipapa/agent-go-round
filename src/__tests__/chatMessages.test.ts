import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendToolPromptSummary,
  confirmedFromToolOutput,
  getThinkStreamingState,
  mergeSystemText,
  normalizeImportedMessage,
  stripPreviousToolPromptSummaries
} from "../runtime/chatMessages";

afterEach(() => {
  vi.useRealTimers();
});

describe("chat message runtime", () => {
  it("rejects invalid imports and normalizes supported message metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(normalizeImportedMessage({ role: "invalid", content: "text" })).toBeNull();
    const normalized = normalizeImportedMessage({
      id: "message-1",
      role: "assistant",
      content: "done",
      isStreaming: "yes",
      skillTrace: [{ label: "Plan", content: "Step" }, { label: 1, content: "invalid" }],
      skillTodo: [
        { id: "todo-1", label: "Run", status: "completed", source: "planner" },
        { id: "todo-2", label: "Bad", status: "unknown", source: "planner" }
      ],
      skillPhase: "final_answer"
    });

    expect(normalized).toMatchObject({
      id: "message-1",
      role: "assistant",
      content: "done",
      isStreaming: false,
      skillTrace: [{ label: "Plan", content: "Step" }],
      skillTodo: [{ id: "todo-1", label: "Run", status: "completed", source: "planner", updatedAt: 1767225600000 }],
      skillPhase: "final_answer",
      ts: 1767225600000
    });
  });

  it("keeps chain-of-thought placeholders hidden only while the think block is open", () => {
    expect(getThinkStreamingState("<thi")).toEqual({ hideWhileStreaming: true, statusText: "思考中…" });
    expect(getThinkStreamingState(" <think>private")).toEqual({ hideWhileStreaming: true, statusText: "思考中…" });
    expect(getThinkStreamingState("<think>private</think>answer")).toEqual({ hideWhileStreaming: false, statusText: undefined });
    expect(getThinkStreamingState("answer")).toEqual({ hideWhileStreaming: false, statusText: undefined });
  });

  it("replaces stale tool summaries instead of accumulating them", () => {
    const first = appendToolPromptSummary("question", "first result");
    const second = appendToolPromptSummary(first, "second result");
    expect(stripPreviousToolPromptSummaries(second)).toBe("question");
    expect(second).not.toContain("first result");
    expect(second.match(/請根據以下工具摘要完成回答/g)).toHaveLength(1);
  });

  it("preserves confirmation and system prompt helper behavior", () => {
    expect(confirmedFromToolOutput({ confirmed: true })).toBe(true);
    expect(confirmedFromToolOutput({ confirmed: "yes" })).toBeNull();
    expect(mergeSystemText(" first ", undefined, "second")).toBe("first\n\nsecond");
  });
});
