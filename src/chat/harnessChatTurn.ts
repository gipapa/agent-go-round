import type { ChatMessage, ChatTraceEntry, AgentConfig, BuiltInToolConfig, DocItem, McpServerConfig, McpTool } from "../types";
import type { AgentAdapter, RetryConfig } from "../adapters/base";
import type { ExecutionDeadline } from "../utils/deadline";
import type { ContextBudget, HarnessEvent } from "../runtime/harness/types";
import type { HarnessSkillPackage } from "../runtime/harness/skillTools";
import type { ToolDashboardHelpers } from "../utils/toolDashboard";
import { projectPersistedHarnessRun } from "./harnessProjection";
import { runHarnessOneToOne } from "../orchestrators/harnessOneToOne";
import { errorMessage } from "../utils/errors";
import type { ToolCallingCapability } from "../runtime/harness/capability";

export type HarnessChatTurnResult = {
  requestId: string;
  status: "success" | "degraded" | "failure";
  displayContent: string;
};

const MAX_RUN_EVENTS = 100;

function summarizeToolInput(input: unknown) {
  try {
    if (input === null) return "null";
    if (Array.isArray(input)) return `array(items=${Math.min(input.length, 100)})`;
    if (typeof input === "string") return `string(chars=${input.length})`;
    if (typeof input === "number" || typeof input === "boolean") return typeof input;
    if (typeof input === "object") return `object(keys=${Object.keys(input as Record<string, unknown>).length})`;
    return typeof input;
  } catch {
    return "unserializable";
  }
}

function formatToolRef(toolId: string, toolDisplayNames: ReadonlyMap<string, string>) {
  const displayName = toolDisplayNames.get(toolId)?.trim();
  return displayName ? `${toolId} [${displayName}]` : toolId;
}

function summarizeToolResult(
  event: Extract<HarnessEvent, { type: "tool_result" }>,
  durationMs: number,
  toolDisplayNames: ReadonlyMap<string, string>
) {
  const { result } = event;
  const certainty = result.outcome === "outcome_unknown"
    ? "unknown"
    : result.effectDispatched === true
      ? "dispatched"
      : "not_dispatched";
  const observation = result.observationConfirmed === false ? "; observation=unconfirmed" : "";
  const error = result.errorCode ? `; error=${result.errorCode}` : "";
  return `${formatToolRef(event.call.toolId, toolDisplayNames)}: ${result.outcome}; certainty=${certainty}; duration_ms=${durationMs}; model_chars=${result.modelContent.length}; summary_chars=${result.displaySummary.length}${observation}${error}`;
}

function eventTrace(
  event: HarnessEvent,
  toolDispatchTimes: Map<string, number>,
  toolDisplayNames: ReadonlyMap<string, string>
): ChatTraceEntry | null {
  if (event.type === "run_start") return { label: "Run start", content: `generation=${event.generation}` };
  if (event.type === "model_step_start") return { label: "Model step", content: `step=${event.step}` };
  if (event.type === "model_step_end") return { label: "Model step result", content: `step=${event.step}; status=${event.status}` };
  if (event.type === "context_projected") return { label: "Context projected", content: `${event.candidateId ? `candidate=${event.candidateId}; ` : ""}chars=${event.chars}; messages=${event.messageCount}; tools=${event.toolCount}` };
  if (event.type === "transport_failover") {
    return {
      label: "Transport failover",
      content: [
        event.fromCandidateId ? `from=${event.fromCandidateId}` : "",
        event.toCandidateId ? `to=${event.toCandidateId}` : "",
        `reason=${event.failureKind ?? "provider"}`
      ].filter(Boolean).join("; ")
    };
  }
  if (event.type === "skill_loaded") return { label: "Skill loaded", content: event.skillId };
  if (event.type === "resource_loaded") return { label: "Skill resource", content: `${event.path} (${event.chars} chars)` };
  if (event.type === "tool_preflight") return { label: "Tool preflight", content: `${formatToolRef(event.call.toolId, toolDisplayNames)}: input=${summarizeToolInput(event.call.input)}; ${event.ok ? "allowed" : event.errorCode ?? "rejected"}` };
  if (event.type === "tool_dispatch") return { label: "Tool dispatch", content: `${formatToolRef(event.call.toolId, toolDisplayNames)} (${event.call.callId})` };
  if (event.type === "tool_result") {
    return {
      label: "Tool result",
      // Persist only shape/size and stable outcome metadata. Tool summaries
      // may contain untrusted MCP or built-in output and never enter history.
      content: summarizeToolResult(event, Math.max(0, Date.now() - (toolDispatchTimes.get(event.call.callId) ?? Date.now())), toolDisplayNames)
    };
  }
  if (event.type === "protocol_repair") return { label: "Protocol repair", content: "repair requested" };
  if (event.type === "late_result_dropped") return { label: "Late result", content: `${event.kind} result dropped` };
  if (event.type === "run_end") return { label: "Run end", content: event.reason };
  return null;
}

