import type { ModelCredentialEntry } from "../storage/settingsStore";
import type { AgentConfig, LoadBalancerConfig } from "../types";
import { describeCredentialPreset, getCredentialKey, type ResolvedLoadBalancerInstance } from "./loadBalancer";

export function formatLoadBalancerDateTime(ts?: number | null) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString();
}

export function formatCredentialKeyLabel(credential: ModelCredentialEntry, key?: ModelCredentialEntry["keys"][number]) {
  if (credential.preset === "chrome_prompt") return "not_required";
  if (!key) return "missing";
  const slot = credential.keys.findIndex((entry) => entry.id === key.id);
  const suffix = key.apiKey.trim() ? `…${key.apiKey.trim().slice(-4)}` : "empty";
  const keyIdShort = key.id.slice(0, 8);
  return `slot=${slot >= 0 ? slot + 1 : "?"}/${credential.keys.length || "?"}, suffix=${suffix}, id=${keyIdShort}`;
}

export function describeResolvedLoadBalancerCandidate(candidate: ResolvedLoadBalancerInstance) {
  const instanceIndex = Math.max(
    0,
    candidate.loadBalancer.instances.findIndex((entry) => entry.id === candidate.instance.id)
  );
  const provider = describeCredentialPreset(candidate.credential.preset, candidate.credential.endpoint);
  return [
    `load_balancer=${candidate.loadBalancer.name}`,
    `instance=${instanceIndex + 1}/${candidate.loadBalancer.instances.length}`,
    `provider=${provider}`,
    `credential=${candidate.credential.label}`,
    `endpoint=${candidate.credential.endpoint || "-"}`,
    `model=${candidate.instance.model || "-"}`,
    `description=${candidate.instance.description.trim() || "-"}`,
    `key=${formatCredentialKeyLabel(candidate.credential, candidate.key)}`,
    `max_retries=${candidate.instance.maxRetries}`,
    `delay_second=${candidate.instance.delaySecond}`,
    `resume_minute=${candidate.instance.resumeMinute}`,
    `failure=${candidate.instance.failure}`,
    `failure_count=${candidate.instance.failureCount}`,
    `next_check_time=${formatLoadBalancerDateTime(candidate.instance.nextCheckTime)}`
  ].join("\n");
}

export function describeLoadBalancerAvailability(args: {
  agent: AgentConfig;
  loadBalancers: LoadBalancerConfig[];
  credentials: ModelCredentialEntry[];
}) {
  if (!args.agent.loadBalancerId) return "agent has no load balancer";
  const loadBalancer = args.loadBalancers.find((entry) => entry.id === args.agent.loadBalancerId) ?? null;
  if (!loadBalancer) return `load balancer not found: ${args.agent.loadBalancerId}`;
  if (!loadBalancer.instances.length) return `load_balancer=${loadBalancer.name}\ninstances=0`;
  const now = Date.now();
  return [
    `load_balancer=${loadBalancer.name}`,
    ...loadBalancer.instances.map((instance, index) => {
      const credential = args.credentials.find((entry) => entry.id === instance.credentialId) ?? null;
      const key = credential ? getCredentialKey(credential, instance.credentialKeyId) : undefined;
      const provider = credential ? describeCredentialPreset(credential.preset, credential.endpoint) : "missing_credential";
      const coolingDown =
        instance.failure === true &&
        typeof instance.nextCheckTime === "number" &&
        Number.isFinite(instance.nextCheckTime) &&
        now < instance.nextCheckTime;
      return [
        `instance=${index + 1}/${loadBalancer.instances.length}`,
        `status=${coolingDown ? "cooldown_skip" : "eligible"}`,
        `provider=${provider}`,
        `credential=${credential?.label ?? "(missing)"}`,
        `endpoint=${credential?.endpoint ?? "-"}`,
        `model=${instance.model || "-"}`,
        `description=${instance.description.trim() || "-"}`,
        `key=${credential ? formatCredentialKeyLabel(credential, key) : "missing"}`,
        `failure=${instance.failure}`,
        `failure_count=${instance.failureCount}`,
        `next_check_time=${formatLoadBalancerDateTime(instance.nextCheckTime)}`
      ].join("\n");
    })
  ].join("\n\n");
}
