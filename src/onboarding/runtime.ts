import { saveBuiltInTools } from "../storage/builtInToolStore";
import { listSkillFiles, listSkills, restoreSkillSnapshots } from "../storage/skillStore";
import { normalizeCredentialUrl } from "../utils/credential";
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
