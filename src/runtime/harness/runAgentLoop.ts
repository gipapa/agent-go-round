import {
  AgentLoopArgs,
  AgentLoopResult,
  DEFAULT_AGENT_LOOP_LIMITS,
  HarnessEvent,
  HarnessMessage,
  HarnessStopReason,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolResult
} from "./types";
import { createHarnessToolRegistry, MAX_TOOL_ID_CHARS, MAX_TOOL_INPUT_CHARS } from "./toolRegistry";

function boundedText(value: unknown, maxChars: number) {
  let text: string;
  try {
    text = String(value ?? "");
  } catch {
    text = "[unserializable]";
  }
  if (text.length <= maxChars) return text;
  const marker = `\n[… truncated; original_chars=${text.length}]`;
  return maxChars <= marker.length ? marker.slice(0, maxChars) : `${text.slice(0, maxChars - marker.length)}${marker}`;
}

function textDigest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function boundedToolText(value: unknown, maxChars: number) {
  let text: string;
  try {
    text = String(value ?? "");
  } catch {
    text = "[unserializable tool result]";
  }
  if (text.length <= maxChars) return text;
  const marker = `\n[… tool result truncated; original_chars=${text.length}; digest=${textDigest(text)}]`;
  return maxChars <= marker.length ? marker.slice(0, maxChars) : `${text.slice(0, maxChars - marker.length)}${marker}`;
}

const TOOL_OUTCOMES = new Set<HarnessToolResult["outcome"]>([
  "success",
  "rejected",
  "failed_before_dispatch",
  "failed",
  "outcome_unknown"
]);

function normalizeLimit(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value as number))) : fallback;
}

function invalidToolResult(message: string): HarnessToolResult {
  return {
    outcome: "outcome_unknown",
    modelContent: boundedToolText(message, 8_000),
    displaySummary: boundedText(message, 2_000),
    errorCode: "invalid_tool_result",
    effectDispatched: true
  };
}

function normalizeToolResult(input: unknown): HarnessToolResult {
  try {
    if (!input || typeof input !== "object") return invalidToolResult("Tool runner returned an invalid result.");
    const result = input as Partial<HarnessToolResult>;
    if (typeof result.outcome !== "string" || !TOOL_OUTCOMES.has(result.outcome as HarnessToolResult["outcome"])) {
      return invalidToolResult("Tool runner returned an unknown outcome.");
    }
    const modelContent = typeof result.modelContent === "string" ? result.modelContent : String(result.modelContent ?? "");
    const displaySummary = typeof result.displaySummary === "string" ? result.displaySummary : modelContent;
    const inferredDispatch = result.outcome !== "rejected" && result.outcome !== "failed_before_dispatch";
    return {
      outcome: result.outcome,
      modelContent: boundedToolText(modelContent, 8_000),
      displaySummary: boundedText(displaySummary, 2_000),
      errorCode: typeof result.errorCode === "string" && result.errorCode ? boundedText(result.errorCode, 160) : undefined,
      effectDispatched: typeof result.effectDispatched === "boolean" ? result.effectDispatched : inferredDispatch,
      observationConfirmed: typeof result.observationConfirmed === "boolean" ? result.observationConfirmed : undefined
    };
  } catch {
    return invalidToolResult("Tool runner returned an unserializable result.");
  }
}

function hasExplicitDispatchStatus(input: unknown): input is { effectDispatched: boolean } {
  return !!input && typeof input === "object" && typeof (input as { effectDispatched?: unknown }).effectDispatched === "boolean";
}

function errorText(error: unknown) {
  try {
    return error instanceof Error ? error.message : String(error ?? "Unknown error");
  } catch {
    return "Unknown error";
  }
}

function inputSignature(input: unknown) {
  const active = new WeakSet<object>();
  const canonicalize = (value: unknown, depth: number): unknown => {
    if (depth > 12) return "[nested value truncated]";
    if (value === null || typeof value !== "object") {
      if (typeof value === "bigint") return `${value}n`;
      if (typeof value === "undefined") return "[undefined]";
      return value;
    }
    if (active.has(value)) return "[circular]";
    active.add(value);
    try {
      if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, depth + 1));
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = canonicalize((value as Record<string, unknown>)[key], depth + 1);
          return result;
        }, {});
    } finally {
      active.delete(value);
    }
  };
  try {
    return JSON.stringify(canonicalize(input, 0)) ?? String(input);
  } catch {
    return "[unserializable-input]";
  }
}

