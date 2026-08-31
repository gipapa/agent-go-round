import type { ResolvedLoadBalancerInstance } from "../../utils/loadBalancer";
import { parseTextActionResponse } from "./textActionProtocol";
import { createAdapterNativeToolTransport, createAdapterTextTransport } from "./transports";
import type { AgentAdapter, RetryConfig } from "../../adapters/base";
import { supportsCustomTextProtocol } from "../../adapters/custom";
import { normalizeToolTransportPolicy, type AgentConfig, type ToolTransportPolicy } from "../../types";
import type { ContextBudget, HarnessModelContext, HarnessToolDefinition } from "./types";

export type ToolCallingCapability = "native" | "text_protocol" | "none";

export type CapabilityProbeStatus = "supported" | "unsupported" | "unknown";

export type DetectedToolCapability = {
  native: CapabilityProbeStatus;
  text: CapabilityProbeStatus;
};

export function normalizeDetectedToolCapability(value: unknown): ToolCallingCapability {
  return value === "native" || value === "text_protocol" ? value : "none";
}

/** @deprecated Use normalizeDetectedToolCapability for runtime results. */
export function normalizeToolCallingCapability(value: unknown): ToolCallingCapability {
  return normalizeDetectedToolCapability(value);
}

export type CapabilityProbeResult = {
  capability: ToolCallingCapability;
  ok: boolean;
  status: CapabilityProbeStatus;
  diagnostic: string;
  cached?: boolean;
};

export function getAgentToolTransportPolicy(agent: AgentConfig, fallback?: unknown): ToolTransportPolicy {
  return normalizeToolTransportPolicy(
    agent.capabilities?.toolTransportPolicy ?? agent.capabilities?.toolCallingCapability ?? fallback
  );
}

export function getCandidateToolTransportPolicy(candidate: ResolvedLoadBalancerInstance): ToolTransportPolicy {
  return normalizeToolTransportPolicy(candidate.instance.toolTransportPolicy ?? candidate.instance.toolCallingCapability);
}

/** @deprecated Persist a policy and negotiate its detected capability instead. */
export function getCandidateToolCallingCapability(candidate: ResolvedLoadBalancerInstance): ToolCallingCapability {
  const policy = getCandidateToolTransportPolicy(candidate);
  return policy === "native_only" ? "native" : policy === "text_only" ? "text_protocol" : "none";
}

export function evaluateTextCapabilityProbe(args: { response: string; expectedToolId: string }): CapabilityProbeResult {
  const parsed = parseTextActionResponse(args.response);
  if (parsed.type !== "step" || parsed.step.type !== "tool_call" || parsed.step.toolId !== args.expectedToolId) {
    return {
      capability: "none",
      ok: false,
      status: "unsupported",
      diagnostic: "Text action conformance probe did not return the exact expected tool envelope."
    };
  }
  return { capability: "text_protocol", ok: true, status: "supported", diagnostic: "Text action protocol conformance probe passed." };
}

const TEXT_PROBE_TOOL_ID = "internal:capability.probe";
const TEXT_PROBE_TOOL: HarnessToolDefinition = {
  id: TEXT_PROBE_TOOL_ID,
  description: "A no-side-effect capability probe. The runtime never dispatches this tool.",
  inputSchema: { type: "object", additionalProperties: false },
  intent: "context",
  idempotency: "idempotent",
  cancellation: "cooperative",
  requireConfirmation: false,
  executionKind: "internal"
};

function probeContext(): HarnessModelContext {
  const system = [
    "This is a no-side-effect text action protocol conformance probe.",
    `Reply with exactly this JSON object and nothing else: {\"type\":\"tool_call\",\"toolId\":\"${TEXT_PROBE_TOOL_ID}\",\"input\":{}}`,
    "Do not use markdown, commentary, or a different tool id. The runtime will not execute the probe tool."
  ].join("\n");
  const messages = [{ role: "user" as const, content: "Return the exact probe action now." }];
  return {
    system,
    messages,
    tools: [TEXT_PROBE_TOOL],
    chars: system.length + JSON.stringify(messages).length + JSON.stringify([TEXT_PROBE_TOOL]).length
  };
}

function revisionDigest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function headerRevision(headers: Record<string, string> | undefined) {
  const entries = Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return revisionDigest(JSON.stringify(entries) ?? "");
}

function revisionForAgent(agent: AgentConfig) {
  let material = "invalid-agent-config";
  try {
    material = JSON.stringify({
      type: agent.type,
      endpoint: agent.endpoint,
      apiKeyRevision: revisionDigest(agent.apiKey ?? ""),
      model: agent.model,
      headerRevision: headerRevision(agent.headers),
      custom: agent.custom,
      capabilities: agent.capabilities
    }) ?? material;
  } catch {
    // A malformed config must not poison the cache or escape as an uncaught
    // probe error. The adapter will still return a typed failure.
  }
  return revisionDigest(material);
}

