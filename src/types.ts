export type AgentType = "openai_compat" | "chrome_prompt" | "custom" | "a2a";

export type Role = "system" | "user" | "assistant" | "tool";

export type ChatTraceEntry = {
  label: string;
  content: string;
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

export type BrowserObservationTargetKind = "repo_link" | "input" | "button" | "link" | "generic";

export type BrowserObservationTarget = {
  ref: string;
  role: string;
  label: string;
  kind: BrowserObservationTargetKind;
  score: number;
};

export type BrowserObservationDigest = {
  sourceTool: string;
  pageKind: "ranked_list" | "repo_page" | "input_page" | "unknown";
  blockedReason?: string;
  repoName?: string;
  url?: string;
  title?: string;
  rankedTargets: BrowserObservationTarget[];
  inputTargets: BrowserObservationTarget[];
  actionTargets: BrowserObservationTarget[];
  contentHints: string[];
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
  skillGoal?: string;
  skillTodo?: SkillTodoItem[];
  skillPhase?: SkillPhase;
  ts: number;
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

  // Legacy fields kept for backward compatibility during migration.
  endpoint?: string; // e.g. https://api.openai.com/v1
  apiKey?: string;
  model?: string; // for openai_compat
  headers?: Record<string, string>; // custom headers

  // Legacy custom adapter config.
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
  toolTimeoutSecond?: number;
  heartbeatSecond?: number;
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
  bootstrapAction?: {
    toolKind: "mcp" | "builtin";
    toolName: string;
    input?: any;
    reason?: string;
  };
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

export type SkillStepDecision =
  | {
      type: "observe";
      reason: string;
      todoIds?: string[];
    }
  | {
      type: "act";
      reason: string;
      toolKind: "mcp" | "builtin";
      toolName: string;
      input?: any;
      todoIds?: string[];
    }
  | {
      type: "ask_user";
      reason: string;
      message: string;
      todoIds?: string[];
    }
  | {
      type: "finish";
      reason: string;
      todoIds?: string[];
    };

export type SkillCompletionDecision =
  | {
      type: "complete";
      reason?: string;
      todoIds?: string[];
    }
  | {
      type: "incomplete";
      reason: string;
      suggestedFocus?: string;
      todoIds?: string[];
    };

export type SkillRunState = {
  skillId: string;
  goal: string;
  phase: SkillPhase;
  stepIndex: number;
  todo: SkillTodoItem[];
  recentObservationSignatures: string[];
  recentActionSignatures: string[];
  manualGate: "none" | "awaiting_user_confirmation" | "awaiting_manual_browser_step" | "resumable";
  completionStatus: "unknown" | "complete" | "incomplete";
  latestReason?: string;
  lastBrowserObservation?: BrowserObservationDigest;
  preferredMcpServerId?: string;
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
  bootstrapAction?: SkillWorkflowPolicy["bootstrapAction"];
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
