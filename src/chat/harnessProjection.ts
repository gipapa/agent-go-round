import type { HarnessRunProjection } from "../types";
import type { AgentLoopResult, HarnessEvent } from "../runtime/harness/types";

export type PersistedHarnessProjection = HarnessRunProjection;

const MAX_ACTIVITY_MESSAGE_CHARS = 256;
const MAX_ACTIVITY_ENTRIES = 100;
const MAX_PERSISTED_ID_CHARS = 200;
const MAX_TERMINAL_REASON_CHARS = 160;

function boundedActivityMessage(value: unknown, maxChars = MAX_ACTIVITY_MESSAGE_CHARS) {
  let text: string;
  try {
    text = String(value ?? "");
  } catch {
    text = "[unserializable]";
  }
  return text.slice(0, maxChars);
}

function boundedCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function projectPersistedHarnessRun(args: {
  result: AgentLoopResult;
  startedAt: number;
  events: HarnessEvent[];
  maxEvents?: number;
}): PersistedHarnessProjection {
  const maxEvents = Number.isFinite(args.maxEvents)
    ? Math.min(MAX_ACTIVITY_ENTRIES, Math.max(1, Math.floor(args.maxEvents as number)))
    : MAX_ACTIVITY_ENTRIES;
  const activity = args.events
    .slice(-maxEvents)
    .map((event) => {
      if (event.type === "run_start") return { type: event.type, message: boundedActivityMessage(`generation=${event.generation}`) };
      if (event.type === "model_step_start") return { type: event.type, message: boundedActivityMessage(`step=${event.step}`) };
      if (event.type === "model_step_end") return { type: event.type, message: boundedActivityMessage(`step=${event.step};status=${event.status}`) };
      if (event.type === "context_projected") return { type: event.type, message: boundedActivityMessage(`${event.candidateId ? `candidate=${event.candidateId};` : ""}chars=${event.chars};messages=${event.messageCount};tools=${event.toolCount}`) };
      if (event.type === "run_end") return { type: event.type, message: boundedActivityMessage(event.reason) };
      if (event.type === "late_result_dropped") return { type: event.type, message: boundedActivityMessage(event.kind) };
      if (event.type === "protocol_repair") return { type: event.type, message: "repair_requested" };
      if (event.type === "transport_failover") return { type: event.type, message: "candidate_failover" };
      if (event.type === "resource_loaded") return { type: event.type, message: boundedActivityMessage(event.path) };
      if (event.type === "skill_loaded") return { type: event.type, message: boundedActivityMessage(event.skillId) };
      if (event.type === "tool_preflight") return { type: event.type, message: boundedActivityMessage(event.errorCode ?? (event.ok ? "ok" : "rejected")) };
      if (event.type === "tool_dispatch") return { type: event.type, message: boundedActivityMessage(event.call.toolId) };
      if (event.type === "tool_result") return { type: event.type, message: boundedActivityMessage(event.result.errorCode ?? event.result.outcome) };
      return unreachableEvent(event);
    });
  return {
    runId: boundedActivityMessage(args.result.runId, MAX_PERSISTED_ID_CHARS),
    generation: boundedCount(args.result.generation),
    skillId: args.result.loadedSkillId ? boundedActivityMessage(args.result.loadedSkillId) : (() => {
      const skillId = [...args.events].reverse().find((event): event is Extract<HarnessEvent, { type: "skill_loaded" }> => event.type === "skill_loaded")?.skillId;
      return skillId ? boundedActivityMessage(skillId) : undefined;
    })(),
    stepCount: boundedCount(args.result.stepCount),
    toolCallCount: boundedCount(args.result.toolCallCount),
    durationMs: Number.isFinite(args.startedAt) ? Math.max(0, Date.now() - args.startedAt) : 0,
    terminalReason: boundedActivityMessage(args.result.stopReason ?? "aborted", MAX_TERMINAL_REASON_CHARS),
    activity
  };
}

function unreachableEvent(event: never): never {
  throw new Error(`Unhandled harness event: ${String(event)}`);
}
