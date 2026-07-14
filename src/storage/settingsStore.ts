import { LoadBalancerConfig, McpServerConfig, OrchestratorMode, VoiceSettings, SkillExecutionMode } from "../types";
import { readJsonStorage, writeJsonStorage } from "./safeStorage";

export type UiState = {
  activeTab?: "chat" | "chat_config" | "resources" | "agents" | "profile";
  mode?: OrchestratorMode | "leader_team";
  skillExecutionMode?: SkillExecutionMode;
  skillVerifyMax?: number;
  skillToolLoopMax?: number;
  skillVerifierAgentId?: string;
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
const MCP_PROMPT_KEY = "agr_mcp_prompt_templates_v1";
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
export type McpPromptTemplateKey = "zh" | "en";
export type McpPromptTemplates = {
  activeId: McpPromptTemplateKey;
  zh: string;
  en: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function getDefaultMcpPromptTemplates(): McpPromptTemplates {
  return {
    activeId: "en",
    zh: [
      "請只回傳 JSON，不要加任何其他文字。",
      "",
      "請判斷這次是否需要使用工具。",
      "",
      "使用者提問如下:",
      "{{userInput}}",
      "",
      "工具清單如下:",
      "{{toolListJson}}",
      "",
      "如果不需要工具，回傳：",
      "{{noToolJson}}",
      "",
      "如果需要使用使用者資訊工具，回傳：",
      "{{userProfileJson}}",
      "",
      "如果需要使用 browser 內建 JS 工具，回傳：",
      "{{builtinToolJson}}",
      "",
      "如果需要使用 MCP 工具，回傳：",
      "{{mcpCallJson}}"
    ].join("\n"),
    en: [
      "Return JSON only. Do not add any other text.",
      "",
      "Decide whether this turn needs a tool.",
      "",
      "User request:",
      "{{userInput}}",
      "",
      "Available tools:",
      "{{toolListJson}}",
      "",
      "If no tool is needed, return:",
      "{{noToolJson}}",
      "",
      "If the user profile tool is needed, return:",
      "{{userProfileJson}}",
      "",
      "If a browser-side built-in JS tool is needed, return:",
      "{{builtinToolJson}}",
      "",
      "If an MCP tool is needed, return:",
      "{{mcpCallJson}}"
    ].join("\n")
  };
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
        authHint: typeof item.authHint === "string" ? item.authHint : undefined,
        toolTimeoutSecond:
          typeof item.toolTimeoutSecond === "number" && Number.isFinite(item.toolTimeoutSecond)
            ? item.toolTimeoutSecond
            : undefined,
        heartbeatSecond:
          typeof item.heartbeatSecond === "number" && Number.isFinite(item.heartbeatSecond)
            ? item.heartbeatSecond
            : undefined
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

export function loadMcpPromptTemplates(): McpPromptTemplates {
  const defaults = getDefaultMcpPromptTemplates();
  const parsed = readJsonStorage<Partial<McpPromptTemplates>>(MCP_PROMPT_KEY, {
    defaultValue: defaults,
    validate: (value): value is Partial<McpPromptTemplates> => isRecord(value)
  });
  return {
    activeId: parsed.activeId === "zh" ? "zh" : "en",
    zh: typeof parsed.zh === "string" && parsed.zh.trim() ? parsed.zh : defaults.zh,
    en: typeof parsed.en === "string" && parsed.en.trim() ? parsed.en : defaults.en
  };
}

export function saveMcpPromptTemplates(templates: McpPromptTemplates) {
  writeJsonStorage(MCP_PROMPT_KEY, templates);
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
        instances: item.instances.map((instance: LoadBalancerConfig["instances"][number]) => ({
          ...instance,
          resumeMinute:
            typeof instance?.resumeMinute === "number" && Number.isFinite(instance.resumeMinute)
              ? instance.resumeMinute
              : 60
        }))
      }))
    : [];
}

export function saveLoadBalancers(loadBalancers: LoadBalancerConfig[]) {
  writeJsonStorage(LOAD_BALANCERS_KEY, loadBalancers);
}

export function getLoadBalancersStorageKey() {
  return LOAD_BALANCERS_KEY;
}
