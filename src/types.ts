import type { JSONSchema7 } from "json-schema";

export type AgentType = "openai_compat" | "chrome_prompt" | "custom" | "a2a";

export type Role = "system" | "user" | "assistant" | "tool";

export type ChatTraceEntry = {
  label: string;
  content: string;
};

export type HarnessRunProjection = {
  runId: string;
  generation: number;
  skillId?: string;
  stepCount: number;
  toolCallCount: number;
  durationMs: number;
  terminalReason: string;
  activity: Array<{ type: string; message?: string }>;
};

export type SkillTodoStatus = "pending" | "in_progress" | "completed" | "blocked";
export type SkillTodoSource = "skill" | "planner" | "system";
export type SkillPhase =
  | "skill_load"
  | "bootstrap_plan"
  | "observe"
  | "plan_next_step"
  | "act"
  | "sync_state"
  | "completion_gate"
  | "manual_gate"
  | "final_answer"
  | "verify_refine";

export type SkillTodoItem = {
  id: string;
  label: string;
  status: SkillTodoStatus;
  source: SkillTodoSource;
  reason?: string;
  updatedAt: number;
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
  harnessRun?: HarnessRunProjection;
  skillGoal?: string;
  skillTodo?: SkillTodoItem[];
  skillPhase?: SkillPhase;
  magiState?: MagiRenderState;
  ts: number;
};

export type MagiUnitId = "Melchior" | "Balthasar" | "Casper";
export type MagiVerdict = "APPROVE" | "REJECT" | "ABSTAIN" | "DEADLOCK";
export type MagiUnitVerdict = Exclude<MagiVerdict, "DEADLOCK">;
export type MagiMode = "magi_vote" | "magi_consensus";
export type MagiUnitStatus = "pending" | "thinking" | "voted" | "revised" | "error";
export type MagiRenderStatus = "running" | "completed" | "failed";

export type MagiUnitState = {
  unitId: MagiUnitId;
  unitNumber: 1 | 2 | 3;
  agentName: string;
  avatarUrl?: string;
  status: MagiUnitStatus;
  verdict?: MagiVerdict;
  confidence?: number;
  summary?: string;
  rationale?: string;
  concerns?: string[];
  critique?: string;
  changedMind?: boolean;
  error?: string;
};

export type MagiTranscriptEntry = {
  id: string;
  round: number;
  speaker: string;
  label: string;
  content: string;
  kind: "system" | "ballot" | "critique" | "error";
};

export type MagiRenderState = {
  mode: MagiMode;
  status: MagiRenderStatus;
  question: string;
  round: number;
  finalVerdict?: MagiVerdict;
  finalSummary?: string;
  informationText?: string;
  code: string;
  file: string;
  ext: string;
  exMode: string;
  priority: string;
  units: MagiUnitState[];
  transcript: MagiTranscriptEntry[];
};

export type VoiceSettings = {
  sttLoadBalancerId?: string;
  sttLanguage?: string;
  sttTemperature: number;
  sttPrompt: string;
  ttsLoadBalancerId?: string;
  ttsVoice: string;
};

export type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
};

export type LoadBalancerInstance = {
  id: string;
  credentialId: string;
  credentialKeyId?: string;
  model: string;
  description: string;
  maxRetries: number;
  delaySecond: number;
  resumeMinute: number;
  failure: boolean;
  failureCount: number;
  nextCheckTime?: number | null;
  createdAt: number;
  updatedAt: number;
  toolCallingCapability?: "native" | "text_protocol" | "none";
  contextBudget?: {
    maxTotalChars?: number;
    maxCatalogChars?: number;
    maxSkillInstructionChars?: number;
    maxResourceChars?: number;
    maxSingleToolResultChars?: number;
    maxModelResponseChars?: number;
  };
};

export type LoadBalancerConfig = {
  id: string;
  name: string;
  description?: string;
  instances: LoadBalancerInstance[];
  createdAt: number;
  updatedAt: number;
};

