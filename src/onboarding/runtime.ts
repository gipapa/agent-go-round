import { saveBuiltInTools } from "../storage/builtInToolStore";
import { listSkillFiles, listSkills, restoreSkillSnapshots } from "../storage/skillStore";
import { normalizeCredentialUrl } from "../utils/credential";
import { SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";
import { AgentConfig } from "../types";
import {
  TutorialEntryController,
  TutorialRuntimeState,
  TutorialScenarioDefinition,
  TutorialStepDefinition,
  TutorialStepEvaluation,
  TutorialWorkspaceSnapshot
} from "./types";

export const TUTORIAL_DOC_NAME = "教學用DOC";
export const TUTORIAL_MCP_NAME = "教學用MCP";
export const TUTORIAL_TIME_TOOL_NAME = "教學用時間工具";

function findGroqCredential(state: TutorialRuntimeState) {
  return state.credentials.find((entry) => entry.preset === "groq" && entry.apiKey.trim());
}

function findTutorialAgentBase(agents: AgentConfig[]) {
  return (
    agents.find(
      (agent) =>
        agent.type === "openai_compat" &&
        normalizeCredentialUrl(agent.endpoint) === "https://api.groq.com/openai/v1" &&
        agent.model === "moonshotai/kimi-k2-instruct-0905"
    ) ?? null
  );
}

function findTutorialAgent(agents: AgentConfig[]) {
  const agent = findTutorialAgentBase(agents);
  if (!agent) return null;
  if (
    agent.enableDocs === false &&
    agent.enableMcp === false &&
    agent.enableBuiltInTools === false &&
    agent.enableSkills === false
  ) {
    return agent;
  }
  return null;
}

function findTutorialTimeTool(state: TutorialRuntimeState) {
  return state.builtInTools.find((tool) => tool.name.trim() === TUTORIAL_TIME_TOOL_NAME) ?? null;
}

function findAssistantReplyAfterPrompt(history: TutorialRuntimeState["history"], prompt: string) {
  const lastPromptIndex = [...history].reverse().findIndex((item) => item.role === "user" && item.content.trim() === prompt);
  const actualPromptIndex = lastPromptIndex >= 0 ? history.length - 1 - lastPromptIndex : -1;
  if (actualPromptIndex < 0) {
    return { promptIndex: -1, assistantIndex: -1, assistant: null as TutorialRuntimeState["history"][number] | null };
  }
  const relativeAssistantIndex = history
    .slice(actualPromptIndex + 1)
    .findIndex((item) => item.role === "assistant" && item.content.trim().length > 0);
  if (relativeAssistantIndex < 0) {
    return { promptIndex: actualPromptIndex, assistantIndex: -1, assistant: null as TutorialRuntimeState["history"][number] | null };
  }
  const assistantIndex = actualPromptIndex + 1 + relativeAssistantIndex;
  return {
    promptIndex: actualPromptIndex,
    assistantIndex,
    assistant: history[assistantIndex] ?? null
  };
}

function collectAdjacentToolMessages(history: TutorialRuntimeState["history"], index: number) {
  const items: TutorialRuntimeState["history"] = [];

  for (let i = index - 1; i >= 0; i--) {
    const current = history[i];
    if (current.role === "tool") {
      items.unshift(current);
      continue;
    }
    break;
  }

  for (let i = index + 1; i < history.length; i++) {
    const current = history[i];
    if (current.role === "tool") {
      items.push(current);
      continue;
    }
    break;
  }

  return items;
}

export async function captureTutorialWorkspaceSnapshot(state: TutorialRuntimeState): Promise<TutorialWorkspaceSnapshot> {
  const skills = await listSkills();
  const snapshots = await Promise.all(
    skills.map(async (meta) => ({
      meta,
      files: await listSkillFiles(meta.id)
    }))
  );
  return {
    builtInTools: state.builtInTools,
    skills: snapshots
  };
}

export async function restoreTutorialWorkspaceSnapshot(snapshot: TutorialWorkspaceSnapshot) {
  saveBuiltInTools(snapshot.builtInTools);
  await restoreSkillSnapshots(snapshot.skills);
}

export function evaluateTutorialStep(step: TutorialStepDefinition, state: TutorialRuntimeState): TutorialStepEvaluation {
  switch (step.behavior) {
    case "manual_info":
      return {
        completed: true,
        targetId: step.targetId,
        canContinue: true,
        statusText: "閱讀完畢後可直接前往下一步。"
      };
    case "setup_groq_credential": {
      const groq = findGroqCredential(state);
      const success = groq ? state.credentialTestResults[groq.id]?.ok === true : false;
      return {
        completed: success,
        targetId: step.targetId ?? "credentials-modal",
        canContinue: success,
        statusText: success ? "Groq provider 已測試成功。" : "請先新增 Groq credential，填入 API key 並完成連線測試。"
      };
    }
    case "create_groq_agent": {
      const agent = findTutorialAgent(state.agents);
      const baseAgent = findTutorialAgentBase(state.agents);
      return {
        completed: !!agent,
        targetId: typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]') ? "agent-edit-modal" : "agents-add-button",
        canContinue: !!agent,
        statusText: agent
          ? `已建立 Agent：${agent.name}`
          : baseAgent
          ? "已建立 Agent，但 Access Control 仍需全部保持未勾選後再按 Save。"
          : "請新增 Agent，將 Provider 設為 Groq，載入 models 後選擇 moonshotai/kimi-k2-instruct-0905，再按 Save。"
      };
    }
    case "first_chat_joke": {
      const lastPromptIndex = [...state.history].reverse().findIndex((item) => item.role === "user" && item.content.trim() === "告訴我一個笑話");
      const actualIndex = lastPromptIndex >= 0 ? state.history.length - 1 - lastPromptIndex : -1;
      const replied =
        actualIndex >= 0
          ? state.history.slice(actualIndex + 1).some((item) => item.role === "assistant" && item.content.trim().length > 0)
          : false;
      return {
        completed: replied,
        targetId: step.targetId ?? "chat-input",
        canContinue: replied,
        statusText: replied ? "Agent 已完成第一次回覆。" : "送出「告訴我一個笑話」，並等待 Agent 完成回覆。"
      };
    }
    case "create_tutorial_doc": {
      const doc = state.docs.find((item) => item.title === TUTORIAL_DOC_NAME);
      const contentOk = !!doc && /喵/.test(doc.content);
      return {
        completed: contentOk,
        targetId: step.targetId ?? "chat-config-docs-card",
        canContinue: contentOk,
        statusText: contentOk
          ? `已建立文件：${doc?.title}`
          : "請建立「教學用DOC」，並在內容中加入「你是個說話結尾都會喵喵叫的助手」。"
      };
    }
    case "enable_tutorial_doc_access": {
      const agent = findTutorialAgentBase(state.agents);
      const doc = state.docs.find((item) => item.title === TUTORIAL_DOC_NAME);
      const docsEnabled = !!agent && agent.enableDocs === true;
      const docAllowed = !!doc && !!agent && (agent.allowedDocIds === undefined || agent.allowedDocIds.includes(doc.id));
      const completed = docsEnabled && docAllowed;
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? "目前 Agent 已允許使用教學文件。"
          : "請到 Agents 頁編輯剛剛的 Agent，將 Docs 打開，並允許使用教學文件。"
      };
    }
    case "first_chat_doc_persona": {
      const targetPrompt = "請用一句話自我介紹";
      const lastPromptIndex = [...state.history].reverse().findIndex((item) => item.role === "user" && item.content.trim() === targetPrompt);
      const actualIndex = lastPromptIndex >= 0 ? state.history.length - 1 - lastPromptIndex : -1;
      const assistantReply =
        actualIndex >= 0
          ? state.history.slice(actualIndex + 1).find((item) => item.role === "assistant" && item.content.trim().length > 0)
          : undefined;
      const completed = !!assistantReply && /喵/.test(assistantReply.content);
      return {
        completed,
        targetId: step.targetId ?? "chat-input",
        canContinue: completed,
        statusText: completed
          ? "Agent 已根據文件內容完成回覆。"
          : assistantReply
          ? "已收到回覆，但還看不出文件注入效果；請確認 Docs 已開啟，並重新測試。"
          : "請送出「請用一句話自我介紹」，並確認回覆是否帶有喵喵叫的人設。"
      };
    }
    case "create_tutorial_time_tool": {
      const tool = findTutorialTimeTool(state);
      const completed =
        !!tool &&
        tool.description.trim().length > 0 &&
        tool.code.trim().length > 0 &&
        /(new Date|toISOString|resolvedOptions\(\)\.timeZone)/.test(tool.code);
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="built-in-tools-modal"]')
            ? "built-in-tools-add-button"
            : step.targetId ?? "chat-config-tools-card",
        canContinue: completed,
        statusText: completed
          ? `已建立工具：${tool?.name}`
          : "請建立名稱為「教學用時間工具」的自訂工具，並使用 help 裡的時間範例程式。"
      };
    }
    case "fill_tutorial_user_profile": {
      const completed = state.userProfile.name.trim().length > 0 && state.userProfile.description.trim().length > 0;
      return {
        completed,
        targetId: step.targetId ?? "profile-name-input",
        canContinue: completed,
        statusText: completed ? "Profile 已填寫完成。" : "請至少填寫 Character name 與 自我描述。"
      };
    }
    case "enable_tutorial_builtin_tool_access": {
      const agent = findTutorialAgentBase(state.agents);
      const timeTool = findTutorialTimeTool(state);
      const builtInEnabled = !!agent && agent.enableBuiltInTools === true;
      const customSelection = !!agent && Array.isArray(agent.allowedBuiltInToolIds);
      const hasTimeTool = !!timeTool && !!agent && !!agent.allowedBuiltInToolIds?.includes(timeTool.id);
      const hasProfileTool = !!agent && !!agent.allowedBuiltInToolIds?.includes(SYSTEM_USER_PROFILE_TOOL_ID);
      const completed = builtInEnabled && customSelection && hasTimeTool && hasProfileTool;
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? "目前 Agent 已允許使用教學用時間工具與 get_user_profile。"
          : "請在 Agent 的 Built-in Tools 中勾選 Custom selection，並允許教學用時間工具與 get_user_profile。"
      };
    }
    case "first_chat_time_tool": {
      const targetPrompt = "請使用工具告訴我現在幾點，並補上時區";
      const { assistantIndex, assistant } = findAssistantReplyAfterPrompt(state.history, targetPrompt);
      const toolMessages = assistantIndex >= 0 ? collectAdjacentToolMessages(state.history, assistantIndex) : [];
      const toolUsed = toolMessages.some((item) => /Built-in tool -> 教學用時間工具/.test(item.content));
      const opened = !!assistant && state.openedToolResultMessageIds.includes(assistant.id);
      const completed = !!assistant && toolUsed && opened;
      return {
        completed,
        targetId: step.targetId ?? "chat-input",
        canContinue: completed,
        statusText: completed
          ? "已成功使用教學用時間工具並展開 tool result。"
          : assistant
          ? !toolUsed
            ? "已收到回覆，但還沒有看到教學用時間工具的調用結果；請確認 Agent 權限與工具描述。"
            : "已收到回覆，請再展開「查看 tool result」完成驗證。"
          : "請送出指定問題，等待 Agent 回覆，並展開「查看 tool result」。"
      };
    }
    case "first_chat_user_profile_tool": {
      const targetPrompt = "請使用工具讀取我的個人資訊，並用一句話介紹我是誰";
      const { assistantIndex, assistant } = findAssistantReplyAfterPrompt(state.history, targetPrompt);
      const toolMessages = assistantIndex >= 0 ? collectAdjacentToolMessages(state.history, assistantIndex) : [];
      const toolUsed = toolMessages.some((item) => /Built-in tool -> get_user_profile/.test(item.content));
      const opened = !!assistant && state.openedToolResultMessageIds.includes(assistant.id);
      const completed = !!assistant && toolUsed && opened;
      return {
        completed,
        targetId: step.targetId ?? "chat-input",
        canContinue: completed,
        statusText: completed
          ? "已成功使用 get_user_profile 並展開 tool result。"
          : assistant
          ? !toolUsed
            ? "已收到回覆，但還沒有看到 get_user_profile 的調用結果；請確認 Agent 權限與 Profile 是否已填寫。"
            : "已收到回覆，請再展開「查看 tool result」完成驗證。"
          : "請送出指定問題，等待 Agent 回覆，並展開「查看 tool result」。"
      };
    }
    default:
      return {
        completed: false,
        targetId: step.targetId,
        canContinue: false,
        statusText: "這個步驟尚未定義完成條件。"
      };
  }
}

