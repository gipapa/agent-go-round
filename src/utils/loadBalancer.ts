import { AgentConfig, LoadBalancerConfig, LoadBalancerInstance } from "../types";
import { ModelCredentialEntry, ModelCredentialKeyEntry, ModelCredentialPreset } from "../storage/settingsStore";
import { normalizeCredentialUrl } from "./credential";
import { generateId } from "./id";

export const CHROME_PROMPT_CREDENTIAL_ENDPOINT = "chrome-prompt://local";
export const DEFAULT_INSTANCE_MAX_RETRIES = 4;
export const DEFAULT_INSTANCE_DELAY_SECOND = 5;
export const DEFAULT_INSTANCE_COOLDOWN_MS = 60 * 60 * 1000;

export type ResolvedLoadBalancerInstance = {
  loadBalancer: LoadBalancerConfig;
  instance: LoadBalancerInstance;
  credential: ModelCredentialEntry;
  key?: ModelCredentialKeyEntry;
  hydratedAgent: AgentConfig;
};

export function describeCredentialPreset(preset: ModelCredentialPreset, endpoint?: string) {
  if (preset === "openai") return "OpenAI";
  if (preset === "groq") return "Groq";
  if (preset === "chrome_prompt") return "Chrome Prompt";
  const normalized = normalizeCredentialUrl(endpoint);
  if (!normalized) return "Custom";
  try {
    return new URL(normalized).hostname;
  } catch {
    return normalized;
  }
}

export function createCredentialKeyEntry(apiKey = ""): ModelCredentialKeyEntry {
  const now = Date.now();
  return {
    id: generateId(),
    apiKey,
    createdAt: now,
    updatedAt: now
  };
}

export function createCredentialEntry(preset: ModelCredentialPreset, indexHint = 1): ModelCredentialEntry {
  const now = Date.now();
  if (preset === "openai") {
    return {
      id: generateId(),
      preset,
      label: "OpenAI",
      endpoint: "https://api.openai.com/v1",
      keys: [createCredentialKeyEntry("")],
      createdAt: now,
      updatedAt: now
    };
  }
  if (preset === "groq") {
    return {
      id: generateId(),
      preset,
      label: "Groq",
      endpoint: "https://api.groq.com/openai/v1",
      keys: [createCredentialKeyEntry("")],
      createdAt: now,
      updatedAt: now
    };
  }
  if (preset === "chrome_prompt") {
    return {
      id: generateId(),
      preset,
      label: "Chrome Prompt",
      endpoint: CHROME_PROMPT_CREDENTIAL_ENDPOINT,
      keys: [],
      createdAt: now,
      updatedAt: now
    };
  }
  return {
    id: generateId(),
    preset,
    label: `Custom ${indexHint}`,
    endpoint: "",
    keys: [createCredentialKeyEntry("")],
    createdAt: now,
    updatedAt: now
  };
}

