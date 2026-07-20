import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatHistoryController } from "../chat/useChatHistoryController";
import { ChatMessage } from "../types";

const restoredMessage: ChatMessage = {
  id: "restored",
  role: "user",
  content: "restored content",
  ts: 1
};

function createDependencies(initialHistory: ChatMessage[] = []) {
  return {
    storage: {
      load: vi.fn(async () => initialHistory),
      save: vi.fn(async () => undefined)
    },
    pushLog: vi.fn(),
    download: vi.fn(),
    summarizeHistory: vi.fn(async () => ({
      summary: "summary text",
      agent: { id: "agent-1", name: "Agent", model: "model" }
    }))
  };
}

function textFile(text: string) {
  return { text: vi.fn(async () => text) } as unknown as File;
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("chat history controller", () => {
  it("restores, normalizes, mutates, and persists history", async () => {
    const deps = createDependencies([restoredMessage]);
    const { result } = renderHook(() => useChatHistoryController({
      activeTab: "chat",
      historyMessageLimit: 10,
      ...deps
    }));

    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.history[0]).toMatchObject(restoredMessage);
    await waitFor(() => expect(deps.storage.save).toHaveBeenCalledWith(result.current.history));

    const assistant: ChatMessage = { id: "assistant", role: "assistant", content: "draft", ts: 2 };
    act(() => result.current.append(assistant));
    act(() => result.current.patchMessage("assistant", { content: "done" }));

    expect(result.current.history[0]).toMatchObject(restoredMessage);
    expect(result.current.history[1]).toEqual({ ...assistant, content: "done" });
    await waitFor(() => expect(deps.storage.save).toHaveBeenLastCalledWith(result.current.history));
  });

  it("limits model history and excludes tool messages", async () => {
    const deps = createDependencies();
    const { result } = renderHook(() => useChatHistoryController({
      activeTab: "chat",
      historyMessageLimit: 2,
      ...deps
    }));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));

    const messages: ChatMessage[] = [
      { id: "one", role: "user", content: "one", ts: 1 },
      { id: "tool", role: "tool", content: "tool", ts: 2 },
      { id: "two", role: "assistant", content: "two", ts: 3 },
      { id: "three", role: "user", content: "three", ts: 4 }
    ];
    expect(result.current.limitHistory(messages).map((message) => message.id)).toEqual(["two", "three"]);
  });

  it("imports raw history and plain-text summaries", async () => {
    const deps = createDependencies();
    const { result } = renderHook(() => useChatHistoryController({
      activeTab: "chat",
      historyMessageLimit: 10,
      ...deps
    }));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));

    await act(async () => result.current.importHistoryFile(textFile(JSON.stringify({
      kind: "raw_history",
      history: [{ id: "raw", role: "assistant", content: "raw", ts: 5 }, { role: "invalid", content: "bad" }]
    }))));
    expect(result.current.history).toEqual([{ id: "raw", role: "assistant", content: "raw", ts: 5, isStreaming: false, hideWhileStreaming: false }]);

    await act(async () => result.current.importHistoryFile(textFile("carry-over summary")));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toMatchObject({
      role: "user",
      content: "carry-over summary",
      name: "summary_import",
      displayName: "上次對話總結"
    });
  });

  it("exports raw and summarized history through injected download behavior", async () => {
    const deps = createDependencies([restoredMessage]);
    const { result } = renderHook(() => useChatHistoryController({
      activeTab: "chat",
      historyMessageLimit: 10,
      ...deps
    }));
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.history[0]).toMatchObject(restoredMessage);

    act(() => result.current.exportRawHistory());
    expect(deps.download).toHaveBeenCalledWith(
      expect.stringMatching(/^agent-go-round-history-/),
      expect.stringContaining('"kind": "raw_history"'),
      "application/json;charset=utf-8"
    );

    await act(async () => result.current.exportSummaryHistory());
    expect(deps.summarizeHistory).toHaveBeenCalledWith(expect.objectContaining({ history: result.current.history }));
    expect(deps.download).toHaveBeenLastCalledWith(
      expect.stringMatching(/^agent-go-round-summary-/),
      expect.stringContaining('"summary": "summary text"'),
      "application/json;charset=utf-8"
    );
    expect(result.current.isSummaryExporting).toBe(false);
  });

  it("closes fullscreen when leaving the chat tab", async () => {
    const deps = createDependencies();
    const { result, rerender } = renderHook(
      ({ activeTab }) => useChatHistoryController({ activeTab, historyMessageLimit: 10, ...deps }),
      { initialProps: { activeTab: "chat" } }
    );
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => result.current.setIsChatFullscreen(true));
    expect(result.current.isChatFullscreen).toBe(true);

    rerender({ activeTab: "agents" });
    await waitFor(() => expect(result.current.isChatFullscreen).toBe(false));
  });
});