export type AgentConfig = {
  id: string;
  name: string;
  avatarUrl?: string;
  type: AgentType;
  description?: string;
  loadBalancerId?: string;
  managedBy?: "magi";
  managedUnitId?: MagiUnitId;
  tutorialRole?: "primary";

  // Legacy fields kept for backward compatibility during migration.
  endpoint?: string; // e.g. https://api.openai.com/v1
  apiKey?: string;
  model?: string; // for openai_compat
  headers?: Record<string, string>; // custom headers

  // Legacy custom adapter config.
  custom?: {
    method: "POST";
    url: string;
    bodyTemplate: string; // uses {{input}} {{history}} {{model}} {{system}}
    responseJsonPath: string; // e.g. $.choices[0].message.content
  };

  capabilities?: {
    streaming?: boolean;
    tools?: boolean;
    mcp?: boolean;
    toolCallingCapability?: "native" | "text_protocol" | "none";
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

export type OrchestratorMode = "one_to_one" | "magi_vote" | "magi_consensus";

export type DocItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
};

export type McpServerConfig = {
  id: string;
  name: string;
  sseUrl: string; // MCP endpoint URL; field name is retained for stored SSE configs.
  transport?: "sse" | "streamable_http";
  authToken?: string;
  customHeaders?: Record<string, string>;
  useLocalProxy?: boolean;
  authHint?: string; // Optional note (EventSource can't set headers)
  toolTimeoutSecond?: number;
  heartbeatSecond?: number;
  toolPolicies?: Record<string, McpToolPolicy>;
};

export type McpToolPolicy = {
  intent?: "observe" | "mutate" | "control" | "context";
  idempotency?: "idempotent" | "non_idempotent" | "unknown";
  cancellation?: "terminable" | "cooperative" | "none";
  requireConfirmation?: boolean;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: JSONSchema7;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type BuiltInToolConfig = {
  id: string;
  name: string;
  displayLabel?: string;
  description: string;
  code: string;
  inputSchema?: JSONSchema7;
  requireConfirmation?: boolean;
  updatedAt: number;
  source?: "system" | "custom";
  readonly?: boolean;
  systemHandler?: "user_profile" | "agent_directory";
};

export type SkillWorkflowPolicy = {
  instructions?: string;
  disableModelInvocation?: boolean;
  requiredToolIds?: string[];
  useSkillDocs?: boolean;
  useAgentDocs?: boolean;
  allowMcp?: boolean;
  allowBuiltInTools?: boolean;
  allowedMcpServerIds?: string[];
  allowedBuiltInToolIds?: string[];
  bootstrapAction?: {
    toolKind: "mcp" | "builtin";
    toolName: string;
    input?: unknown;
    reason?: string;
  };
};

export type SkillPackageDiagnostic = {
  code: string;
  path?: string;
  message: string;
};

export type SkillConfig = {
  id: string;
  name: string;
  version: string;
  description: string;
  decisionHint?: string;
  inputSchema?: JSONSchema7;
  workflow: SkillWorkflowPolicy;
  skillMarkdown: string;
  rootPath: string;
  sourcePackageName?: string;
  fileCount: number;
  docCount: number;
  scriptCount: number;
  assetCount: number;
  updatedAt: number;
  sourceProvenance?: "legacy" | "agentskills";
  skillDiagnostics?: SkillPackageDiagnostic[];
  packageByteSize?: number;
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
  content: string | Uint8Array;
  binaryContent?: Uint8Array;
  mediaType?: string;
  byteSize?: number;
  digest?: string;
  updatedAt: number;
};

export type LogLevel = "info" | "warn" | "error" | "debug";
export type LogOutcome = "info" | "success" | "failure" | "degraded";

export type LogEntry = {
  id: string;
  category: string;
  agent?: string;
  ok?: boolean;
  ts: number;
  message: string;
  level?: LogLevel;
  outcome?: LogOutcome;
  requestId?: string;
  stage?: string;
  details?: string;
};
