import type { ResolvedLoadBalancerInstance } from "../../utils/loadBalancer";
import { parseTextActionResponse } from "./textActionProtocol";
import { createAdapterTextTransport } from "./transports";
import type { AgentAdapter, RetryConfig } from "../../adapters/base";
import { supportsCustomTextProtocol } from "../../adapters/custom";
import type { AgentConfig } from "../../types";
import type { ContextBudget, HarnessModelContext, HarnessToolDefinition } from "./types";

export type ToolCallingCapability = "native" | "text_protocol" | "none";

export function normalizeToolCallingCapability(value: unknown): ToolCallingCapability {
  return value === "native" || value === "text_protocol" ? value : "none";
}

export type CapabilityProbeResult = {
  capability: ToolCallingCapability;
  ok: boolean;
  diagnostic: string;
  cached?: boolean;
};

export function evaluateTextCapabilityProbe(args: { response: string; expectedToolId: string }): CapabilityProbeResult {
  const parsed = parseTextActionResponse(args.response);
  if (parsed.type !== "step" || parsed.step.type !== "tool_call" || parsed.step.toolId !== args.expectedToolId) {
    return { capability: "none", ok: false, diagnostic: "Text action conformance probe did not return the exact expected tool envelope." };
  }
  return { capability: "text_protocol", ok: true, diagnostic: "Text action protocol conformance probe passed." };
}

export function getCandidateToolCallingCapability(candidate: ResolvedLoadBalancerInstance): ToolCallingCapability {
  return normalizeToolCallingCapability(candidate.instance.toolCallingCapability);
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

function revisionForAgent(agent: AgentConfig) {
  let material = "invalid-agent-config";
  try {
    material = JSON.stringify({
      type: agent.type,
      endpoint: agent.endpoint,
      apiKey: agent.apiKey,
      model: agent.model,
      headers: agent.headers,
      custom: agent.custom,
      capabilities: agent.capabilities
    }) ?? material;
  } catch {
    // A malformed config must not poison the cache or escape as an uncaught
    // probe error. The adapter will still return a typed failure.
  }
  return revisionDigest(material);
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
  if (args.signal?.aborted) return { capability: "none", ok: false, diagnostic: "Text capability probe was aborted." };
  if (args.agent.type === "custom" && args.agent.custom && !supportsCustomTextProtocol(args.agent)) {
    const result = { capability: "none" as const, ok: false, diagnostic: "Custom adapter template does not expose both {{system}} and {{input}} placeholders." };
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
    ? { capability: "text_protocol", ok: true, diagnostic: "Text action protocol conformance probe passed." }
    : { capability: "none", ok: false, diagnostic: result.status === "transport_error" || result.status === "aborted"
      ? `Text capability probe failed: ${result.message}`
      : "Text action conformance probe did not return the exact expected tool envelope." };
  if (!args.signal?.aborted) cache.set(key, probeResult);
  return { ...probeResult, cached: false };
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
    candidates: args.candidates.filter((candidate) => getCandidateToolCallingCapability(candidate) === args.requiredCapability),
    errorCode: undefined
  };
}
