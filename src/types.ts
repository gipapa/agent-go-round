export type AgentType = "openai_compat" | "chrome_prompt" | "custom" | "a2a";

export type Role = "system" | "user" | "assistant" | "tool";

export type ChatTraceEntry = {
  label: string;
  content: string;
};

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  name?: string; // agent name / tool name
  displayName?: string;
  avatarUrl?: string;
  statusText?: string;
  isStreaming?: boolean;
  hideWhileStreaming?: boolean;
  skillTrace?: ChatTraceEntry[];
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
  avatarUrl?: string;
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
  allowedBuiltInToolIds?: string[];
  allowedSkillIds?: string[];
  enableDocs?: boolean;
  enableMcp?: boolean;
  enableBuiltInTools?: boolean;
  enableSkills?: boolean;
  allowUserProfileTool?: boolean;
  allowAgentDirectoryTool?: boolean;
};

export type DetectResult = {
  ok: boolean;
  detectedType?: "openai_compat" | "unknown";
  notes?: string;
};

export type OrchestratorMode = "one_to_one" | "leader_team";
export type SkillExecutionMode = "single_turn" | "multi_turn";

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

export type BuiltInToolConfig = {
  id: string;
  name: string;
  displayLabel?: string;
  description: string;
  code: string;
  inputSchema?: any;
  requireConfirmation?: boolean;
  updatedAt: number;
  source?: "system" | "custom";
  readonly?: boolean;
  systemHandler?: "user_profile" | "agent_directory";
};

export type SkillWorkflowPolicy = {
  instructions?: string;
  useSkillDocs?: boolean;
  useAgentDocs?: boolean;
  allowMcp?: boolean;
  allowBuiltInTools?: boolean;
  allowedMcpServerIds?: string[];
  allowedBuiltInToolIds?: string[];
};

export type SkillConfig = {
  id: string;
  name: string;
  version: string;
  description: string;
  decisionHint?: string;
  inputSchema?: any;
  workflow: SkillWorkflowPolicy;
  skillMarkdown: string;
  rootPath: string;
  sourcePackageName?: string;
  fileCount: number;
  docCount: number;
  scriptCount: number;
  assetCount: number;
  updatedAt: number;
};

export type SkillAvailability = {
  skillId: string;
  name: string;
  description: string;
  allowed: boolean;
  reason?: string;
};

export type SkillSessionSnapshot = {
  sessionId: string;
  agentId: string;
  createdAt: number;
  availableSkills: SkillAvailability[];
};

export type LoadedSkillReference = {
  path: string;
  content: string;
};

export type LoadedSkillRuntime = {
  skillId: string;
  name: string;
  description: string;
  instructions: string;
  referencedPaths: string[];
  loadedReferences: LoadedSkillReference[];
  assetPaths: string[];
  loadedAssets: LoadedSkillReference[];
  allowMcp: boolean;
  allowBuiltInTools: boolean;
  allowedMcpServerIds?: string[];
  allowedBuiltInToolIds?: string[];
};

export type SkillDocItem = {
  id: string;
  skillId: string;
  path: string;
  title: string;
  content: string;
  updatedAt: number;
};

export type SkillFileItem = {
  id: string;
  skillId: string;
  path: string;
  kind: "skill" | "reference" | "script" | "asset" | "other";
  content: string;
  updatedAt: number;
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
