import { LoadBalancerConfig, McpServerConfig, McpToolPolicy, OrchestratorMode, VoiceSettings, normalizeToolTransportPolicy } from "../types";
import { readJsonStorage, writeJsonStorage } from "./safeStorage";

export type UiState = {
  activeTab?: "chat" | "chat_config" | "resources" | "agents" | "profile";
  mode?: OrchestratorMode | "leader_team";
  activeAgentId?: string;
  executionDeadlineMs?: number;
  memberAgentIds?: string[];
  reactMax?: number;
  // Legacy global retry settings kept only for migration.
  retryDelaySec?: number;
  retryMax?: number;
  historyMessageLimit?: number;
  userName?: string;
  userAvatarUrl?: string;
  userDescription?: string;
  voiceSettings?: VoiceSettings;
  // Legacy voice settings kept for migration from the old walkie-talkie mode.
  radioSettings?: Partial<VoiceSettings> & Record<string, unknown>;
};

const UI_KEY = "agr_ui_v1";
const MCP_KEY = "agr_mcp_v1";
const MCP_ALIAS_KEY = "agr_mcp_aliases_v1";
const MODEL_CREDENTIALS_KEY = "agr_model_credentials_v1";
const LOAD_BALANCERS_KEY = "agr_load_balancers_v1";

export type McpToolAliases = Record<string, Record<string, string>>;
export type ModelCredentialPreset = "openai" | "groq" | "gemini" | "custom" | "chrome_prompt";
export type ModelCredentialKeyEntry = {
  id: string;
  apiKey: string;
  createdAt: number;
  updatedAt: number;
};
export type ModelCredentialEntry = {
  id: string;
  preset: ModelCredentialPreset;
  label: string;
  endpoint: string;
  keys: ModelCredentialKeyEntry[];
  createdAt: number;
  updatedAt: number;
};
export type ModelCredentials = ModelCredentialEntry[];
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMcpToolPolicies(value: unknown): Record<string, McpToolPolicy> | undefined {
  if (!isRecord(value)) return undefined;
  const policies = Object.entries(value).slice(0, 200).reduce<Record<string, McpToolPolicy>>((result, [name, rawPolicy]) => {
    if (!name.trim() || name.length > 256 || !isRecord(rawPolicy)) return result;
    const policy: McpToolPolicy = {};
    if (rawPolicy.intent === "observe" || rawPolicy.intent === "mutate" || rawPolicy.intent === "control" || rawPolicy.intent === "context") policy.intent = rawPolicy.intent;
    if (rawPolicy.idempotency === "idempotent" || rawPolicy.idempotency === "non_idempotent" || rawPolicy.idempotency === "unknown") policy.idempotency = rawPolicy.idempotency;
    if (rawPolicy.cancellation === "terminable" || rawPolicy.cancellation === "cooperative" || rawPolicy.cancellation === "none") policy.cancellation = rawPolicy.cancellation;
    if (typeof rawPolicy.requireConfirmation === "boolean") policy.requireConfirmation = rawPolicy.requireConfirmation;
    if (Object.keys(policy).length) result[name] = policy;
    return result;
  }, {});
  return Object.keys(policies).length ? policies : undefined;
}

export function loadUiState(): UiState {
  return readJsonStorage(UI_KEY, {
    defaultValue: {},
    validate: (value): value is UiState => isRecord(value)
  });
}

export function saveUiState(state: UiState) {
  writeJsonStorage(UI_KEY, state);
}

export function loadMcpServers(): McpServerConfig[] {
  const parsed = readJsonStorage<unknown>(MCP_KEY, {
    defaultValue: [],
    validate: (value): value is unknown[] => Array.isArray(value)
  });
  return Array.isArray(parsed)
    ? parsed
      .filter(
        (item): item is Partial<McpServerConfig> & { id: string; name: string; sseUrl: string } =>
          isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.sseUrl === "string"
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        sseUrl: item.sseUrl,
        transport: item.transport === "streamable_http" ? "streamable_http" : "sse",
        authToken: typeof item.authToken === "string" ? item.authToken : undefined,
        customHeaders: isRecord(item.customHeaders)
          ? Object.fromEntries(Object.entries(item.customHeaders).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
          : undefined,
        useLocalProxy: item.useLocalProxy === true,
        authHint: typeof item.authHint === "string" ? item.authHint : undefined,
        toolTimeoutSecond:
          typeof item.toolTimeoutSecond === "number" && Number.isFinite(item.toolTimeoutSecond)
            ? item.toolTimeoutSecond
            : undefined,
        heartbeatSecond:
          typeof item.heartbeatSecond === "number" && Number.isFinite(item.heartbeatSecond)
            ? item.heartbeatSecond
            : undefined,
        toolPolicies: normalizeMcpToolPolicies(item.toolPolicies)
      }))
    : [];
}

