import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendToolPromptSummary,
  MAX_PERSISTED_CHAT_CONTENT_CHARS,
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
      harnessRun: {
        runId: "run-1",
        generation: 2,
        stepCount: 3,
        toolCallCount: 4,
        durationMs: 500,
        terminalReason: "final",
        activity: [{ type: "tool_result", message: "ok" }]
      },
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
    expect(normalized?.harnessRun).toMatchObject({ runId: "run-1", generation: 2, terminalReason: "final" });
  });

  it("keeps chain-of-thought placeholders hidden only while the think block is open", () => {
    expect(getThinkStreamingState("<thi")).toEqual({ hideWhileStreaming: true, statusText: "思考中…" });
    expect(getThinkStreamingState(" <think>private")).toEqual({ hideWhileStreaming: true, statusText: "思考中…" });
    expect(getThinkStreamingState("<think>private</think>answer")).toEqual({ hideWhileStreaming: false, statusText: undefined });
    expect(getThinkStreamingState("answer")).toEqual({ hideWhileStreaming: false, statusText: undefined });
  });

  it("restores a stale streaming assistant as an interrupted message", () => {
    expect(normalizeImportedMessage({ role: "assistant", content: "", isStreaming: true, statusText: "running" })).toMatchObject({
      content: "【執行中斷】\n上一輪執行在頁面重新載入前尚未完成。",
      isStreaming: false,
      hideWhileStreaming: false
    });
  });

  it("restores a harness message without a terminal outcome as interrupted", () => {
    expect(normalizeImportedMessage({
      role: "assistant",
      content: "partial",
      harnessRun: { runId: "run", generation: 1, stepCount: 1, toolCallCount: 0, durationMs: 10, activity: [] }
    })).toMatchObject({
      content: "partial\n\n【執行中斷】\n上一輪執行在頁面重新載入前尚未完成。",
      isStreaming: false
    });
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

  it("bounds imported content and diagnostic metadata", () => {
    const normalized = normalizeImportedMessage({
      role: "assistant",
      content: "x".repeat(MAX_PERSISTED_CHAT_CONTENT_CHARS + 500),
      skillTrace: Array.from({ length: 100 }, (_, index) => ({ label: "l".repeat(500), content: "t".repeat(3_000) })),
      skillTodo: Array.from({ length: 120 }, (_, index) => ({
        id: `todo-${index}`,
        label: "todo".repeat(100),
        status: "pending",
        source: "planner",
        reason: "reason".repeat(1_000),
        updatedAt: Number.NaN
      })),
      harnessRun: {
        runId: "r".repeat(500),
        generation: 1,
        stepCount: 1,
        toolCallCount: 1,
        durationMs: 1,
        terminalReason: "final",
        activity: Array.from({ length: 300 }, () => ({ type: "a".repeat(500), message: "m".repeat(2_000) }))
      }
    });

    expect(normalized?.content.length).toBeLessThanOrEqual(MAX_PERSISTED_CHAT_CONTENT_CHARS);
    expect(normalized?.skillTrace).toHaveLength(80);
    expect(normalized?.skillTrace?.[0].content.length).toBeLessThanOrEqual(2_000);
    expect(normalized?.skillTodo).toHaveLength(100);
    expect(normalized?.skillTodo?.[0].reason?.length).toBeLessThanOrEqual(2_000);
    expect(normalized?.harnessRun?.activity).toHaveLength(256);
    expect(normalized?.harnessRun?.activity[0].message?.length).toBeLessThanOrEqual(500);
  });
});