export function applyTutorialStepEntry(step: TutorialStepDefinition, state: TutorialRuntimeState, controller: TutorialEntryController) {
  if (step.tab) {
    controller.setActiveTab(step.tab);
  }

  switch (step.behavior) {
    case "setup_groq_credential":
      controller.setConfigModal(null);
      break;
    case "create_groq_agent":
      controller.setConfigModal(null);
      break;
    case "create_tutorial_doc":
    case "create_tutorial_time_tool":
    case "fill_tutorial_user_profile":
      controller.setConfigModal(null);
      break;
    case "enable_tutorial_doc_access": {
      controller.setConfigModal(null);
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
      }
      break;
    }
    case "enable_tutorial_builtin_tool_access": {
      controller.setConfigModal(null);
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
      }
      break;
    }
    case "first_chat_joke": {
      controller.setConfigModal(null);
      controller.clearChat();
      const agent = findTutorialAgent(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
      }
      if (state.currentChatInput.trim() !== "告訴我一個笑話") {
        controller.setComposerSeed("告訴我一個笑話");
      }
      break;
    }
    case "first_chat_doc_persona": {
      controller.setConfigModal(null);
      controller.clearChat();
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
      }
      if (state.currentChatInput.trim() !== "請用一句話自我介紹") {
        controller.setComposerSeed("請用一句話自我介紹");
      }
      break;
    }
    case "first_chat_time_tool": {
      controller.setConfigModal(null);
      controller.clearChat();
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
      }
      if (state.currentChatInput.trim() !== "請使用工具告訴我現在幾點，並補上時區") {
        controller.setComposerSeed("請使用工具告訴我現在幾點，並補上時區");
      }
      break;
    }
    case "first_chat_user_profile_tool": {
      controller.setConfigModal(null);
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
      }
      if (state.currentChatInput.trim() !== "請使用工具讀取我的個人資訊，並用一句話介紹我是誰") {
        controller.setComposerSeed("請使用工具讀取我的個人資訊，並用一句話介紹我是誰");
      }
      break;
    }
    default:
      break;
  }
}

export function getTutorialStepPrimaryLabel(step: TutorialStepDefinition, evaluation: TutorialStepEvaluation) {
  if (step.behavior === "manual_info") {
    return step.actionLabel ?? "下一步";
  }
  return evaluation.completed ? step.actionLabel ?? "前往下一步" : step.completionLabel ?? "等待完成本步驟";
}

export function buildTutorialStepSummary(step: TutorialStepDefinition, evaluation: TutorialStepEvaluation) {
  return evaluation.statusText ?? step.completionLabel ?? step.instructionTitle;
}

export function getNextTutorialStep(scenario: TutorialScenarioDefinition, currentIndex: number) {
  return scenario.steps[currentIndex + 1] ?? null;
}