function statusForEvent(event: HarnessEvent) {
  if (event.type === "skill_loaded") return `已載入 skill「${event.skillId}」`;
  if (event.type === "resource_loaded") return `已讀取 skill resource「${event.path}」`;
  if (event.type === "tool_dispatch") return `正在執行工具「${event.call.toolId}」…`;
  if (event.type === "tool_result") return `工具「${event.call.toolId}」已回傳結果`;
  if (event.type === "model_step_start") return `正在進行第 ${event.step} 次模型步驟…`;
  return undefined;
}

export async function runHarnessChatTurn(args: {
  requestId: string;
  runId: string;
  generation: number;
  assistantMessageId: string;
  userInput: string;
  history?: ChatMessage[];
  system?: string;
  agent: AgentConfig;
  adapter: AgentAdapter;
  transportCandidates?: Array<{ id: string; agent: AgentConfig; adapter: AgentAdapter; capability?: ToolCallingCapability; retry?: RetryConfig; contextBudget?: Partial<ContextBudget> }>;
  docs: DocItem[];
  skills: HarnessSkillPackage[];
  explicitSkillId?: string;
  builtInTools: BuiltInToolConfig[];
  mcpServers: McpServerConfig[];
  mcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  mcpClientManager: import("../mcp/clientManager").McpClientManager;
  deadline?: ExecutionDeadline;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  confirm?: (message: string, signal: AbortSignal) => Promise<boolean>;
  getUserProfilePayload?: () => { name: string; description: string; hasAvatar: boolean };
  ui?: {
    dashboard?: ToolDashboardHelpers;
  };
  onTransportCandidateSuccess?: (candidateId: string) => void;
  onTransportCandidateFailure?: (candidateId: string, message: string) => void;
  emit?: (event: HarnessEvent) => void;
  loadSkillPackages?: () => Promise<HarnessSkillPackage[]>;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
}): Promise<HarnessChatTurnResult> {
  const trace: ChatTraceEntry[] = [];
  const runEvents: HarnessEvent[] = [];
  const toolDispatchTimes = new Map<string, number>();
  const toolDisplayNames = new Map<string, string>([
    ...args.builtInTools.map((tool) => [`builtin:${tool.id}`, tool.displayLabel?.trim() || tool.name] as const),
    ...args.mcpTools.flatMap(({ server, tools }) => tools.map((tool) => [`mcp:${server.id}:${tool.name}`, tool.name] as const))
  ]);
  const startedAt = Date.now();
  const ownsRun = () => args.isCurrent?.() !== false;
  const deadlineExpired = () => args.deadline !== undefined && Date.now() >= args.deadline.expiresAt;
  const interruption = () => deadlineExpired()
    ? {
        status: "failure" as const,
        content: "【執行失敗】\nPi loop harness 在模型請求開始前超過執行期限。",
        reason: "deadline" as const
      }
    : {
        status: "degraded" as const,
        content: "【執行中斷】\nPi loop harness 在模型請求開始前被中止。",
        reason: "aborted" as const
  };
  const onEvent = (event: HarnessEvent) => {
    runEvents.push(event);
    if (runEvents.length > MAX_RUN_EVENTS) runEvents.splice(0, runEvents.length - MAX_RUN_EVENTS);
    try {
      args.emit?.(event);
    } catch {
      // A UI/controller observer cannot change the harness terminal outcome.
    }
    if (event.type === "tool_dispatch") toolDispatchTimes.set(event.call.callId, Date.now());
    const nextTrace = eventTrace(event, toolDispatchTimes, toolDisplayNames);
    if (event.type === "tool_result") toolDispatchTimes.delete(event.call.callId);
    if (nextTrace) {
      trace.push({ label: nextTrace.label.slice(0, 160), content: nextTrace.content.slice(0, 2_000) });
      if (trace.length > 80) trace.splice(0, trace.length - 80);
    }
    const statusText = statusForEvent(event);
    if (statusText && ownsRun()) args.patchMessage(args.assistantMessageId, { statusText, isStreaming: true });
  };
  const ensureTerminalEvents = (reason: Extract<HarnessEvent, { type: "run_end" }>["reason"], message?: string) => {
    if (!runEvents.some((event) => event.type === "run_start")) {
      onEvent({ type: "run_start", runId: args.runId, generation: args.generation });
    }
    if (!runEvents.some((event) => event.type === "run_end")) {
      onEvent({ type: "run_end", reason, message });
    }
  };
  const projectSetupFailure = (reason: Extract<HarnessEvent, { type: "run_end" }>["reason"]) =>
    projectPersistedHarnessRun({
      result: {
        runId: args.runId,
        generation: args.generation,
        stepCount: 0,
        toolCallCount: 0,
        protocolRepairCount: 0,
        transcript: [],
        loadedResourcePaths: [],
        pendingObservation: false,
        terminal: true,
        stopReason: reason
      },
      startedAt,
      events: runEvents
    });
  if (args.signal?.aborted || !ownsRun()) return { requestId: args.requestId, status: "degraded", displayContent: "" };
  args.patchMessage(args.assistantMessageId, { statusText: "正在啟動 Pi loop harness…", isStreaming: true, skillTrace: undefined, harnessRun: undefined });
  let result;
  try {
    const skills = args.loadSkillPackages ? await args.loadSkillPackages() : args.skills;
    if (args.signal?.aborted || !ownsRun()) {
      const stopped = interruption();
      const content = stopped.reason === "deadline"
        ? "【執行失敗】\nPi loop harness 在載入 skill 資源後超過執行期限。"
        : "【執行中斷】\nPi loop harness 在載入 skill 資源後被中止。";
      if (ownsRun()) {
        ensureTerminalEvents(stopped.reason);
        args.patchMessage(args.assistantMessageId, {
          content,
          statusText: undefined,
          isStreaming: false,
          hideWhileStreaming: false,
          skillTrace: trace.length ? trace : undefined,
          harnessRun: projectSetupFailure(stopped.reason)
        });
      }
      return { requestId: args.requestId, status: stopped.status, displayContent: ownsRun() ? content : "" };
    }
    result = await runHarnessOneToOne({
      agent: args.agent,
      adapter: args.adapter,
      transportCandidates: args.transportCandidates,
      input: args.userInput,
      history: args.history,
      system: args.system,
      docs: args.docs,
      skills,
      explicitSkillId: args.explicitSkillId,
      availableBuiltinTools: args.builtInTools,
      availableMcpServers: args.mcpServers,
      availableMcpTools: args.mcpTools,
      mcpClientManager: args.mcpClientManager,
      runId: args.runId,
      generation: args.generation,
      deadline: args.deadline,
      signal: args.signal,
      isCurrent: args.isCurrent,
      confirm: args.confirm,
      getUserProfilePayload: args.getUserProfilePayload,
      ui: args.ui,
      emit: onEvent,
      onTransportCandidateSuccess: args.onTransportCandidateSuccess,
      onTransportCandidateFailure: args.onTransportCandidateFailure
    });
  } catch (error) {
    const aborted = args.signal?.aborted === true || args.deadline?.signal.aborted === true;
    if (aborted) {
      const stopped = interruption();
      const content = stopped.content;
      if (ownsRun()) {
        ensureTerminalEvents(stopped.reason);
        args.patchMessage(args.assistantMessageId, {
          content,
          statusText: undefined,
          isStreaming: false,
          hideWhileStreaming: false,
          skillTrace: trace.length ? trace : undefined,
          harnessRun: projectSetupFailure(stopped.reason)
        });
      }
      return { requestId: args.requestId, status: stopped.status, displayContent: content };
    }
    const message = errorMessage(error);
    const content = `【執行失敗】\nPi loop harness 無法啟動：${message}`;
    if (ownsRun()) {
      ensureTerminalEvents("transport_error", message);
      args.patchMessage(args.assistantMessageId, {
        content,
        statusText: undefined,
        isStreaming: false,
        hideWhileStreaming: false,
        skillTrace: trace.length ? trace : undefined,
        harnessRun: projectSetupFailure("transport_error")
      });
    }
    return { requestId: args.requestId, status: "failure", displayContent: content };
  }
  const content = result.stopReason === "final"
    ? result.finalAnswer ?? ""
    : `【執行失敗】\nPi loop harness 已停止：${result.stopReason ?? "unknown"}${result.terminalMessage ? `\n\n${result.terminalMessage}` : ""}`;
  const status = result.stopReason === "final" ? "success" : result.stopReason === "aborted" ? "degraded" : "failure";
  const harnessRun = projectPersistedHarnessRun({ result, startedAt, events: runEvents });
  if (ownsRun()) {
    args.patchMessage(args.assistantMessageId, {
      content,
      statusText: undefined,
      isStreaming: false,
      hideWhileStreaming: false,
      skillTrace: trace.length ? trace : undefined,
      harnessRun
    });
  }
  return { requestId: args.requestId, status, displayContent: content };
}
