import type { HarnessModelContext, HarnessTransport, HarnessTransportResult } from "./types";
import { parseTextActionResponse, renderToolMessageForTextTransport, TEXT_ACTION_PROTOCOL_INSTRUCTIONS } from "./textActionProtocol";
import { normalizeRetryConfig, type AgentAdapter, type ChatEvent, type NativeChatEvent, type RetryConfig } from "../../adapters/base";
import type { AgentConfig } from "../../types";
import { errorMessage } from "../../utils/errors";
import { getAbortSignalMessage, sleepWithAbort } from "../../utils/fetchWithTimeout";

export const DEFAULT_NATIVE_MODEL_RESPONSE_CHARS = 64_000;

type TransportErrorKind = "network" | "http" | "rate_limit" | "auth" | "empty" | "provider" | "response_limit";

const TRANSPORT_ERROR_KINDS = new Set<TransportErrorKind>([
  "network",
  "http",
  "rate_limit",
  "auth",
  "empty",
  "provider",
  "response_limit"
]);

function isTransportErrorKind(value: unknown): value is TransportErrorKind {
  return typeof value === "string" && TRANSPORT_ERROR_KINDS.has(value as TransportErrorKind);
}

function normalizeResponseLimit(value: number | undefined) {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.floor(value as number)
    : DEFAULT_NATIVE_MODEL_RESPONSE_CHARS;
}

export type TextTransportEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text?: string }
  | { type: "error"; kind: TransportErrorKind; retryable: boolean; message: string }
  | { type: "aborted"; message: string };

export type TextTransportInvocation = {
  candidateId: string;
  events: AsyncIterable<TextTransportEvent>;
};

function safeSerialize(value: unknown, maxChars: number) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = "[unserializable value]";
  }
  if (serialized.length <= maxChars) return serialized;
  const marker = `\n[… transcript value truncated; original_chars=${serialized.length}]`;
  return maxChars <= marker.length ? marker.slice(0, maxChars) : `${serialized.slice(0, maxChars - marker.length)}${marker}`;
}

function serializeNativeArguments(value: unknown) {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}

function transportException(error: unknown): HarnessTransportResult {
  return {
    status: "transport_error",
    kind: "provider",
    retryable: false,
    message: errorMessage(error)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (!isRecord(value)) return false;
  return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function isIterable(value: unknown): value is Iterable<unknown> | AsyncIterable<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  try {
    return (
      typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function" ||
      typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
    );
  } catch {
    return false;
  }
}

function isValidNativeTransportEvent(event: Record<string, unknown>) {
  if (event.type === "text_delta") return typeof event.text === "string";
  if (event.type === "tool_call_delta") {
    if (!isRecord(event.call) || !Number.isInteger(event.call.index) || (event.call.index as number) < 0) return false;
    return ![event.call.id, event.call.name, event.call.arguments].some((value) => value !== undefined && typeof value !== "string");
  }
  if (event.type === "done") return event.finishReason === undefined || typeof event.finishReason === "string";
  if (event.type === "aborted") return typeof event.message === "string";
  if (event.type === "error") return isTransportErrorKind(event.kind) && typeof event.retryable === "boolean" && typeof event.message === "string";
  return false;
}

function normalizeTextTransportEvent(value: unknown): TextTransportEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "delta") return typeof value.text === "string" ? { type: "delta", text: value.text } : null;
  if (value.type === "done") {
    return value.text === undefined || typeof value.text === "string"
      ? { type: "done", text: value.text as string | undefined }
      : null;
  }
  if (value.type === "aborted") return typeof value.message === "string" ? { type: "aborted", message: value.message } : null;
  if (
    value.type === "error" &&
    isTransportErrorKind(value.kind) &&
    typeof value.retryable === "boolean" &&
    typeof value.message === "string"
  ) {
    return {
      type: "error",
      kind: value.kind as TransportErrorKind,
      retryable: value.retryable,
      message: value.message
    };
  }
  return null;
}