export function createLoadBalancer(name = "New Load Balancer"): LoadBalancerConfig {
  const now = Date.now();
  return {
    id: generateId(),
    name,
    description: "",
    instances: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createLoadBalancerInstance(seed?: Partial<LoadBalancerInstance>): LoadBalancerInstance {
  const now = Date.now();
  return {
    id: generateId(),
    credentialId: seed?.credentialId ?? "",
    credentialKeyId: seed?.credentialKeyId,
    model: seed?.model ?? "",
    description: seed?.description ?? "",
    maxRetries: typeof seed?.maxRetries === "number" ? seed.maxRetries : DEFAULT_INSTANCE_MAX_RETRIES,
    delaySecond: typeof seed?.delaySecond === "number" ? seed.delaySecond : DEFAULT_INSTANCE_DELAY_SECOND,
    failure: seed?.failure ?? false,
    failureCount: typeof seed?.failureCount === "number" ? seed.failureCount : 0,
    nextCheckTime: seed?.nextCheckTime ?? null,
    createdAt: seed?.createdAt ?? now,
    updatedAt: seed?.updatedAt ?? now
  };
}

export function isLegacyUnsupportedAgent(agent: AgentConfig) {
  return agent.type === "custom" || agent.type === "a2a";
}

function inferPresetFromEndpoint(endpoint?: string): ModelCredentialPreset {
  const normalized = normalizeCredentialUrl(endpoint);
  if (normalized === "https://api.openai.com/v1") return "openai";
  if (normalized === "https://api.groq.com/openai/v1") return "groq";
  if (normalized === CHROME_PROMPT_CREDENTIAL_ENDPOINT) return "chrome_prompt";
  return "custom";
}

function ensureCredentialForAgent(
  agent: AgentConfig,
  credentials: ModelCredentialEntry[]
): { credentials: ModelCredentialEntry[]; credential: ModelCredentialEntry; keyId?: string } {
  if (agent.type === "chrome_prompt") {
    const existing = credentials.find((entry) => entry.preset === "chrome_prompt") ?? null;
    if (existing) return { credentials, credential: existing };
    const created = createCredentialEntry("chrome_prompt");
    return { credentials: [created, ...credentials], credential: created };
  }

  const endpoint = normalizeCredentialUrl(agent.endpoint);
  const preset = inferPresetFromEndpoint(endpoint);
  const apiKey = (agent.apiKey ?? "").trim();
  let credential =
    credentials.find((entry) => normalizeCredentialUrl(entry.endpoint) === endpoint && entry.preset === preset) ?? null;
  let next = credentials;

  if (!credential) {
    credential = createCredentialEntry(preset, credentials.filter((entry) => entry.preset === "custom").length + 1);
    credential = {
      ...credential,
      label: describeCredentialPreset(preset, endpoint),
      endpoint,
      keys: apiKey ? [createCredentialKeyEntry(apiKey)] : credential.keys,
      updatedAt: Date.now()
    };
    next = [credential, ...credentials];
  }

  if (apiKey) {
    const existingKey = credential.keys.find((key) => key.apiKey.trim() === apiKey) ?? null;
    if (existingKey) {
      return { credentials: next, credential, keyId: existingKey.id };
    }
    const createdKey = createCredentialKeyEntry(apiKey);
    const updated = { ...credential, keys: [...credential.keys, createdKey], updatedAt: Date.now() };
    next = next.map((entry) => (entry.id === updated.id ? updated : entry));
    return { credentials: next, credential: updated, keyId: createdKey.id };
  }

  return { credentials: next, credential, keyId: credential.keys[0]?.id };
}

export function migrateAgentsToLoadBalancers(args: {
  agents: AgentConfig[];
  credentials: ModelCredentialEntry[];
  loadBalancers: LoadBalancerConfig[];
}) {
  let credentials = args.credentials.slice();
  let loadBalancers = args.loadBalancers.slice();
  let changed = false;

  const agents = args.agents.map((agent) => {
    if (agent.loadBalancerId || isLegacyUnsupportedAgent(agent)) {
      return agent;
    }

    const ensured = ensureCredentialForAgent(agent, credentials);
    credentials = ensured.credentials;
    const lb = createLoadBalancer(`Migrated: ${agent.name}`);
    const instance = createLoadBalancerInstance({
      credentialId: ensured.credential.id,
      credentialKeyId: ensured.keyId,
      model: agent.model ?? (agent.type === "chrome_prompt" ? "chrome_prompt" : "gpt-4o-mini"),
      description: "Migrated from legacy agent settings"
    });
    const created = {
      ...lb,
      instances: [instance],
      updatedAt: Date.now()
    };
    loadBalancers = [created, ...loadBalancers];
    changed = true;
    return {
      ...agent,
      loadBalancerId: created.id
    };
  });

  return {
    agents,
    credentials,
    loadBalancers,
    changed
  };
}

export function getCredentialKey(credential: ModelCredentialEntry, credentialKeyId?: string) {
  if (!credential.keys.length) return undefined;
  return credential.keys.find((key) => key.id === credentialKeyId) ?? credential.keys[0];
}

export function shouldSkipInstance(instance: LoadBalancerInstance, now = Date.now()) {
  return instance.failure && !!instance.nextCheckTime && now < instance.nextCheckTime;
}

export function hydrateAgentForResolvedInstance(agent: AgentConfig, resolved: {
  credential: ModelCredentialEntry;
  key?: ModelCredentialKeyEntry;
  instance: LoadBalancerInstance;
}): AgentConfig {
  const preset = resolved.credential.preset;
  if (preset === "chrome_prompt") {
    return {
      ...agent,
      type: "chrome_prompt",
      endpoint: undefined,
      apiKey: undefined,
      model: resolved.instance.model || "chrome_prompt"
    };
  }
  return {
    ...agent,
    type: "openai_compat",
    endpoint: normalizeCredentialUrl(resolved.credential.endpoint),
    apiKey: resolved.key?.apiKey ?? "",
    model: resolved.instance.model
  };
}

export function resolveLoadBalancerCandidates(args: {
  agent: AgentConfig;
  credentials: ModelCredentialEntry[];
  loadBalancers: LoadBalancerConfig[];
  now?: number;
}) {
  const now = args.now ?? Date.now();
  if (!args.agent.loadBalancerId) return [];
  const loadBalancer = args.loadBalancers.find((entry) => entry.id === args.agent.loadBalancerId);
  if (!loadBalancer) return [];
  const resolved: ResolvedLoadBalancerInstance[] = [];
  for (const instance of loadBalancer.instances) {
    if (shouldSkipInstance(instance, now)) continue;
    const credential = args.credentials.find((entry) => entry.id === instance.credentialId);
    if (!credential) continue;
    const key = getCredentialKey(credential, instance.credentialKeyId);
    if (credential.preset !== "chrome_prompt" && !key?.apiKey.trim()) continue;
    resolved.push({
      loadBalancer,
      instance,
      credential,
      key,
      hydratedAgent: hydrateAgentForResolvedInstance(args.agent, { credential, key, instance })
    });
  }
  return resolved;
}

export function applyInstanceFailure(args: {
  loadBalancers: LoadBalancerConfig[];
  loadBalancerId: string;
  instanceId: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  return args.loadBalancers.map((loadBalancer) => {
    if (loadBalancer.id !== args.loadBalancerId) return loadBalancer;
    const instances = loadBalancer.instances.map((instance) => {
      if (instance.id !== args.instanceId) return instance;
      const failureCount = instance.failureCount + 1;
      return {
        ...instance,
        failureCount,
        failure: true,
        nextCheckTime: now + DEFAULT_INSTANCE_COOLDOWN_MS,
        updatedAt: now
      };
    });
    return { ...loadBalancer, instances, updatedAt: now };
  });
}

export function applyInstanceSuccess(args: {
  loadBalancers: LoadBalancerConfig[];
  loadBalancerId: string;
  instanceId: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  return args.loadBalancers.map((loadBalancer) => {
    if (loadBalancer.id !== args.loadBalancerId) return loadBalancer;
    const instances = loadBalancer.instances.map((instance) =>
      instance.id === args.instanceId
        ? {
            ...instance,
            failure: false,
            failureCount: 0,
            nextCheckTime: null,
            updatedAt: now
          }
        : instance
    );
    return { ...loadBalancer, instances, updatedAt: now };
  });
}

export function updateInstanceRetryFailureState(instance: LoadBalancerInstance, now = Date.now()) {
  const failureCount = instance.failureCount + 1;
  return {
    ...instance,
    failureCount,
    failure: true,
    nextCheckTime: now + DEFAULT_INSTANCE_COOLDOWN_MS,
    updatedAt: now
  };
}

export function setLoadBalancerRetryPolicy(args: {
  loadBalancers: LoadBalancerConfig[];
  loadBalancerId: string;
  maxRetries?: number;
  delaySecond?: number;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  return args.loadBalancers.map((loadBalancer) => {
    if (loadBalancer.id !== args.loadBalancerId) return loadBalancer;
    const instances = loadBalancer.instances.map((instance) => ({
      ...instance,
      maxRetries: typeof args.maxRetries === "number" ? Math.max(0, Math.round(args.maxRetries)) : instance.maxRetries,
      delaySecond: typeof args.delaySecond === "number" ? Math.max(0, Math.round(args.delaySecond)) : instance.delaySecond,
      updatedAt: now
    }));
    return { ...loadBalancer, instances, updatedAt: now };
  });
}
