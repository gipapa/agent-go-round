import { describe, expect, it } from "vitest";
import { createScriptedSession, createScriptedStreamFn } from "./scripted";
import { AgentSession, MemorySessionEventStore } from "./session";
import { MemorySessionStore, validateSessionSnapshot } from "./persistence";

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

  it("rejects a snapshot with a missing identity or unsupported format", () => {
    const snapshot = createScriptedSession([], { sessionId: "expected" }).snapshot();
    expect(() => validateSessionSnapshot({ ...snapshot, sessionId: "" })).toThrow(/sessionId/);
    expect(() => validateSessionSnapshot({ ...snapshot, version: 99 })).toThrow(/Unsupported/);
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
