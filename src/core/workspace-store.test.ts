import { describe, expect, it } from "vitest";
import { createScriptedSession } from "./scripted";
import { MemorySessionStore } from "./persistence";
import { LocalStorageWorkspaceStore, MemoryWorkspaceStore, type WorkspaceSnapshot } from "./workspace-store";

class MapStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

async function snapshot(): Promise<WorkspaceSnapshot> {
  const session = createScriptedSession(["restored"], { sessionId: "session-main" });
  await session.prompt("saved question");
  const sessionStore = new MemorySessionStore();
  const savedSession = session.snapshot();
  await sessionStore.save(savedSession);
  const reloadedSession = await sessionStore.load("session-main");
  if (!reloadedSession) throw new Error("Expected session snapshot");
  return {
    version: 1,
    activeTabId: "main",
    nextTabNumber: 3,
    provider: "scripted",
    savedAt: Date.now(),
    tabs: [{
      id: "main",
      name: "main",
      branch: "master",
      path: "~/agent-go-round",
      draft: "unfinished draft",
      transcript: [{ id: "line-1", role: "input", text: "saved question" }],
      session: reloadedSession
    }]
  };
}

describe("workspace store", () => {
  it("round-trips tab identity, draft, transcript and session snapshot", async () => {
    const store = new MemoryWorkspaceStore();
    const original = await snapshot();
    await store.save(original);
    const loaded = await store.load();

    expect(loaded).toEqual(original);
    expect(loaded?.tabs[0]).toMatchObject({ id: "main", session: { sessionId: "session-main" }, draft: "unfinished draft" });
  });

  it("uses local storage and rejects a snapshot whose active tab is missing", async () => {
    const storage = new MapStorage();
    const store = new LocalStorageWorkspaceStore(storage, "workspace.test");
    const original = await snapshot();
    await store.save(original);
    await expect(store.load()).resolves.toEqual(original);

    const invalid = { ...original, activeTabId: "closed" };
    storage.setItem("workspace.test", JSON.stringify(invalid));
    await expect(store.load()).rejects.toThrow(/activeTabId/);
  });

  it("rejects duplicate tab identities instead of restoring ambiguous state", async () => {
    const store = new MemoryWorkspaceStore();
    const original = await snapshot();
    await expect(store.save({ ...original, tabs: [...original.tabs, { ...original.tabs[0] }] })).rejects.toThrow(/duplicate tab id/);
  });

  it("removes a saved workspace without touching session stores", async () => {
    const store = new MemoryWorkspaceStore();
    await store.save(await snapshot());
    await store.remove();
    await expect(store.load()).resolves.toBeUndefined();
  });
});
