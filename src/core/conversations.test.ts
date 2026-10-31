// @vitest-environment node
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbConversationStore, IndexedDbSessionEventStore, IndexedWorkspaceRecords } from "./conversations";
import { MemoryWorkspaceStore, type WorkspaceSnapshot } from "./workspace-store";
import { createScriptedSession } from "./scripted";

function snapshot(): WorkspaceSnapshot {
  return { version: 1, activeTabId: "main", nextTabNumber: 3, provider: "scripted", savedAt: Date.now(), tabs: [{ id: "main", name: "main", branch: "master", path: "~", draft: "draft", transcript: [], cwd: "/home/user", provider: "scripted", session: createScriptedSession([], { sessionId: "conversation-a" }).snapshot() }] };
}

describe("IndexedDB conversations", () => {
  it("keeps popup layouts separate while sharing history and session writer ownership", async () => {
    const factory = new IDBFactory();
    const workspace = new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory));
    const popup = new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory), "layout:popup-a");
    await workspace.save(snapshot()); await popup.load();
    const other = snapshot(); other.tabs[0].session = createScriptedSession([], { sessionId: "popup-session" }).snapshot();
    other.tabs[0].draft = "popup draft";
    await popup.save(other);
    await workspace.save(snapshot());
    expect((await popup.load())?.tabs[0].draft).toBe("popup draft");
    expect((await workspace.load())?.tabs[0].draft).toBe("draft");
    expect(await popup.history()).toHaveLength(2);
    await popup.resume("conversation-a"); await workspace.claim("conversation-a");
    await expect(popup.claim("conversation-a")).rejects.toThrow("another browser");
    await workspace.release("conversation-a");
  });
  it("migrates once, preserves history after tab close, and isolates workspaces", async () => {
    const factory = new IDBFactory();
    const legacy = new MemoryWorkspaceStore();
    const initial = snapshot();
    await legacy.save(initial);
    const store = new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory));
    await store.migrate(legacy);
    expect(await store.load()).toEqual(initial);
    const changed = structuredClone(initial);
    changed.tabs[0].draft = "new draft";
    changed.tabs[0].session = createScriptedSession([], { sessionId: "conversation-b" }).snapshot();
    await store.save(changed);
    const reopened = new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory));
    await reopened.migrate(legacy);
    expect((await reopened.load())?.tabs[0].draft).toBe("new draft");
    expect((await reopened.history()).map((tab) => tab.session.sessionId).sort()).toEqual(["conversation-a", "conversation-b"]);
    expect((await reopened.resume("conversation-a")).session.sessionId).toBe("conversation-a");
    expect(await new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory, "other")).load()).toBeUndefined();
  });

  it("detects concurrent writers before model dispatch and stale layout saves", async () => {
    const factory = new IDBFactory();
    const a = new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory));
    await a.save(snapshot());
    const b = new IndexedDbConversationStore(new IndexedWorkspaceRecords(factory));
    await b.load();
    await a.claim("conversation-a");
    await expect(b.claim("conversation-a")).rejects.toThrow(/another browser/);
    await a.release("conversation-a");
    await b.claim("conversation-a");
    await b.release("conversation-a");
    await a.save(snapshot());
    await expect(b.save(snapshot())).rejects.toThrow(/another browser/);
    expect((await a.resume("conversation-a")).draft).toBe("draft");
  });

  it("rolls back failed transactions and persists recovery/source metadata without replay", async () => {
    const factory = new IDBFactory();
    const records = new IndexedWorkspaceRecords(factory);
    await expect(records.access(true, (rows) => { rows.set("partial", true); throw new Error("abort"); })).rejects.toThrow("abort");
    expect(await records.access(false, (rows) => rows.has("partial"))).toBe(false);
    const events = new IndexedDbSessionEventStore(records);
    await events.hydrate();
    events.append({ version: 1, sessionId: "s", type: "run_started", runId: "r", input: "hello" });
    events.append({ version: 1, sessionId: "s", type: "context_loaded", runId: "r", source: { kind: "agents", path: "/home/user/AGENTS.md", revision: 2 } });
    events.append({ version: 1, sessionId: "s", type: "text_delta", runId: "r", delta: "not durable" });
    await events.flush();
    const reloaded = new IndexedDbSessionEventStore(new IndexedWorkspaceRecords(factory));
    await reloaded.hydrate();
    expect(reloaded.list("s")).toHaveLength(2);
    expect(reloaded.list("s")[1]).toMatchObject({ type: "context_loaded", source: { revision: 2 } });
    reloaded.append({ version: 1, sessionId: "s", type: "run_finished", runId: "r", status: "success", text: "done" });
    await reloaded.flush();
    const again = new IndexedDbSessionEventStore(new IndexedWorkspaceRecords(factory));
    await again.hydrate();
    expect(again.list("s")).toHaveLength(3);
  });
});
