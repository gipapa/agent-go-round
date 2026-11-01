// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createScriptedSession } from "./scripted";
import type { WorkspaceSnapshot } from "./workspace-store";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbConversationStore, IndexedWorkspaceRecords } from "./conversations";

function store() { return new IndexedDbConversationStore(new IndexedWorkspaceRecords(new IDBFactory())); }

async function snapshot(): Promise<WorkspaceSnapshot> {
  const session = createScriptedSession(["restored"], { sessionId: "session-main" });
  await session.prompt("saved question");
  const savedSession = session.snapshot();
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
      session: savedSession
    }]
  };
}

describe("workspace store", () => {
  it("round-trips tab identity, draft, transcript and session snapshot", async () => {
    const repository = store();
    const original = await snapshot();
    await repository.save(original);
    const loaded = await repository.load();

    expect(loaded).toEqual(original);
    expect(loaded?.tabs[0]).toMatchObject({ id: "main", session: { sessionId: "session-main" }, draft: "unfinished draft" });
  });

  it("rejects a snapshot whose active tab is missing", async () => {
    const repository = store();
    const original = await snapshot();
    await expect(repository.save({ ...original, activeTabId: "closed" })).rejects.toThrow(/activeTabId/);
  });

  it("rejects duplicate tab identities instead of restoring ambiguous state", async () => {
    const repository = store();
    const original = await snapshot();
    await expect(repository.save({ ...original, tabs: [...original.tabs, { ...original.tabs[0] }] })).rejects.toThrow(/duplicate tab id/);
  });

  it("removes a saved workspace without touching session stores", async () => {
    const repository = store();
    await repository.save(await snapshot());
    await repository.remove();
    await expect(repository.load()).resolves.toBeUndefined();
  });
});
