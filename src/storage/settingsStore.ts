import { McpServerConfig, OrchestratorMode, SkillExecutionMode } from "../types";

export type UiState = {
  activeTab?: "chat" | "chat_config" | "resources" | "agents" | "profile";
  mode?: OrchestratorMode;
  skillExecutionMode?: SkillExecutionMode;
  skillVerifyMax?: number;
  skillVerifierAgentId?: string;
  activeAgentId?: string;
  memberAgentIds?: string[];
  reactMax?: number;
  retryDelaySec?: number;
  retryMax?: number;
  historyMessageLimit?: number;
  userName?: string;
  userAvatarUrl?: string;
  userDescription?: string;
};

const UI_KEY = "agr_ui_v1";
const MCP_KEY = "agr_mcp_v1";
const MCP_ALIAS_KEY = "agr_mcp_aliases_v1";
const MCP_PROMPT_KEY = "agr_mcp_prompt_templates_v1";
const MODEL_CREDENTIALS_KEY = "agr_model_credentials_v1";

export type McpToolAliases = Record<string, Record<string, string>>;
export type ModelCredentialPreset = "openai" | "groq" | "custom";
export type ModelCredentialEntry = {
  id: string;
  preset: ModelCredentialPreset;
  label: string;
  endpoint: string;
  apiKey: string;
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

export function getDefaultMcpPromptTemplates(): McpPromptTemplates {
  return {
    activeId: "zh",
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
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as UiState;
  } catch {
    return {};
  }
}

export function saveUiState(state: UiState) {
  localStorage.setItem(UI_KEY, JSON.stringify(state));
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as McpServerConfig[];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]) {
  localStorage.setItem(MCP_KEY, JSON.stringify(servers));
}

export function loadMcpAliases(): McpToolAliases {
  try {
    const raw = localStorage.getItem(MCP_ALIAS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as McpToolAliases;
  } catch {
    return {};
  }
}

export function saveMcpAliases(aliases: McpToolAliases) {
  localStorage.setItem(MCP_ALIAS_KEY, JSON.stringify(aliases));
}

export function loadMcpPromptTemplates(): McpPromptTemplates {
  const defaults = getDefaultMcpPromptTemplates();
  try {
    const raw = localStorage.getItem(MCP_PROMPT_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<McpPromptTemplates>;
    return {
      activeId: parsed.activeId === "en" ? "en" : "zh",
      zh: typeof parsed.zh === "string" && parsed.zh.trim() ? parsed.zh : defaults.zh,
      en: typeof parsed.en === "string" && parsed.en.trim() ? parsed.en : defaults.en
    };
  } catch {
    return defaults;
  }
}

export function saveMcpPromptTemplates(templates: McpPromptTemplates) {
  localStorage.setItem(MCP_PROMPT_KEY, JSON.stringify(templates));
}

export function loadModelCredentials(): ModelCredentials {
  try {
    const raw = localStorage.getItem(MODEL_CREDENTIALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is ModelCredentialEntry =>
          item &&
          typeof item.id === "string" &&
          typeof item.label === "string" &&
          typeof item.endpoint === "string" &&
          typeof item.apiKey === "string" &&
          (item.preset === "openai" || item.preset === "groq" || item.preset === "custom")
      );
    }
    if (parsed && typeof parsed === "object") {
      const now = Date.now();
      return Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, value], index) => {
          const endpoint = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
          const preset = endpoint === "https://api.openai.com/v1" ? "openai" : endpoint === "https://api.groq.com/openai/v1" ? "groq" : "custom";
          return {
            id: `${preset}-${index}-${now}`,
            preset,
            label: preset === "openai" ? "OpenAI" : preset === "groq" ? "Groq" : `Custom ${index + 1}`,
            endpoint,
            apiKey: value,
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
  localStorage.setItem(MODEL_CREDENTIALS_KEY, JSON.stringify(credentials));
}
