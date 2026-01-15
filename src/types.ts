export type AgentType = "openai_compat" | "chrome_prompt" | "custom" | "a2a";

export type Role = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  name?: string; // agent name / tool name
  ts: number;
};

export type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
};

export type AgentConfig = {
  id: string;
  name: string;
  type: AgentType;
  description?: string;

  endpoint?: string; // e.g. https://api.openai.com/v1
  apiKey?: string;

  model?: string; // for openai_compat
  headers?: Record<string, string>; // custom headers

  // custom adapter: template mapping (minimal MVP)
  custom?: {
    method: "POST";
    url: string;
    bodyTemplate: string; // uses {{input}} {{history}} {{model}}
    responseJsonPath: string; // e.g. $.choices[0].message.content
  };

  capabilities?: {
    streaming?: boolean;
    tools?: boolean;
    mcp?: boolean;
  };

  allowedDocIds?: string[];
  allowedMcpServerIds?: string[];
};

export type DetectResult = {
  ok: boolean;
  detectedType?: "openai_compat" | "unknown";
  notes?: string;
};

export type OrchestratorMode = "one_to_one" | "leader_team";

export type DocItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
};

export type McpServerConfig = {
  id: string;
  name: string;
  sseUrl: string; // MCP over SSE endpoint
  authHint?: string; // Optional note (EventSource can't set headers)
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: any;
};

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogEntry = {
  id: string;
  category: string;
  agent?: string;
  ok?: boolean;
  ts: number;
  message: string;
  level?: LogLevel;
  details?: string;
};