export function createTextActionTransport(args: {
  invoke: (context: HarnessModelContext, signal: AbortSignal) => Promise<TextTransportInvocation>;
  maxModelResponseChars: number;
}): HarnessTransport {
  const maxModelResponseChars = normalizeResponseLimit(args.maxModelResponseChars);
  return {
    async runStep(context, signal): Promise<HarnessTransportResult> {
      try {
        const invocation = await args.invoke(context, signal);
        if (!isRecord(invocation) || typeof invocation.candidateId !== "string" || !isAsyncIterable(invocation.events)) {
          return { status: "protocol_error", candidateId: "unknown", rawPreview: "", message: "Text transport returned an invalid invocation." };
        }
        let full = "";
        let eventCount = 0;
        for await (const rawEvent of invocation.events) {
          eventCount += 1;
          if (eventCount > 10_000) {
            return { status: "transport_error", kind: "response_limit", retryable: false, message: "Text model response contained too many stream events." };
          }
          const event = normalizeTextTransportEvent(rawEvent);
          if (!event) {
            return { status: "protocol_error", candidateId: invocation.candidateId, rawPreview: full, message: "Text transport returned an invalid stream event." };
          }
          if (event.type === "delta") {
            if (full.length + event.text.length > maxModelResponseChars) {
              return {
                status: "transport_error",
                kind: "response_limit",
                retryable: false,
                message: `Model response exceeded ${maxModelResponseChars} chars.`
              };
            }
            full += event.text;
          } else if (event.type === "done") {
            if (typeof event.text === "string") {
              if (event.text.length > maxModelResponseChars) {
                return {
                  status: "transport_error",
                  kind: "response_limit",
                  retryable: false,
                  message: `Model response exceeded ${maxModelResponseChars} chars.`
                };
              }
              full = event.text;
            }
          } else if (event.type === "aborted") {
            return { status: "aborted", message: event.message };
          } else if (event.type === "error") {
            return {
              status: "transport_error",
              kind: event.kind,
              retryable: event.retryable,
              message: event.message
            };
          }
        }
        if (!full.trim()) {
          return { status: "transport_error", kind: "empty", retryable: true, message: "Model returned an empty response." };
        }
        const parsed = parseTextActionResponse(full);
        if (parsed.type === "protocol_error") {
          return {
            status: "protocol_error",
            candidateId: invocation.candidateId,
            rawPreview: parsed.rawPreview,
            message: parsed.message
          };
        }
        return { status: "step", candidateId: invocation.candidateId, step: parsed.step };
      } catch (error) {
        return transportException(error);
      }
    }
  };
}

function renderTextContext(context: HarnessModelContext) {
  return context.messages.map((message) => {
    if (message.role === "tool") {
      return `[UNTRUSTED_TOOL_RESULT callId=${JSON.stringify(message.callId)} toolId=${JSON.stringify(message.toolId)}]\n${renderToolMessageForTextTransport(message, 8_000)}`;
    }
    if (message.role === "runtime") return `[RUNTIME_NOTICE kind=${message.kind}]\n${message.content}`;
    if (message.role === "assistant") {
      if (!message.action) return `ASSISTANT:\n${message.content}`;
      const action = safeSerialize({
        type: "tool_call",
        toolId: message.action.toolId,
        input: message.action.input
      }, 8_000);
      return [
        `ASSISTANT_TOOL_CALL callId=${JSON.stringify(message.action.callId)}`,
        action,
        message.content ? `assistantText=${message.content}` : ""
      ].filter(Boolean).join("\n");
    }
    return "USER:\n" + message.content;
  }).join("\n\n");
}

