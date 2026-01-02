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
