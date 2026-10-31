import { describe, expect, it } from "vitest";
import { createScriptedSession, createScriptedStreamFn } from "./scripted";
import { AgentSession, MemorySessionEventStore } from "./session";
import { LocalStorageSessionStore, MemorySessionStore, SessionPersistenceError } from "./persistence";

class MapStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("session persistence", () => {
  it("saves an idle transcript and restores the same session identity", async () => {
    const original = createScriptedSession(["first answer"], { sessionId: "persisted-session" });
    await original.prompt("remember this");

    const store = new MemorySessionStore();
    await original.save(store);
    const snapshot = await store.load("persisted-session");
    if (!snapshot) throw new Error("Expected saved snapshot");

    const restored = AgentSession.fromSnapshot(snapshot, { streamFn: createScriptedStreamFn(["restored answer"]) });
    const result = await restored.prompt("continue after reload");

    expect(restored.sessionId).toBe("persisted-session");
    expect(result).toMatchObject({ status: "success", text: "restored answer" });
    expect(restored.agent.state.messages.filter((message) => message.role === "user").map((message) => Array.isArray(message.content)
      ? message.content.map((block) => block.type === "text" ? block.text : "").join("")
      : message.content)).toEqual([
      "remember this",
      "continue after reload"
    ]);
  });

  it("uses the same contract for local storage and rejects an identity mismatch", async () => {
    const storage = new MapStorage();
    const store = new LocalStorageSessionStore(storage, "test.session.");
    const session = createScriptedSession(["answer"], { sessionId: "local/session" });
    await session.prompt("persist me");
    await session.save(store);

    expect((await store.load("local/session"))?.sessionId).toBe("local/session");
    await expect(store.load("other-session")).resolves.toBeUndefined();

    storage.setItem("test.session.bad", JSON.stringify({
      version: 1,
      sessionId: "different",
      model: session.agent.state.model,
      systemPrompt: "",
      messages: [],
      savedAt: Date.now()
    }));
    await expect(store.load("bad")).rejects.toBeInstanceOf(SessionPersistenceError);
  });

  it("does not pretend a running session is recoverably saved", async () => {
    const session = createScriptedSession(["slow"], { delayMs: 3 });
    const run = session.prompt("still running");

    expect(() => session.snapshot()).toThrow(/running session/);
    expect(session.stop()).toBe(true);
    await run;
  });

  it("keeps event storage separate and filterable by session identity", () => {
    const events = new MemorySessionEventStore();
    const sessionA = createScriptedSession(["a"], { sessionId: "a" });
    const sessionB = createScriptedSession(["b"], { sessionId: "b" });
    const listener = (event: Parameters<typeof events.append>[0]) => events.append(event);
    sessionA.subscribe(listener);
    sessionB.subscribe(listener);

    return Promise.all([sessionA.prompt("a"), sessionB.prompt("b")]).then(() => {
      expect(events.list("a").every((event) => event.sessionId === "a")).toBe(true);
      expect(events.list("b").every((event) => event.sessionId === "b")).toBe(true);
      expect(events.list()).toHaveLength(4 + "a".length + "b".length);
    });
  });
});