export function createAdapterTextTransport(args: {
  adapter: AgentAdapter;
  agent: AgentConfig;
  candidateId: string;
  retry?: RetryConfig;
  onLog?: (text: string) => void;
  maxModelResponseChars: number;
}): HarnessTransport {
  const transport = createTextActionTransport({
    maxModelResponseChars: args.maxModelResponseChars,
    invoke: async (context, signal) => ({
      candidateId: args.candidateId,
      events: mapAdapterEvents(args.adapter.chat({
        agent: args.agent,
        input: renderTextContext(context),
        history: [],
        system: [TEXT_ACTION_PROTOCOL_INSTRUCTIONS, context.system].filter(Boolean).join("\n\n"),
        retry: args.retry,
        maxModelResponseChars: args.maxModelResponseChars,
        onLog: args.onLog,
        signal
      }))
    })
  });
  const retry = normalizeRetryConfig(args.retry);
  return {
    async runStep(context, signal) {
      for (let retryIndex = 0; ; retryIndex += 1) {
        const result = await transport.runStep(context, signal);
        if (
          result.status !== "transport_error" ||
          result.kind !== "empty" ||
          !result.retryable ||
          !retry ||
          retryIndex >= retry.max
        ) {
          return result;
        }
        args.onLog?.(`[retry] empty text response; retry ${retryIndex + 1}/${retry.max} in ${retry.delaySec}s`);
        try {
          await sleepWithAbort(retry.delaySec * 1_000, signal);
        } catch {
          return { status: "aborted", message: getAbortSignalMessage(signal) };
        }
      }
    }
  };
}

async function* mapAdapterEvents(events: AsyncGenerator<ChatEvent>) : AsyncGenerator<TextTransportEvent> {
  for await (const event of events) {
    if (event.type === "delta" || event.type === "done") yield event;
    else if (event.type === "aborted") yield event;
    else yield event;
  }
}

export type NativeToolCallDelta = {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
};

export type NativeTransportEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; call: NativeToolCallDelta }
  | { type: "done"; finishReason?: string }
  | { type: "error"; kind: TransportErrorKind; retryable: boolean; message: string }
  | { type: "aborted"; message: string };