function isTransientCapabilityFailure(kind: string, message: string) {
  return kind === "network" || kind === "rate_limit" || kind === "auth" || kind === "empty" ||
    (kind === "http" && /\bHTTP\s+5\d\d\b/i.test(message));
}

export function getTextCapabilityRevision(agent: AgentConfig, extra = "") {
  return `${revisionForAgent(agent)}:${extra}`;
}

export class TextCapabilityProbeCache {
  private values = new Map<string, CapabilityProbeResult>();

  get(key: string) {
    return this.values.get(key);
  }

  set(key: string, result: CapabilityProbeResult) {
    this.values.set(key, { ...result, cached: false });
  }

  clear() {
    this.values.clear();
  }
}

export const textCapabilityProbeCache = new TextCapabilityProbeCache();

export async function probeTextCapability(args: {
  candidateId: string;
  agent: AgentConfig;
  adapter: AgentAdapter;
  retry?: RetryConfig;
  maxModelResponseChars?: number;
  revision?: string;
  signal?: AbortSignal;
  cache?: TextCapabilityProbeCache;
}): Promise<CapabilityProbeResult> {
  const cache = args.cache ?? textCapabilityProbeCache;
  const key = `${args.candidateId}:${args.revision ?? getTextCapabilityRevision(args.agent)}`;
  const cached = cache.get(key);
  if (cached) return { ...cached, cached: true };
  if (args.signal?.aborted) return { capability: "none", ok: false, status: "unknown", diagnostic: "Text capability probe was aborted." };
  if (args.agent.type === "custom" && args.agent.custom && !supportsCustomTextProtocol(args.agent)) {
    const result = {
      capability: "none" as const,
      ok: false,
      status: "unsupported" as const,
      diagnostic: "Custom adapter template does not expose both {{system}} and {{input}} placeholders."
    };
    cache.set(key, result);
    return { ...result, cached: false };
  }

  const transport = createAdapterTextTransport({
    adapter: args.adapter,
    agent: args.agent,
    candidateId: args.candidateId,
    retry: args.retry,
    maxModelResponseChars: Number.isFinite(args.maxModelResponseChars)
      ? Math.min(1_000_000, Math.max(1, Math.floor(args.maxModelResponseChars as number)))
      : 4_000
  });
  const result = await transport.runStep(probeContext(), args.signal ?? new AbortController().signal);
  const probeResult: CapabilityProbeResult = result.status === "step" && result.step.type === "tool_call" && result.step.toolId === TEXT_PROBE_TOOL_ID
    ? { capability: "text_protocol", ok: true, status: "supported", diagnostic: "Text action protocol conformance probe passed." }
    : {
        capability: "none",
        ok: false,
        status: result.status === "protocol_error"
          ? "unsupported"
          : result.status === "transport_error"
            ? isTransientCapabilityFailure(result.kind, result.message) ? "unknown" : "unsupported"
            : "unknown",
        diagnostic: result.status === "transport_error" || result.status === "aborted" || result.status === "context_error"
          ? `Text capability probe failed: ${result.message}`
          : "Text action conformance probe did not return the exact expected tool envelope."
      };
  if (!args.signal?.aborted && probeResult.status !== "unknown") cache.set(key, probeResult);
  return { ...probeResult, cached: false };
}

const NATIVE_PROBE_TOOL_ID = "internal:capability.probe";
const NATIVE_PROBE_TOOL: HarnessToolDefinition = {
  id: NATIVE_PROBE_TOOL_ID,
  description: "A no-side-effect native tool capability probe. The runtime never dispatches this tool.",
  inputSchema: { type: "object", additionalProperties: false },
  intent: "context",
  idempotency: "idempotent",
  cancellation: "cooperative",
  requireConfirmation: false,
  executionKind: "internal"
};

function nativeProbeContext(): HarnessModelContext {
  const system = [
    "This is a no-side-effect native tool calling capability probe.",
    "Use the required probe function exactly once. The runtime will not execute it."
  ].join("\n");
  const messages = [{ role: "user" as const, content: "Call the required capability probe now." }];
  return {
    system,
    messages,
    tools: [NATIVE_PROBE_TOOL],
    chars: system.length + JSON.stringify(messages).length + JSON.stringify([NATIVE_PROBE_TOOL]).length
  };
}

