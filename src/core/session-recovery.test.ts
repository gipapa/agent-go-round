// @vitest-environment node
import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbSessionEventStore, IndexedWorkspaceRecords } from "./conversations";
import { inspectSessionRecovery, type SessionEvent } from "./session";

function event(type: SessionEvent["type"], extra: Record<string, unknown> = {}): SessionEvent {
  return {
    version: 1,
    sessionId: "session-1",
    type,
    runId: "run-1",
    ...(type === "run_started" ? { input: "continue safely" } : {}),
    ...(type === "tool_started" || type === "tool_finished" || type === "tool_outcome_unknown"
      ? { toolCallId: "call-1", toolName: "write" }
      : {}),
    ...(type === "tool_finished" ? { isError: false } : {}),
    ...(type === "tool_outcome_unknown" ? { reason: "confirmation timed out" } : {}),
    ...(type === "run_finished" ? { status: "success", text: "done" } : {}),
    ...extra
  } as SessionEvent;
}

describe("session recovery", () => {
  it("persists events by stable session identity in IndexedDB", async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbSessionEventStore(new IndexedWorkspaceRecords(factory));
    await first.hydrate();
    first.append(event("run_started")); first.append(event("tool_started"));
    await first.flush();
    const restored = new IndexedDbSessionEventStore(new IndexedWorkspaceRecords(factory));
    await restored.hydrate();
    expect(restored.list("session-1")).toHaveLength(2);
    expect(restored.list("other-session")).toEqual([]);
  });

  it("reports interrupted work without replaying a model or tool", () => {
    const interrupted = inspectSessionRecovery([event("run_started"), event("tool_started")]);
    expect(interrupted).toEqual({ sessionId: "session-1", unfinishedRuns: [{ runId: "run-1", status: "interrupted", pendingToolCallIds: ["call-1"] }] });

    const unknown = inspectSessionRecovery([event("run_started"), event("tool_started"), event("tool_outcome_unknown")]);
    expect(unknown.unfinishedRuns[0]).toMatchObject({ status: "outcome_unknown", pendingToolCallIds: ["call-1"] });

    const complete = inspectSessionRecovery([event("run_started"), event("tool_started"), event("tool_finished"), event("run_finished")]);
    expect(complete.unfinishedRuns).toEqual([]);
  });
});
