import type { JSONSchema7 } from "json-schema";

export type HarnessToolOutcome =
  | "success"
  | "rejected"
  | "failed_before_dispatch"
  | "failed"
  | "outcome_unknown";

export type HarnessToolCall = {
  callId: string;
  toolId: string;
  input: unknown;
  origin: "model" | "controller";
};

export type HarnessMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      action?: HarnessToolCall;
      protocolValid: boolean;
    }
  | {
      role: "tool";
      callId: string;
      toolId: string;
      outcome: HarnessToolOutcome;
      modelContent: string;
      errorCode?: string;
    }
  | {
      role: "runtime";
      kind: "protocol_error" | "context_notice";
      content: string;
    };

export type HarnessAssistantStep =
  | { type: "tool_call"; toolId: string; input: unknown; assistantText?: string }
  | { type: "final"; answer: string };

export type HarnessTransportResult =
  | { status: "step"; step: HarnessAssistantStep; candidateId: string }
  | { status: "protocol_error"; rawPreview: string; candidateId: string; message?: string }
  | { status: "context_error"; code: ContextProjectionFailure["code"]; candidateId: string; message: string }
  | {
      status: "transport_error";
      kind: "network" | "http" | "rate_limit" | "auth" | "empty" | "provider" | "response_limit";
      retryable: boolean;
      message: string;
    }
  | { status: "aborted"; message: string };

export type HarnessTransportFailureKind = Extract<HarnessTransportResult, { status: "transport_error" }>["kind"] | "context";

export type HarnessStopReason =
  | "final"
  | "aborted"
  | "deadline"
  | "step_limit"
  | "stalled"
  | "protocol_error"
  | "transport_error"
  | "unsupported_transport"
  | "context_limit"
  | "response_limit"
  | "tool_unavailable"
  | "effect_unknown";

export type HarnessToolIntent = "observe" | "mutate" | "control" | "context";
export type HarnessToolIdempotency = "idempotent" | "non_idempotent" | "unknown";
export type HarnessToolCancellation = "terminable" | "cooperative" | "none";
export type HarnessToolExecutionKind = "internal" | "worker" | "trusted_local" | "mcp" | "legacy_inline";

export type HarnessToolDefinition = {
  id: string;
  description: string;
  inputSchema: JSONSchema7;
  intent: HarnessToolIntent;
  idempotency: HarnessToolIdempotency;
  cancellation: HarnessToolCancellation;
  requireConfirmation: boolean;
  executionKind: HarnessToolExecutionKind;
};

export type HarnessToolResult = {
  outcome: HarnessToolOutcome;
  modelContent: string;
  displaySummary: string;
  errorCode?: string;
  effectDispatched?: boolean;
  observationConfirmed?: boolean;
  rawDetails?: unknown;
};

export type ContextBudget = {
  maxTotalChars: number;
  maxCatalogChars: number;
  maxSkillInstructionChars: number;
  maxResourceChars: number;
  maxSingleToolResultChars: number;
  maxModelResponseChars: number;
};

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTotalChars: 48_000,
  maxCatalogChars: 16_000,
  maxSkillInstructionChars: 16_000,
  maxResourceChars: 16_000,
  maxSingleToolResultChars: 8_000,
  maxModelResponseChars: 64_000
};

export type HarnessContextResource = {
  path: string;
  content: string;
};

export type HarnessModelContext = {
  system: string;
  messages: HarnessMessage[];
  tools: HarnessToolDefinition[];
  chars: number;
};

export type ContextProjectionFailure = {
  code: "context_budget_exceeded" | "tool_catalog_too_large" | "skill_instructions_too_large";
  message: string;
};

export type HarnessEvent =
  | { type: "run_start"; runId: string; generation: number }
  | { type: "model_step_start"; step: number }
  | { type: "model_step_end"; step: number; status: HarnessTransportResult["status"] }
  | {
      type: "transport_failover";
      message: string;
      fromCandidateId?: string;
      toCandidateId?: string;
      failureKind?: HarnessTransportFailureKind;
    }
  | { type: "tool_preflight"; call: HarnessToolCall; ok: boolean; errorCode?: string }
  | { type: "tool_dispatch"; call: HarnessToolCall }
  | { type: "tool_result"; call: HarnessToolCall; result: HarnessToolResult }
  | { type: "skill_loaded"; skillId: string }
  | { type: "resource_loaded"; path: string; chars: number }
  | { type: "context_projected"; chars: number; messageCount: number; toolCount: number; candidateId?: string }
  | { type: "protocol_repair"; attempt: number; message: string }
  | { type: "late_result_dropped"; kind: "model" | "tool" }
  | { type: "run_end"; reason: HarnessStopReason; message?: string };

export type HarnessEventSink = (event: HarnessEvent) => void;

export type HarnessTransport = {
  runStep: (
    context: HarnessModelContext,
    signal: AbortSignal,
    projection?: {
      transcript: HarnessMessage[];
      system?: string;
      tools: HarnessToolDefinition[];
      isCurrent?: () => boolean;
    }
  ) => Promise<HarnessTransportResult>;
};

export type HarnessToolContext = {
  signal: AbortSignal;
  runId: string;
  generation: number;
  definition: HarnessToolDefinition;
  onDispatch?: () => void;
};

export type ToolEffectRunner = {
  execute: (call: HarnessToolCall, context: HarnessToolContext) => Promise<HarnessToolResult>;
};

export type HarnessRunState = {
  runId: string;
  generation: number;
  stepCount: number;
  toolCallCount: number;
  protocolRepairCount: number;
  transcript: HarnessMessage[];
  loadedSkillId?: string;
  loadedResourcePaths: string[];
  pendingObservation: boolean;
  terminal: boolean;
  stopReason?: HarnessStopReason;
  finalAnswer?: string;
  terminalMessage?: string;
};

export type AgentLoopLimits = {
  maxModelSteps: number;
  maxToolCalls: number;
  maxProtocolRepairs: number;
};

export const DEFAULT_AGENT_LOOP_LIMITS: AgentLoopLimits = {
  maxModelSteps: 12,
  maxToolCalls: 10,
  maxProtocolRepairs: 1
};

export type HarnessClock = () => number;

export type AgentLoopArgs = {
  runId: string;
  generation: number;
  userInput: string;
  initialTranscript?: HarnessMessage[];
  system?: string;
  tools: HarnessToolDefinition[];
  transport: HarnessTransport;
  effectRunner: ToolEffectRunner;
  projectContext: (args: {
    transcript: HarnessMessage[];
    system?: string;
    tools: HarnessToolDefinition[];
  }) => HarnessModelContext | ContextProjectionFailure;
  getTools?: (state: HarnessRunState) => HarnessToolDefinition[];
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  now?: HarnessClock;
  expiresAt?: number;
  limits?: Partial<AgentLoopLimits>;
  initialToolCalls?: HarnessToolCall[];
  nextCallId?: () => string;
  emit?: HarnessEventSink;
};

export type AgentLoopResult = HarnessRunState;