const MAX_EVENT_INPUT_CHARS = 4_000;
const MAX_CANONICAL_TRANSCRIPT_CHARS = 1_000_000;
const MAX_HARNESS_EVENTS = 512;

function eventCall(call: HarnessToolCall): HarnessToolCall {
  let serialized: string;
  try {
    const encoded = JSON.stringify(call.input);
    serialized = typeof encoded === "string" ? encoded : "[unserializable-input]";
  } catch {
    serialized = "[unserializable-input]";
  }
  return serialized.length <= MAX_EVENT_INPUT_CHARS
    ? call
    : { ...call, input: boundedText(serialized, MAX_EVENT_INPUT_CHARS) };
}

function canonicalToolCall(call: HarnessToolCall): HarnessToolCall {
  const callId = boundedText(call.callId, MAX_TOOL_ID_CHARS);
  const toolId = boundedText(call.toolId, MAX_TOOL_ID_CHARS);
  let serialized: string;
  try {
    const encoded = JSON.stringify(call.input);
    if (typeof encoded !== "string") {
      return {
        ...call,
        callId,
        toolId,
        input: "[unserializable tool input]"
      };
    }
    serialized = encoded;
  } catch {
    return {
      ...call,
      callId,
      toolId,
      input: "[unserializable tool input]"
    };
  }
  const input = serialized.length <= MAX_TOOL_INPUT_CHARS ? call.input : boundedText(serialized, MAX_TOOL_INPUT_CHARS);
  if (callId === call.callId && toolId === call.toolId && input === call.input) return call;
  return {
    ...call,
    callId,
    toolId,
    input
  };
}

function confirmationSignature(call: Pick<HarnessToolCall, "toolId" | "input">) {
  return `${call.toolId}|${inputSignature(call.input)}`;
}

function isDefinitiveFailure(result: HarnessToolResult) {
  return result.outcome === "rejected" || result.outcome === "failed_before_dispatch" || result.outcome === "failed";
}

function wasDispatched(result: HarnessToolResult) {
  if (typeof result.effectDispatched === "boolean") return result.effectDispatched;
  return result.outcome !== "rejected" && result.outcome !== "failed_before_dispatch";
}

function normalizeCall(call: HarnessToolCall): HarnessToolCall {
  return {
    ...call,
    callId: boundedText(call.callId, MAX_TOOL_ID_CHARS),
    toolId: boundedText(call.toolId, MAX_TOOL_ID_CHARS),
    origin: call.origin === "controller" ? "controller" : "model"
  };
}

function canonicalMessage(message: HarnessMessage): HarnessMessage {
  if (message.role === "user") return { role: "user", content: boundedText(message.content, 64_000) };
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: boundedText(message.content, 64_000),
      protocolValid: message.protocolValid === true,
      ...(message.action ? { action: canonicalToolCall(normalizeCall(message.action)) } : {})
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      callId: boundedText(message.callId, MAX_TOOL_ID_CHARS),
      toolId: boundedText(message.toolId, MAX_TOOL_ID_CHARS),
      outcome: TOOL_OUTCOMES.has(message.outcome) ? message.outcome : "outcome_unknown",
      modelContent: boundedToolText(message.modelContent, 8_000),
      errorCode: typeof message.errorCode === "string" ? boundedText(message.errorCode, 160) : undefined
    };
  }
  return {
    role: "runtime",
    kind: message.kind === "protocol_error" ? "protocol_error" : "context_notice",
    content: boundedText(message.content, 4_000)
  };
}

