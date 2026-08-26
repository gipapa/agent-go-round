import { describe, expect, it } from "vitest";
import { projectPersistedHarnessRun } from "../chat/harnessProjection";
import type { AgentLoopResult, HarnessEvent } from "../runtime/harness/types";

const result: AgentLoopResult = {
  runId: "run",
  generation: 1,
  stepCount: 1,
  toolCallCount: 1,
  protocolRepairCount: 0,
  transcript: [],
  loadedResourcePaths: [],
  pendingObservation: false,
  terminal: true,
  stopReason: "final",
  finalAnswer: "done"
};

describe("persisted harness projection", () => {
  it("keeps activity messages bounded and excludes raw tool payloads", () => {
    const huge = "x".repeat(10_000);
    const events: HarnessEvent[] = [
      { type: "skill_loaded", skillId: huge },
      { type: "tool_dispatch", call: { callId: "call", toolId: huge, input: { secret: huge }, origin: "model" } },
      { type: "tool_result", call: { callId: "call", toolId: huge, input: { secret: huge }, origin: "model" }, result: { outcome: "failed", modelContent: huge, displaySummary: huge, errorCode: huge, rawDetails: { secret: huge } } },
      { type: "run_end", reason: "final" }
    ];
    const projection = projectPersistedHarnessRun({ result, startedAt: Date.now(), events });
    expect(projection.skillId?.length).toBeLessThanOrEqual(256);
    expect(projection.activity).toHaveLength(4);
    expect(projection.activity.every((entry) => !entry.message || entry.message.length <= 256)).toBe(true);
    expect(JSON.stringify(projection)).not.toContain("secret");
  });

  it("retains bounded context and model-step diagnostics for replay", () => {
    const projection = projectPersistedHarnessRun({
      result,
      startedAt: Date.now(),
      events: [
        { type: "run_start", runId: "run", generation: 3 },
        { type: "context_projected", chars: 1234, messageCount: 5, toolCount: 2 },
        { type: "model_step_start", step: 1 },
        { type: "model_step_end", step: 1, status: "step" },
        { type: "run_end", reason: "final" }
      ]
    });
    expect(projection.activity).toEqual([
      { type: "run_start", message: "generation=3" },
      { type: "context_projected", message: "chars=1234;messages=5;tools=2" },
      { type: "model_step_start", message: "step=1" },
      { type: "model_step_end", message: "step=1;status=step" },
      { type: "run_end", message: "final" }
    ]);
  });

  it("uses a finite default when the activity cap is malformed", () => {
    const projection = projectPersistedHarnessRun({
      result,
      startedAt: Date.now(),
      maxEvents: Number.NaN,
      events: Array.from({ length: 120 }, (_, index) => ({ type: "model_step_start", step: index + 1 }))
    });
    expect(projection.activity).toHaveLength(100);
  });

  it("caps an oversized finite activity request at the persistence limit", () => {
    const projection = projectPersistedHarnessRun({
      result,
      startedAt: Date.now(),
      maxEvents: Number.MAX_SAFE_INTEGER,
      events: Array.from({ length: 120 }, (_, index) => ({ type: "model_step_start", step: index + 1 }))
    });
    expect(projection.activity).toHaveLength(100);
  });
});