function parseNativeArguments(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function normalizeNativeToolStream(args: {
  candidateId: string;
  events: Iterable<NativeTransportEvent>;
  maxModelResponseChars?: number;
}): HarnessTransportResult {
  const maxModelResponseChars = normalizeResponseLimit(args.maxModelResponseChars);
  let assistantText = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = "";
  let responseChars = 0;
  let eventCount = 0;
  for (const rawEvent of args.events) {
    eventCount += 1;
    if (eventCount > 10_000) {
      return { status: "transport_error", kind: "response_limit", retryable: false, message: "Native model response contained too many stream events." };
    }
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent) || typeof (rawEvent as { type?: unknown }).type !== "string") {
      return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native model returned an invalid stream event." };
    }
    const event = rawEvent as NativeTransportEvent;
    if (event.type === "error") {
      if (!isTransportErrorKind(event.kind) || typeof event.retryable !== "boolean" || typeof event.message !== "string") {
        return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native transport returned an invalid error event." };
      }
      return { status: "transport_error", kind: event.kind, retryable: event.retryable, message: event.message };
    }
    if (event.type === "aborted") {
      if (typeof event.message !== "string") return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native transport returned an invalid abort event." };
      return { status: "aborted", message: event.message };
    }
    if (event.type === "text_delta") {
      if (typeof event.text !== "string") {
        return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native text delta was invalid." };
      }
      responseChars += event.text.length;
      if (responseChars > maxModelResponseChars) {
        return { status: "transport_error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxModelResponseChars} chars.` };
      }
      assistantText += event.text;
    }
    else if (event.type === "tool_call_delta") {
      if (!isRecord(event.call) || !Number.isInteger(event.call.index) || (event.call.index as number) < 0) {
        return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native tool call index was invalid." };
      }
      if ([event.call.id, event.call.name, event.call.arguments].some((value) => value !== undefined && typeof value !== "string")) {
        return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native tool call delta contained an invalid field." };
      }
      responseChars += (event.call.id ?? "").length + (event.call.name ?? "").length + (event.call.arguments ?? "").length;
      if (responseChars > maxModelResponseChars) {
        return { status: "transport_error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxModelResponseChars} chars.` };
      }
      const current = calls.get(event.call.index) ?? { id: "", name: "", arguments: "" };
      current.id += event.call.id ?? "";
      current.name += event.call.name ?? "";
      current.arguments += event.call.arguments ?? "";
      calls.set(event.call.index, current);
    } else if (event.type === "done") {
      if (event.finishReason !== undefined && typeof event.finishReason !== "string") {
        return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native finish reason was invalid." };
      }
      finishReason = event.finishReason ?? "";
    } else {
      return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native model returned an unknown stream event." };
    }
  }

  if (calls.size > 1) {
    return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native response contained multiple tool calls; no call was dispatched." };
  }
  const call = Array.from(calls.values())[0];
  if (!call) {
    if (finishReason === "length") {
      return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native response was truncated before producing a complete action." };
    }
    if (finishReason === "tool_calls" || finishReason === "function_call") {
      return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native response announced a tool call but contained no tool call payload." };
    }
    if (!assistantText.trim()) {
      return { status: "transport_error", kind: "empty", retryable: true, message: "Native model returned an empty response." };
    }
    return { status: "step", candidateId: args.candidateId, step: { type: "final", answer: assistantText } };
  }
  if (finishReason === "length" || !call.name.trim()) {
    return { status: "protocol_error", candidateId: args.candidateId, rawPreview: assistantText, message: "Native tool call was truncated or missing a function name." };
  }
  const input = parseNativeArguments(call.arguments);
  if (input === undefined) {
    return { status: "protocol_error", candidateId: args.candidateId, rawPreview: call.arguments, message: "Native tool arguments were not valid JSON." };
  }
  return {
    status: "step",
    candidateId: args.candidateId,
    step: { type: "tool_call", toolId: call.name, input, assistantText: assistantText || undefined }
  };
}

export function createNativeToolTransport(args: {
  invoke: (context: HarnessModelContext, signal: AbortSignal) => Promise<{ candidateId: string; events: Iterable<NativeTransportEvent> | AsyncIterable<NativeTransportEvent> }>;
  mapToolId?: (providerToolId: string, context: HarnessModelContext) => string;
  maxModelResponseChars?: number;
}): HarnessTransport {
  return {
    async runStep(context, signal) {
      try {
        const invocation = await args.invoke(context, signal);
        if (!isRecord(invocation) || typeof invocation.candidateId !== "string" || !isIterable(invocation.events)) {
          return { status: "protocol_error", candidateId: "unknown", rawPreview: "", message: "Native transport returned an invalid invocation." };
        }
        const collected: NativeTransportEvent[] = [];
        let responseChars = 0;
        let eventCount = 0;
        const maxModelResponseChars = normalizeResponseLimit(args.maxModelResponseChars);
        for await (const rawEvent of invocation.events) {
          eventCount += 1;
          if (eventCount > 10_000) {
            return { status: "transport_error", kind: "response_limit", retryable: false, message: "Native model response contained too many stream events." };
          }
          const event: unknown = rawEvent;
          if (!isRecord(event)) {
            return { status: "protocol_error", candidateId: invocation.candidateId, rawPreview: "", message: "Native model returned an invalid stream event." };
          }
          if (!isValidNativeTransportEvent(event)) {
            return { status: "protocol_error", candidateId: invocation.candidateId, rawPreview: "", message: "Native model returned an invalid stream event." };
          }
          if (event.type === "text_delta") responseChars += (event.text as string).length;
          if (event.type === "tool_call_delta" && isRecord(event.call)) {
            responseChars += [event.call.id, event.call.name, event.call.arguments]
              .filter((value): value is string => typeof value === "string")
              .reduce((sum, value) => sum + value.length, 0);
          }
          if (responseChars > maxModelResponseChars) {
            return { status: "transport_error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxModelResponseChars} chars.` };
          }
          collected.push(rawEvent);
        }
        const result = normalizeNativeToolStream({ candidateId: invocation.candidateId, events: collected, maxModelResponseChars });
        if (result.status === "step" && result.step.type === "tool_call" && args.mapToolId) {
          return { ...result, step: { ...result.step, toolId: args.mapToolId(result.step.toolId, context) } };
        }
        return result;
      } catch (error) {
        return transportException(error);
      }
    }
  };
}

function mapNativeAdapterEvents(events: AsyncGenerator<NativeChatEvent>): AsyncIterable<NativeTransportEvent> {
  return (async function* () {
    for await (const event of events) yield event;
  })();
}

function harnessMessagesToNativeMessages(context: HarnessModelContext, providerToolName: (canonicalId: string) => string) {
  const callAliases = new Map<string, string>();
  const providerCallId = (canonicalId: string) => {
    const existing = callAliases.get(canonicalId);
    if (existing) return existing;
    const alias = `agr_call_${callAliases.size}`;
    callAliases.set(canonicalId, alias);
    return alias;
  };
  const messages = context.messages.map((message) => {
    if (message.role === "user") return { role: "user" as const, content: message.content };
    if (message.role === "runtime") return { role: "system" as const, content: `[RUNTIME_NOTICE ${message.kind}]\n${message.content}` };
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: providerCallId(message.callId),
        content: renderToolMessageForTextTransport(message, 8_000)
      };
    }
    return {
      role: "assistant" as const,
      content: message.content,
      ...(message.action ? {
        tool_calls: [{ id: providerCallId(message.action.callId), type: "function" as const, function: { name: providerToolName(message.action.toolId), arguments: serializeNativeArguments(message.action.input) } }]
      } : {})
    };
  });
  return context.system.trim()
    ? [{ role: "system" as const, content: context.system }, ...messages]
    : messages;
}

