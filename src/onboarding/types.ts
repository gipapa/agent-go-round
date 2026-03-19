import { AgentConfig, BuiltInToolConfig, ChatMessage, DocItem, SkillConfig, SkillFileItem } from "../types";
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
  | "fill_tutorial_user_profile"
  | "enable_tutorial_builtin_tool_access"
  | "first_chat_time_tool"
  | "first_chat_user_profile_tool";

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
  activeAgentId: string;
  credentials: ModelCredentialEntry[];
  credentialTestResults: Record<string, CredentialTestResultLike | undefined>;
  history: ChatMessage[];
  currentChatInput: string;
  builtInTools: BuiltInToolConfig[];
  docs: DocItem[];
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
  setComposerSeed: (value: string) => void;
  clearChat: () => void;
};
