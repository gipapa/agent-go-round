import { McpServerConfig, OrchestratorMode } from "../types";

export type UiState = {
  activeTab?: "chat" | "resources" | "agents";
  mode?: OrchestratorMode;
  activeAgentId?: string;
  memberAgentIds?: string[];
  reactMax?: number;
  retryDelaySec?: number;
  retryMax?: number;
};

const UI_KEY = "agr_ui_v1";
const MCP_KEY = "agr_mcp_v1";
const MCP_ALIAS_KEY = "agr_mcp_aliases_v1";

export type McpToolAliases = Record<string, Record<string, string>>;

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
