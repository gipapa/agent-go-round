import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentLoop } from "../runtime/harness/runAgentLoop";
import type {
  AgentLoopArgs,
  AgentLoopResult,
  HarnessEvent,
  HarnessRunState
} from "../runtime/harness/types";
import { generateId } from "../utils/id";
import { errorMessage } from "../utils/errors";
import { projectPersistedHarnessRun, type PersistedHarnessProjection } from "./harnessProjection";

export type AgentHarnessController = {
  active: boolean;
  activeRunId: string | null;
  generation: number;
  events: HarnessEvent[];
  lastResult: AgentLoopResult | null;
  start: (args: Omit<AgentLoopArgs, "runId" | "generation" | "signal" | "isCurrent" | "emit">) => Promise<AgentLoopResult | null>;
  startTask: <T>(
    task: (context: AgentHarnessTaskContext) => Promise<T>,
    onComplete?: (result: T, startedAt: number, events: HarnessEvent[]) => void
  ) => Promise<T | null>;
  abort: (reason?: string) => void;
};

export type AgentHarnessTaskContext = {
  runId: string;
  generation: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  emit: (event: HarnessEvent) => void;
};

const MAX_CONTROLLER_EVENTS = 100;

export function useAgentHarnessController(args?: { maxEvents?: number; onPersist?: (projection: PersistedHarnessProjection) => void }): AgentHarnessController {
  const [active, setActive] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [lastResult, setLastResult] = useState<AgentLoopResult | null>(null);
  const activeRef = useRef<{ runId: string; generation: number; controller: AbortController } | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const maxEvents = Number.isFinite(args?.maxEvents)
    ? Math.min(MAX_CONTROLLER_EVENTS, Math.max(1, Math.floor(args?.maxEvents as number)))
    : MAX_CONTROLLER_EVENTS;
  const onPersistRef = useRef(args?.onPersist);
  onPersistRef.current = args?.onPersist;

  const abort = useCallback((reason = "Run aborted by controller.") => {
    activeRef.current?.controller.abort(reason);
  }, []);

  const startTask = useCallback(async <T,>(
    task: (context: AgentHarnessTaskContext) => Promise<T>,
    onComplete?: (result: T, startedAt: number, events: HarnessEvent[]) => void
  ): Promise<T | null> => {
    if (activeRef.current) return null;
    const runId = generateId();
    const nextGeneration = generationRef.current + 1;
    generationRef.current = nextGeneration;
    const controller = new AbortController();
    const startedAt = Date.now();
    const runOwner = { runId, generation: nextGeneration, controller };
    activeRef.current = runOwner;
    if (mountedRef.current) {
      setActive(true);
      setActiveRunId(runId);
      setGeneration(nextGeneration);
      setEvents([]);
      setLastResult(null);
    }
    const runEvents: HarnessEvent[] = [];
    const emit = (event: HarnessEvent) => {
      runEvents.push(event);
      if (runEvents.length > maxEvents) runEvents.splice(0, runEvents.length - maxEvents);
      if (!mountedRef.current || activeRef.current?.runId !== runId) return;
      setEvents((current) => [...current, event].slice(-maxEvents));
    };
    const context: AgentHarnessTaskContext = {
      runId,
      generation: nextGeneration,
      signal: controller.signal,
      isCurrent: () => activeRef.current?.runId === runId && activeRef.current.generation === nextGeneration,
      emit
    };
    let result: T;
    try {
      result = await task(context);
    } catch (error) {
      const stillOwner = activeRef.current?.runId === runId && activeRef.current.generation === nextGeneration;
      if (stillOwner) {
        activeRef.current = null;
        if (mountedRef.current) {
          setActive(false);
          setActiveRunId(null);
        }
      }
      throw error;
    }
    const stillOwner = activeRef.current?.runId === runId && activeRef.current.generation === nextGeneration;
    if (stillOwner) {
      activeRef.current = null;
      if (mountedRef.current) {
        setActive(false);
        setActiveRunId(null);
      }
      onComplete?.(result, startedAt, runEvents);
    }
    return result;
  }, [maxEvents]);

  const start = useCallback(async (runArgs: Omit<AgentLoopArgs, "runId" | "generation" | "signal" | "isCurrent" | "emit">) => {
    const result = await startTask(async (context) => {
      try {
        return await runAgentLoop({
          ...runArgs,
          runId: context.runId,
          generation: context.generation,
          signal: context.signal,
          isCurrent: context.isCurrent,
          emit: context.emit
        });
      } catch (error) {
        // runAgentLoop is expected to return a terminal state, but preserve the
        // ownership invariant if a custom transport violates that contract.
        return {
          runId: context.runId,
          generation: context.generation,
          stepCount: 0,
          toolCallCount: 0,
          protocolRepairCount: 0,
          transcript: [],
          loadedResourcePaths: [],
          pendingObservation: false,
          terminal: true,
          stopReason: context.signal.aborted ? "aborted" : "transport_error",
          terminalMessage: errorMessage(error)
        } satisfies AgentLoopResult;
      }
    }, (completed, startedAt, runEvents) => {
      setLastResult(completed);
      onPersistRef.current?.(projectPersistedHarnessRun({ result: completed, startedAt, events: runEvents, maxEvents }));
    });
    return result;
  }, [maxEvents, startTask]);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => abort("Page lifecycle ended the active run.");
    globalThis.addEventListener?.("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      globalThis.removeEventListener?.("pagehide", onPageHide);
      activeRef.current?.controller.abort("Controller unmounted.");
      activeRef.current = null;
    };
  }, [abort]);

  return { active, activeRunId, generation, events, lastResult, start, startTask, abort };
}

// Keep the public import useful to callers that need to type a projected state
// without importing the React hook's implementation details.
export type { HarnessRunState };
