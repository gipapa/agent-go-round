import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentHarnessController } from "../chat/useAgentHarnessController";
import { projectModelContext } from "../runtime/harness/contextProjector";
import type { HarnessToolDefinition } from "../runtime/harness/types";

const tools: HarnessToolDefinition[] = [];

function finalRun(answer = "done") {
  return {
    tools,
    transport: { runStep: async () => ({ status: "step" as const, candidateId: "fake", step: { type: "final" as const, answer } }) },
    effectRunner: { execute: vi.fn() },
    projectContext: ({ transcript, tools: definitions }: { transcript: never[]; tools: HarnessToolDefinition[] }) => projectModelContext({ transcript, tools: definitions })
  };
}

describe("useAgentHarnessController", () => {
  it("allows only one active run and persists a bounded terminal projection", async () => {
    const onPersist = vi.fn();
    const { result } = renderHook(() => useAgentHarnessController({ onPersist }));
    let first!: Promise<unknown>;
    await act(async () => {
      first = result.current.start({ ...finalRun(), userInput: "first" });
      expect(await result.current.start({ ...finalRun(), userInput: "second" })).toBeNull();
      await first;
    });
    expect(onPersist).toHaveBeenCalledOnce();
    expect(onPersist.mock.calls[0][0]).toMatchObject({ terminalReason: "final", stepCount: 1 });
    expect(result.current.active).toBe(false);
  });

  it("aborts on pagehide and does not retain ownership after completion", async () => {
    const { result } = renderHook(() => useAgentHarnessController());
    const transport = {
      runStep: (_context: unknown, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ status: "aborted" as const, message: "hidden" }), { once: true });
      })
    };
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.start({ ...finalRun(), userInput: "long", transport });
      await Promise.resolve();
      globalThis.dispatchEvent(new Event("pagehide"));
      await run;
    });
    expect(result.current.active).toBe(false);
    expect(result.current.lastResult?.stopReason).toBe("aborted");
  });

  it("owns arbitrary harness tasks with the same single-run signal and event ledger", async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useAgentHarnessController());
    let release!: () => void;
    const first = result.current.startTask(async (context) => {
      context.emit({ type: "run_start", runId: context.runId, generation: context.generation });
      await new Promise<void>((resolve) => { release = resolve; });
      return context.runId;
    }, onComplete);
    expect(await result.current.startTask(async () => "second")).toBeNull();
    release();
    await act(async () => { await first; });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(result.current.events[0]).toMatchObject({ type: "run_start" });
    expect(result.current.active).toBe(false);
  });

  it("caps an oversized event ledger request", async () => {
    const { result } = renderHook(() => useAgentHarnessController({ maxEvents: Number.MAX_SAFE_INTEGER }));
    await act(async () => {
      await result.current.startTask(async (context) => {
        for (let index = 0; index < 120; index += 1) {
          context.emit({ type: "model_step_start", step: index + 1 });
        }
        return "done";
      });
    });
    expect(result.current.events).toHaveLength(100);
    expect(result.current.events[0]).toMatchObject({ type: "model_step_start", step: 21 });
  });
});