function nativeProbeLooksUnsupported(message: string) {
  return /\bHTTP\s+(400|404|405|415|422)\b|(?:does\s+not|doesn't|not|unsupported|unavailable|disabled|invalid|not\s+allowed)[\s\S]{0,60}(?:tool|function)|(?:tool|function)[\s\S]{0,60}(?:not\s+supported|unsupported|unavailable|not\s+available|disabled|not\s+allowed|invalid)/i.test(message);
}

export async function probeNativeCapability(args: {
  candidateId: string;
  agent: AgentConfig;
  adapter: AgentAdapter;
  retry?: RetryConfig;
  revision?: string;
  signal?: AbortSignal;
  cache?: TextCapabilityProbeCache;
}): Promise<CapabilityProbeResult> {
  const cache = args.cache ?? textCapabilityProbeCache;
  const key = `native:${args.candidateId}:${args.revision ?? getTextCapabilityRevision(args.agent)}`;
  const cached = cache.get(key);
  if (cached) return { ...cached, cached: true };
  if (args.signal?.aborted) return { capability: "none", ok: false, status: "unknown", diagnostic: "Native capability probe was aborted." };
  if (!args.adapter.nativeChat) {
    const result = { capability: "none" as const, ok: false, status: "unsupported" as const, diagnostic: "Native tool calling is unavailable for this adapter." };
    cache.set(key, result);
    return { ...result, cached: false };
  }

  const transport = createAdapterNativeToolTransport({
    adapter: args.adapter,
    agent: args.agent,
    candidateId: args.candidateId,
    toolChoice: () => "required",
    retry: args.retry,
    maxModelResponseChars: 4_000
  });
  const result = await transport.runStep(nativeProbeContext(), args.signal ?? new AbortController().signal);
  let probeResult: CapabilityProbeResult;
  if (result.status === "step" && result.step.type === "tool_call" && result.step.toolId === NATIVE_PROBE_TOOL_ID) {
    probeResult = { capability: "native", ok: true, status: "supported", diagnostic: "Native tool calling capability probe passed." };
  } else if (result.status === "step") {
    probeResult = {
      capability: "none",
      ok: false,
      status: "unsupported",
      diagnostic: "Native capability probe did not return the required native tool call."
    };
  } else if (result.status === "protocol_error") {
    probeResult = { capability: "none", ok: false, status: "unsupported", diagnostic: `Native capability probe failed: ${result.message ?? "invalid native response"}` };
  } else if (result.status === "transport_error") {
    const unsupported =
      (result.kind === "http" && /\bHTTP\s+(400|404|405|415|422)\b/i.test(result.message)) ||
      (result.kind === "provider" && nativeProbeLooksUnsupported(result.message));
    probeResult = {
      capability: "none",
      ok: false,
      status: unsupported ? "unsupported" : "unknown",
      diagnostic: `Native capability probe failed: ${result.message}`
    };
  } else {
    const diagnostic = result.status === "context_error"
      ? result.message
      : result.status === "aborted"
        ? result.message
        : "Native capability probe returned an unsupported result.";
    probeResult = { capability: "none", ok: false, status: "unknown", diagnostic: `Native capability probe failed: ${diagnostic}` };
  }
  if (!args.signal?.aborted && probeResult.status !== "unknown") cache.set(key, probeResult);
  return { ...probeResult, cached: false };
}

export async function negotiateToolCallingCapability(args: {
  policy: ToolTransportPolicy;
  candidateId: string;
  agent: AgentConfig;
  adapter: AgentAdapter;
  retry?: RetryConfig;
  maxModelResponseChars?: number;
  revision?: string;
  signal?: AbortSignal;
  cache?: TextCapabilityProbeCache;
}): Promise<CapabilityProbeResult> {
  if (args.policy === "disabled") {
    return { capability: "none", ok: false, status: "unsupported", diagnostic: "Harness tool calling is disabled by policy." };
  }
  if (args.policy === "native_only") {
    return args.adapter.nativeChat
      ? { capability: "native", ok: true, status: "supported", diagnostic: "Native transport selected by policy." }
      : { capability: "none", ok: false, status: "unsupported", diagnostic: "Native tool calling is unavailable for this adapter." };
  }
  if (args.policy === "text_only") {
    return probeTextCapability(args);
  }

  const native = await probeNativeCapability(args);
  if (native.status === "supported") return native;
  if (native.status !== "unsupported") return native;
  return probeTextCapability(args);
}

export function selectHarnessCandidates(args: {
  candidates: ResolvedLoadBalancerInstance[];
  requiredCapability: Exclude<ToolCallingCapability, "none">;
  tools: HarnessToolDefinition[];
  budget: ContextBudget;
}) {
  let catalogChars: number;
  try {
    const serialized = JSON.stringify(args.tools);
    if (typeof serialized !== "string") return { candidates: [], errorCode: "tool_catalog_too_large" as const };
    catalogChars = serialized.length;
  } catch {
    return { candidates: [], errorCode: "tool_catalog_too_large" as const };
  }
  if (catalogChars > args.budget.maxCatalogChars) return { candidates: [], errorCode: "tool_catalog_too_large" as const };
  return {
    candidates: args.candidates.filter((candidate) => {
      const policy = getCandidateToolTransportPolicy(candidate);
      return (args.requiredCapability === "native" && policy === "native_only") ||
        (args.requiredCapability === "text_protocol" && policy === "text_only");
    }),
    errorCode: undefined
  };
}
