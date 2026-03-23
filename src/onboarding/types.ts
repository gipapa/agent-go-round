import { AgentConfig, BuiltInToolConfig, ChatMessage, DocItem, SkillConfig, SkillExecutionMode, SkillFileItem } from "../types";
import { ModelCredentialEntry } from "../storage/settingsStore";

export type TutorialTab = "chat" | "chat_config" | "agents" | "profile";
export type TutorialConfigModal = "credentials" | "agent" | null;

export type TutorialStepBehaviorId =
  | "manual_info"
  | "setup_groq_credential"
  | "create_groq_agent"
  | "first_chat_joke"
  | "create_tutorial_doc"
  | "enable_tutorial_doc_access"
  | "first_chat_doc_persona"
  | "create_tutorial_time_tool"
  | "set_history_limit_to_one"
  | "fill_tutorial_user_profile"
  | "enable_tutorial_builtin_tool_access"
  | "first_chat_time_tool"
  | "first_chat_user_profile_tool"
  | "ensure_tutorial_sequential_skill"
  | "enable_tutorial_skill_access"
  | "first_chat_skill_tone"
  | "first_chat_skill_user_profile"
  | "first_chat_skill_references"
  | "first_chat_skill_asset_template"
  | "register_tutorial_agent_browser_mcp"
  | "enable_tutorial_mcp_access"
  | "first_chat_mcp_browser_open"
  | "first_chat_mcp_browser_snapshot";

export type TutorialStepDefinition = {
  id: string;
  title: string;
  checklistLabel: string;
  instructionTitle: string;
  instructionBody: string;
  actionLabel?: string;
  completionLabel?: string;
  tab?: TutorialTab;
  targetId?: string;
  behavior: TutorialStepBehaviorId;
  automation?: TutorialStepAutomation;
};

export type TutorialChatExpectation = {
  userPrompt?: string;
  requireAssistant?: boolean;
  assistantContentIncludes?: string[];
  successfulToolMessageIncludes?: string[];
  requireOpenedToolResult?: boolean;
  skillTraceIncludes?: string[];
  skillLoadContainsAny?: string[];
};

export type TutorialStepAutomation = {
  composerSeed?: string;
  clearChatOnEnter?: boolean;
  skillExecutionMode?: SkillExecutionMode;
  activeAgentPreset?: "tutorial_agent" | "tutorial_agent_base";
  expect?: TutorialChatExpectation;
};

export type TutorialScenarioDefinition = {
  id: string;
  title: string;
  description: string;
  exitTitle: string;
  exitBody: string;
  steps: TutorialStepDefinition[];
};

export type TutorialStepEvaluation = {
  completed: boolean;
  targetId?: string;
  statusText?: string;
  canContinue: boolean;
};

export type TutorialSkillSnapshot = {
  meta: SkillConfig;
  files: SkillFileItem[];
};

export type TutorialWorkspaceSnapshot = {
  builtInTools: BuiltInToolConfig[];
  skills: TutorialSkillSnapshot[];
};

export type CredentialTestResultLike = {
  ok: boolean;
  message: string;
};

export type TutorialRuntimeState = {
  agents: AgentConfig[];
  skills: SkillConfig[];
  activeAgentId: string;
  credentials: ModelCredentialEntry[];
  credentialTestResults: Record<string, CredentialTestResultLike | undefined>;
  history: ChatMessage[];
  currentChatInput: string;
  historyMessageLimit: number;
  builtInTools: BuiltInToolConfig[];
  docs: DocItem[];
  mcpServers: { id: string; name: string; sseUrl: string }[];
  mcpToolsByServer: Record<string, { name: string; description?: string }[]>;
  userProfile: {
    name: string;
    description: string;
    hasAvatar: boolean;
  };
  openedToolResultMessageIds: string[];
};

export type TutorialEntryController = {
  setActiveTab: (tab: TutorialTab) => void;
  setConfigModal: (modal: TutorialConfigModal) => void;
  setActiveAgentId: (id: string) => void;
  setSelectedAgentId: (id: string) => void;
  setSkillExecutionMode: (mode: "single_turn" | "multi_turn") => void;
  setComposerSeed: (value: string) => void;
  clearChat: () => void;
  ensureTutorialSequentialSkill: () => void;
};