export function createAdapterNativeToolTransport(args: {
  adapter: AgentAdapter;
  agent: AgentConfig;
  candidateId: string;
  toolChoice?: (context: HarnessModelContext) => "auto" | "required";
  retry?: RetryConfig;
  onLog?: (text: string) => void;
  maxModelResponseChars: number;
}): HarnessTransport {
  const providerToolName = (index: number) => `agr_tool_${index}`;
  return createNativeToolTransport({
    maxModelResponseChars: args.maxModelResponseChars,
    mapToolId: (providerToolId, context) => {
      const index = Number(providerToolId.replace(/^agr_tool_/, ""));
      return Number.isInteger(index) && index >= 0 && index < context.tools.length ? context.tools[index].id : providerToolId;
    },
    invoke: async (context, signal) => {
      if (!args.adapter.nativeChat) {
        return {
          candidateId: args.candidateId,
          events: [{ type: "error", kind: "provider", retryable: false, message: "Native tool calling is unavailable for this adapter." }]
        } satisfies { candidateId: string; events: Iterable<NativeTransportEvent> };
      }
      return {
        candidateId: args.candidateId,
        events: mapNativeAdapterEvents(args.adapter.nativeChat({
          agent: args.agent,
          messages: harnessMessagesToNativeMessages(context, (canonicalId) => {
            const index = context.tools.findIndex((tool) => tool.id === canonicalId);
            return providerToolName(index >= 0 ? index : 0);
          }),
          tools: context.tools.map((tool, index) => ({ type: "function" as const, function: { name: providerToolName(index), description: tool.description, parameters: tool.inputSchema } })),
          toolChoice: args.toolChoice?.(context),
          retry: args.retry,
          onLog: args.onLog,
          signal,
          maxModelResponseChars: args.maxModelResponseChars
        }))
      };
    }
  });
}