export function saveMcpServers(servers: McpServerConfig[]) {
  writeJsonStorage(MCP_KEY, servers);
}

export function loadMcpAliases(): McpToolAliases {
  return readJsonStorage(MCP_ALIAS_KEY, {
    defaultValue: {},
    validate: (value): value is McpToolAliases => isRecord(value)
  });
}

export function saveMcpAliases(aliases: McpToolAliases) {
  writeJsonStorage(MCP_ALIAS_KEY, aliases);
}

export function loadModelCredentials(): ModelCredentials {
  try {
    const parsed = readJsonStorage<unknown>(MODEL_CREDENTIALS_KEY, {
      defaultValue: [],
      validate: (value): value is unknown[] | Record<string, unknown> => Array.isArray(value) || isRecord(value)
    });
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is ModelCredentialEntry =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.label === "string" &&
          typeof item.endpoint === "string" &&
          Array.isArray(item.keys) &&
          (item.preset === "openai" ||
            item.preset === "groq" ||
            item.preset === "gemini" ||
            item.preset === "custom" ||
            item.preset === "chrome_prompt")
      );
    }
    if (isRecord(parsed)) {
      const now = Date.now();
      return Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, value], index) => {
          const endpoint = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
          const preset =
            endpoint === "https://api.openai.com/v1"
              ? "openai"
              : endpoint === "https://api.groq.com/openai/v1"
              ? "groq"
              : endpoint === "https://generativelanguage.googleapis.com/v1beta"
              ? "gemini"
              : "custom";
          return {
            id: `${preset}-${index}-${now}`,
            preset,
            label:
              preset === "openai"
                ? "OpenAI"
                : preset === "groq"
                ? "Groq"
                : preset === "gemini"
                ? "Gemini"
                : `Custom ${index + 1}`,
            endpoint,
            keys: [
              {
                id: `${preset}-key-${index}-${now}`,
                apiKey: value,
                createdAt: now,
                updatedAt: now
              }
            ],
            createdAt: now,
            updatedAt: now
          };
        });
    }
    return [];
  } catch {
    return [];
  }
}

export function saveModelCredentials(credentials: ModelCredentials) {
  writeJsonStorage(MODEL_CREDENTIALS_KEY, credentials);
}

function normalizeLoadBalancerInstance(instance: LoadBalancerConfig["instances"][number]) {
  const { toolCallingCapability: legacyPolicy, ...canonicalInstance } = instance ?? {};
  return {
    ...canonicalInstance,
    toolTransportPolicy: normalizeToolTransportPolicy(canonicalInstance.toolTransportPolicy ?? legacyPolicy),
    resumeMinute:
      typeof instance?.resumeMinute === "number" && Number.isFinite(instance.resumeMinute)
        ? instance.resumeMinute
        : 60
  };
}

export function loadLoadBalancers(): LoadBalancerConfig[] {
  const parsed = readJsonStorage<unknown>(LOAD_BALANCERS_KEY, {
    defaultValue: [],
    validate: (value): value is unknown[] => Array.isArray(value)
  });
  return Array.isArray(parsed)
    ? parsed
      .filter(
        (item): item is LoadBalancerConfig =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Array.isArray(item.instances)
      )
      .map((item) => ({
        ...item,
        instances: item.instances.map(normalizeLoadBalancerInstance)
      }))
    : [];
}

export function saveLoadBalancers(loadBalancers: LoadBalancerConfig[]) {
  writeJsonStorage(LOAD_BALANCERS_KEY, loadBalancers.map((loadBalancer) => ({
    ...loadBalancer,
    instances: loadBalancer.instances.map(normalizeLoadBalancerInstance)
  })));
}

export function getLoadBalancersStorageKey() {
  return LOAD_BALANCERS_KEY;
}
