import { describe, expect, it } from "vitest";
import { loadChatHistory, saveChatHistory } from "../storage/chatStore";
import { MAX_PERSISTED_CHAT_CONTENT_CHARS } from "../runtime/chatMessages";

describe("chat history persistence boundary", () => {
  it("bounds message content before writing and normalizes it on load", async () => {
    await saveChatHistory([
      {
        id: "persisted-large",
        role: "assistant",
        content: "x".repeat(MAX_PERSISTED_CHAT_CONTENT_CHARS + 1),
        ts: Date.now()
      }
    ]);

    const restored = await loadChatHistory();
    expect(restored).toHaveLength(1);
    expect(restored[0].content.length).toBeLessThanOrEqual(MAX_PERSISTED_CHAT_CONTENT_CHARS);
  });

  it("stores only the redacted message projection", async () => {
    await saveChatHistory([{
      id: "persisted-redacted",
      role: "assistant",
      content: "done",
      ts: Date.now(),
      harnessRun: {
        runId: "run-1",
        generation: 1,
        stepCount: 1,
        toolCallCount: 1,
        durationMs: 1,
        terminalReason: "final",
        activity: [{ type: "tool_result", message: "safe outcome" }]
      },
      // Runtime objects must never be able to smuggle raw effect data into
      // the IndexedDB record, even if a caller supplies extra fields.
      rawDetails: { secret: "do not persist" },
      toolInput: { secret: "do not persist" }
    } as ChatMessage & { rawDetails: unknown; toolInput: unknown }]);

    const record = await new Promise<{ messages: Array<Record<string, unknown>> }>((resolve, reject) => {
      const request = indexedDB.open("agr_chat_db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("chat_state", "readonly").objectStore("chat_state").get("current");
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          db.close();
          resolve(read.result as { messages: Array<Record<string, unknown>> });
        };
      };
    });
    expect(record.messages[0]).not.toHaveProperty("rawDetails");
    expect(record.messages[0]).not.toHaveProperty("toolInput");
    expect(record.messages[0]).toHaveProperty("harnessRun");
  });
});