function messageChars(message: HarnessMessage) {
  try {
    const serialized = JSON.stringify(message);
    return typeof serialized === "string" ? serialized.length : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function canonicalInitialTranscript(messages: HarnessMessage[], maxChars = MAX_CANONICAL_TRANSCRIPT_CHARS) {
  const selected: HarnessMessage[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0;) {
    let message: HarnessMessage | undefined;
    try {
      message = canonicalMessage(messages[index]);
    } catch {
      message = undefined;
    }
    if (!message) {
      index -= 1;
      continue;
    }
    let group: HarnessMessage[] = [message];
    let groupStart = index;
    if (message.role === "tool") {
      let assistant: HarnessMessage | undefined;
      try {
        assistant = index > 0 ? canonicalMessage(messages[index - 1]) : undefined;
      } catch {
        assistant = undefined;
      }
      if (
        assistant?.role === "assistant" &&
        assistant.action?.callId === message.callId &&
        assistant.action.toolId === message.toolId
      ) {
        group = [assistant, message];
        groupStart = index - 1;
      } else {
        // An imported tool result without its paired assistant action is not
        // part of the canonical transcript.
        index -= 1;
        continue;
      }
    }
    const size = group.reduce((sum, entry) => sum + messageChars(entry), 0);
    if (chars + size <= maxChars) {
      selected.unshift(...group);
      chars += size;
    }
    index = groupStart - 1;
  }
  return selected;
}

function safeEmit(emit: AgentLoopArgs["emit"], event: HarnessEvent) {
  try {
    emit?.(event);
  } catch {
    // An observability subscriber is never allowed to change run semantics.
  }
}

function boundedEvent(event: HarnessEvent): HarnessEvent {
  switch (event.type) {
    case "run_start":
      return {
        ...event,
        runId: boundedText(event.runId, MAX_TOOL_ID_CHARS),
        generation: Number.isFinite(event.generation) ? Math.max(0, Math.floor(event.generation)) : 0
      };
    case "model_step_start":
      return { ...event, step: Number.isFinite(event.step) ? Math.max(0, Math.floor(event.step)) : 0 };
    case "model_step_end":
      return { ...event, step: Number.isFinite(event.step) ? Math.max(0, Math.floor(event.step)) : 0 };
    case "transport_failover":
    case "protocol_repair":
      return { ...event, message: boundedText(event.message, 2_000) };
    case "run_end":
      return { ...event, message: event.message === undefined ? undefined : boundedText(event.message, 4_000) };
    case "tool_preflight":
      return {
        ...event,
        call: eventCall(event.call),
        errorCode: event.errorCode === undefined ? undefined : boundedText(event.errorCode, 160)
      };
    case "tool_dispatch":
      return { ...event, call: eventCall(event.call) };
    case "tool_result":
      return { ...event, call: eventCall(event.call), result: normalizeToolResult(event.result) };
    case "skill_loaded":
      return { ...event, skillId: boundedText(event.skillId, MAX_TOOL_ID_CHARS) };
    case "resource_loaded":
      return { ...event, path: boundedText(event.path, 1_024) };
    case "context_projected":
      return {
        ...event,
        candidateId: event.candidateId === undefined ? undefined : boundedText(event.candidateId, MAX_TOOL_ID_CHARS),
        chars: Number.isFinite(event.chars) ? Math.max(0, Math.floor(event.chars)) : 0,
        messageCount: Number.isFinite(event.messageCount) ? Math.max(0, Math.floor(event.messageCount)) : 0,
        toolCount: Number.isFinite(event.toolCount) ? Math.max(0, Math.floor(event.toolCount)) : 0
      };
    default:
      return event;
  }
}

function toolResultMessage(call: HarnessToolCall, result: HarnessToolResult): HarnessMessage {
  return {
    role: "tool",
    callId: call.callId,
    toolId: call.toolId,
    outcome: result.outcome,
    modelContent: boundedToolText(result.modelContent, 8_000),
    errorCode: result.errorCode
  };
}

function stopReasonForTransport(result: Extract<Awaited<ReturnType<NonNullable<AgentLoopArgs["transport"]>["runStep"]>>, { status: "transport_error" | "aborted" }>) : HarnessStopReason {
  if (result.status === "aborted") return "aborted";
  if (result.kind === "response_limit") return "response_limit";
  return "transport_error";
}

export async function runAgentLoop(args: AgentLoopArgs): Promise<AgentLoopResult> {
  const limits = {
    maxModelSteps: normalizeLimit(args.limits?.maxModelSteps, DEFAULT_AGENT_LOOP_LIMITS.maxModelSteps, 1, DEFAULT_AGENT_LOOP_LIMITS.maxModelSteps),
    maxToolCalls: normalizeLimit(args.limits?.maxToolCalls, DEFAULT_AGENT_LOOP_LIMITS.maxToolCalls, 0, DEFAULT_AGENT_LOOP_LIMITS.maxToolCalls),
    maxProtocolRepairs: normalizeLimit(args.limits?.maxProtocolRepairs, DEFAULT_AGENT_LOOP_LIMITS.maxProtocolRepairs, 0, DEFAULT_AGENT_LOOP_LIMITS.maxProtocolRepairs)
  };
  const controller = new AbortController();
  const removeExternalAbort = args.signal
    ? (() => {
        const onAbort = () => {
          if (!controller.signal.aborted) controller.abort(args.signal?.reason);
        };
        if (args.signal.aborted) onAbort();
        else args.signal.addEventListener("abort", onAbort, { once: true });
        return () => args.signal?.removeEventListener("abort", onAbort);
      })()
    : () => undefined;
  const signal = controller.signal;
  const now = args.now ?? Date.now;
  const userMessage: HarnessMessage = { role: "user", content: boundedText(args.userInput, 64_000) };
  const transcript: HarnessMessage[] = [
    ...canonicalInitialTranscript(
      args.initialTranscript ?? [],
      Math.max(0, MAX_CANONICAL_TRANSCRIPT_CHARS - messageChars(userMessage))
    ),
    userMessage
  ];
  let transcriptChars = transcript.reduce((sum, message) => sum + messageChars(message), 0);
  const state: HarnessRunStateInternal = {
    runId: args.runId,
    generation: args.generation,
    stepCount: 0,
    toolCallCount: 0,
    protocolRepairCount: 0,
    transcript,
    loadedResourcePaths: [],
    pendingObservation: false,
    terminal: false,
    failureSignature: undefined,
    seenCallIds: new Set<string>()
  };
  let emittedEventCount = 0;
  const emit = (event: HarnessEvent) => {
    const safeEvent = boundedEvent(event);
    if (safeEvent.type === "skill_loaded") state.loadedSkillId = safeEvent.skillId;
    if (safeEvent.type === "resource_loaded" && !state.loadedResourcePaths.includes(safeEvent.path)) {
      state.loadedResourcePaths.push(safeEvent.path);
    }
    // Candidate failover and injected lifecycle callbacks are external to the
    // loop's fixed step/tool limits. Keep their observability bounded while
    // reserving the final slot for the terminal event.
    if (safeEvent.type !== "run_end" && emittedEventCount >= MAX_HARNESS_EVENTS - 1) return;
    if (safeEvent.type === "run_end" && emittedEventCount >= MAX_HARNESS_EVENTS) return;
    emittedEventCount += 1;
    safeEmit(args.emit, safeEvent);
  };
  const rejectedConfirmations = new Set<string>();
  const nextCallId = args.nextCallId ?? (() => `${args.runId}:call-${state.toolCallCount + 1}`);

  emit({ type: "run_start", runId: args.runId, generation: args.generation });

  const finish = (reason: HarnessStopReason, message?: string) => {
    if (state.terminal) return;
    state.terminal = true;
    state.stopReason = reason;
    const boundedMessage = message === undefined ? undefined : boundedText(message, 4_000);
    state.terminalMessage = boundedMessage;
    emit({ type: "run_end", reason, message: boundedMessage });
  };

  const appendTranscript = (message: HarnessMessage) => {
    try {
      const canonical = canonicalMessage(message);
      const chars = messageChars(canonical);
      if (chars === Number.MAX_SAFE_INTEGER || transcriptChars + chars > MAX_CANONICAL_TRANSCRIPT_CHARS) return false;
      transcript.push(canonical);
      transcriptChars += chars;
      return true;
    } catch {
      return false;
    }
  };

  const appendOrFinish = (message: HarnessMessage) => {
    if (appendTranscript(message)) return true;
    finish("context_limit", `Canonical transcript exceeds ${MAX_CANONICAL_TRANSCRIPT_CHARS} chars.`);
    return false;
  };

  const ownershipIsCurrent = () => args.isCurrent?.() !== false;
  const deadlineReached = () => args.expiresAt !== undefined && Number.isFinite(args.expiresAt) && now() >= args.expiresAt;
  const checkBoundary = () => {
    if (!ownershipIsCurrent()) {
      emit({ type: "late_result_dropped", kind: "model" });
      finish("aborted", "Run ownership is no longer current.");
      return false;
    }
    if (deadlineReached()) {
      finish("deadline", "Execution deadline expired.");
      return false;
    }
    if (signal.aborted) {
      finish("aborted", errorText(signal.reason || "Execution aborted."));
      return false;
    }
    return true;
  };

  const checkAfterAwait = (kind: "model" | "tool") => {
    if (!ownershipIsCurrent()) {
      emit({ type: "late_result_dropped", kind });
      finish("aborted", `Late ${kind} result dropped after run ownership changed.`);
      return false;
    }
    if (deadlineReached()) {
      emit({ type: "late_result_dropped", kind });
      finish("deadline", "Execution deadline expired.");
      return false;
    }
    if (signal.aborted) {
      emit({ type: "late_result_dropped", kind });
      finish("aborted", errorText(signal.reason || "Execution aborted."));
      return false;
    }
    return true;
  };

  const executeToolCall = async (call: HarnessToolCall, currentTools: HarnessToolDefinition[], assistantContent = "") => {
    const runtimeCall = normalizeCall(call);
    if (!checkBoundary()) return false;
    if (state.toolCallCount >= limits.maxToolCalls) {
      finish("step_limit", `Tool call limit reached (${limits.maxToolCalls}).`);
      return false;
    }
    if (state.seenCallIds.has(runtimeCall.callId)) {
      finish("stalled", `${runtimeCall.origin === "controller" ? "Runtime received" : "Runtime generated"} a duplicate callId: ${runtimeCall.callId}.`);
      return false;
    }
    state.seenCallIds.add(runtimeCall.callId);
    state.toolCallCount += 1;
    const transcriptCall = canonicalToolCall(runtimeCall);
    if (!appendOrFinish({ role: "assistant", content: assistantContent, action: transcriptCall, protocolValid: true })) return false;
    const registry = createHarnessToolRegistry(currentTools);
    const preflight = registry.preflight(runtimeCall);
    emit({ type: "tool_preflight", call: eventCall(transcriptCall), ok: preflight.ok, errorCode: preflight.ok ? undefined : preflight.errorCode });
    let dispatchNotified = false;
    const notifyDispatch = () => {
      if (dispatchNotified) return;
      dispatchNotified = true;
      emit({ type: "tool_dispatch", call: eventCall(transcriptCall) });
    };
    let result: HarnessToolResult;
    if (!preflight.ok) {
      result = {
        outcome: "failed_before_dispatch",
        errorCode: preflight.errorCode,
        modelContent: preflight.message,
        displaySummary: preflight.message,
        effectDispatched: false
      };
    } else if (preflight.definition.requireConfirmation && rejectedConfirmations.has(confirmationSignature(runtimeCall))) {
      result = {
        outcome: "rejected",
        errorCode: "confirmation_previously_rejected",
        modelContent: "The user already rejected this exact tool confirmation during this run.",
        displaySummary: "The same confirmation will not be requested again.",
        effectDispatched: false
      };
    } else if (state.pendingObservation && (preflight.definition.intent === "mutate" || preflight.definition.intent === "control")) {
      result = {
        outcome: "rejected",
        errorCode: "observation_required",
        modelContent: "A state-changing tool is blocked until an observation tool confirms the current state.",
        displaySummary: "Observation is required before another state-changing action.",
        effectDispatched: false
      };
    } else {
      let rawResult: unknown;
      try {
        rawResult = await args.effectRunner.execute(runtimeCall, {
          signal,
          runId: args.runId,
          generation: args.generation,
          definition: preflight.definition,
          onDispatch: notifyDispatch
        });
      } catch (error) {
        rawResult = {
          // A thrown exception does not identify where an injected runner
          // failed. Treat it conservatively as potentially dispatched unless
          // the runner returned an explicit before-dispatch result.
          outcome: "outcome_unknown",
          errorCode: "tool_runner_exception",
          modelContent: errorText(error),
          displaySummary: errorText(error),
          effectDispatched: true
        };
      }

      result = normalizeToolResult(rawResult);
      // An omitted status is normalized conservatively for ordinary loop
      // processing, but it cannot prove that a late promise crossed the
      // effect boundary. Only the callback or an explicit result status can
      // classify an already-aborted await as dispatched.
      const effectWasDispatched =
        dispatchNotified ||
        (hasExplicitDispatchStatus(rawResult) ? rawResult.effectDispatched : result.outcome === "outcome_unknown");
      if (preflight.ok && effectWasDispatched) notifyDispatch();

      if (!ownershipIsCurrent()) {
        emit({ type: "late_result_dropped", kind: "tool" });
        finish("aborted", "Late tool result dropped after run ownership changed.");
        return false;
      }
      if (deadlineReached()) {
        if (!effectWasDispatched) {
          emit({ type: "late_result_dropped", kind: "tool" });
          finish("deadline", "Execution deadline expired.");
          return false;
        }
        if (result.outcome !== "outcome_unknown") {
          emit({ type: "late_result_dropped", kind: "tool" });
          finish("effect_unknown", "A tool effect was dispatched before the deadline, but its final result arrived too late.");
          return false;
        }
        if (!appendOrFinish(toolResultMessage(transcriptCall, result))) return false;
        emit({ type: "tool_result", call: eventCall(transcriptCall), result });
        finish("effect_unknown", result.displaySummary);
        return false;
      }
      if (signal.aborted) {
        if (!effectWasDispatched) {
          emit({ type: "late_result_dropped", kind: "tool" });
          finish("aborted", errorText(signal.reason || "Execution aborted."));
          return false;
        }
        if (result.outcome !== "outcome_unknown") {
          emit({ type: "late_result_dropped", kind: "tool" });
          finish("effect_unknown", "A tool effect was dispatched before execution was aborted, but its final result arrived too late.");
          return false;
        }
        if (!appendOrFinish(toolResultMessage(transcriptCall, result))) return false;
        emit({ type: "tool_result", call: eventCall(transcriptCall), result });
        finish("effect_unknown", result.displaySummary);
        return false;
      }
    }
    result = normalizeToolResult(result);
    if (preflight.ok && wasDispatched(result)) notifyDispatch();
    if (preflight.ok && result.outcome === "rejected" && result.errorCode === "confirmation_rejected") {
      rejectedConfirmations.add(confirmationSignature(runtimeCall));
    }
    if (!appendOrFinish(toolResultMessage(transcriptCall, result))) return false;
    emit({ type: "tool_result", call: eventCall(transcriptCall), result });
    if (runtimeCall.origin === "controller" && result.outcome !== "success") {
      finish(result.outcome === "outcome_unknown" ? "effect_unknown" : "tool_unavailable", result.displaySummary);
      return false;
    }
    if (preflight.ok) {
      const dispatched = wasDispatched(result);
      if (result.outcome === "outcome_unknown") {
        // Unknown means the effect boundary may have been crossed even when a
        // buggy/incomplete runner omitted effectDispatched=false. Require an
        // observation before allowing any further state-changing action.
        state.pendingObservation = true;
      } else if (preflight.definition.intent === "observe" && result.outcome === "success") {
        state.pendingObservation = result.observationConfirmed === false;
      } else if ((preflight.definition.intent === "mutate" || preflight.definition.intent === "control") && dispatched) {
        state.pendingObservation = true;
      }
    }
    if (result.outcome === "outcome_unknown" && !currentTools.some((tool) => tool.intent === "observe")) {
      finish("effect_unknown", "Tool outcome is unknown and no observation tool is available.");
      return false;
    }
    if (isDefinitiveFailure(result)) {
      const signature = `${runtimeCall.toolId}|${inputSignature(runtimeCall.input)}|${result.errorCode ?? result.outcome}`;
      if (state.failureSignature === signature) {
        finish("stalled", `The same tool failure occurred twice: ${result.errorCode ?? result.outcome}.`);
        return false;
      }
      state.failureSignature = signature;
    } else {
      state.failureSignature = undefined;
    }
    return !state.terminal;
  };

  try {
    for (const call of args.initialToolCalls ?? []) {
      const currentTools = args.getTools?.(toPublicState(state)) ?? args.tools;
      if (!(await executeToolCall(call, currentTools))) break;
    }
    while (!state.terminal) {
      if (!checkBoundary()) break;
      if (state.stepCount >= limits.maxModelSteps) {
        finish("step_limit", `Model step limit reached (${limits.maxModelSteps}).`);
        break;
      }

      const currentTools = args.getTools?.(toPublicState(state)) ?? args.tools;
      let projected: ReturnType<AgentLoopArgs["projectContext"]>;
      try {
        projected = args.projectContext({ transcript: transcript.slice(), system: args.system, tools: currentTools });
      } catch (error) {
        finish("context_limit", errorText(error));
        break;
      }
      if (!("messages" in projected)) {
        appendOrFinish({ role: "runtime", kind: "context_notice", content: projected.message });
        finish("context_limit", projected.message);
        break;
      }
      emit({
        type: "context_projected",
        chars: projected.chars,
        messageCount: projected.messages.length,
        toolCount: projected.tools.length
      });

      state.stepCount += 1;
      emit({ type: "model_step_start", step: state.stepCount });
      let transportResult;
      try {
        transportResult = await args.transport.runStep(projected, signal, {
          transcript: transcript.slice(),
          system: args.system,
          tools: currentTools,
          isCurrent: ownershipIsCurrent
        });
      } catch (error) {
        if (!ownershipIsCurrent()) emit({ type: "late_result_dropped", kind: "model" });
        emit({ type: "model_step_end", step: state.stepCount, status: signal.aborted ? "aborted" : "transport_error" });
        finish(deadlineReached() ? "deadline" : signal.aborted ? "aborted" : "transport_error", errorText(error));
        break;
      }
      emit({ type: "model_step_end", step: state.stepCount, status: transportResult.status });
      if (!checkAfterAwait("model")) break;

      if (transportResult.status === "aborted" || transportResult.status === "transport_error") {
        finish(stopReasonForTransport(transportResult), transportResult.message);
        break;
      }
      if (transportResult.status === "context_error") {
        const message = boundedText(transportResult.message, 4_000);
        appendOrFinish({ role: "runtime", kind: "context_notice", content: message });
        finish("context_limit", message);
        break;
      }
      if (transportResult.status === "protocol_error") {
        const invalidText = boundedText(transportResult.rawPreview, 2_000);
        if (!appendOrFinish({ role: "assistant", content: invalidText, protocolValid: false })) break;
        if (!appendOrFinish({
          role: "runtime",
          kind: "protocol_error",
          content: boundedText(transportResult.message ?? "The model response did not satisfy the action protocol.", 4_000)
        })) break;
        if (state.protocolRepairCount >= limits.maxProtocolRepairs) {
          finish("protocol_error", boundedText(transportResult.message, 4_000));
        } else {
          state.protocolRepairCount += 1;
          emit({
            type: "protocol_repair",
            attempt: state.protocolRepairCount,
            message: boundedText(transportResult.message ?? "Protocol repair requested.", 2_000)
          });
        }
        continue;
      }

      const step = transportResult.step;
      if (step.type === "final") {
        if (state.pendingObservation) {
          finish("effect_unknown", "A dispatched state-changing effect still requires observation before a final answer.");
          break;
        }
        const answer = boundedText(step.answer, 64_000);
        if (!appendOrFinish({ role: "assistant", content: answer, protocolValid: true })) break;
        state.finalAnswer = answer;
        finish("final");
        break;
      }

      if (state.toolCallCount >= limits.maxToolCalls) {
        finish("step_limit", `Tool call limit reached (${limits.maxToolCalls}).`);
        break;
      }

      const call: HarnessToolCall = {
        callId: nextCallId(),
        toolId: step.toolId,
        input: step.input,
        origin: "model"
      };
      if (!(await executeToolCall(call, currentTools, boundedText(step.assistantText ?? "", 8_000)))) break;
    }
  } catch (error) {
    if (!state.terminal) {
      finish(deadlineReached() ? "deadline" : signal.aborted ? "aborted" : "transport_error", errorText(error));
    }
  } finally {
    removeExternalAbort();
  }

  if (!state.terminal) finish("aborted", "Run ended without a terminal reason.");
  return {
    runId: state.runId,
    generation: state.generation,
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
    protocolRepairCount: state.protocolRepairCount,
    transcript: state.transcript.slice(),
    loadedSkillId: state.loadedSkillId,
    loadedResourcePaths: state.loadedResourcePaths.slice(),
    pendingObservation: state.pendingObservation,
    terminal: state.terminal,
    stopReason: state.stopReason,
    finalAnswer: state.finalAnswer,
    terminalMessage: state.terminalMessage
  };
}

function toPublicState(state: HarnessRunStateInternal) {
  return {
    runId: state.runId,
    generation: state.generation,
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
    protocolRepairCount: state.protocolRepairCount,
    transcript: state.transcript.slice(),
    loadedSkillId: state.loadedSkillId,
    loadedResourcePaths: state.loadedResourcePaths.slice(),
    pendingObservation: state.pendingObservation,
    terminal: state.terminal,
    stopReason: state.stopReason,
    finalAnswer: state.finalAnswer,
    terminalMessage: state.terminalMessage
  };
}

type HarnessRunStateInternal = {
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
  failureSignature?: string;
  seenCallIds: Set<string>;
};
