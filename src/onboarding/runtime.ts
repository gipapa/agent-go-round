import { saveBuiltInTools } from "../storage/builtInToolStore";
import { listSkillFiles, listSkills, restoreSkillSnapshots } from "../storage/skillStore";
import { normalizeCredentialUrl } from "../utils/credential";
import { SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";
import { AgentConfig } from "../types";
import {
  TUTORIAL_SEQUENTIAL_ADVANCED_PATH,
  TUTORIAL_SEQUENTIAL_ASSET_PATH,
  TUTORIAL_SEQUENTIAL_EXAMPLES_PATH,
  TUTORIAL_SEQUENTIAL_SKILL_NAME,
  TUTORIAL_SEQUENTIAL_SKILL_ROOT
} from "./tutorialSkillTemplate";
import {
  TutorialEntryController,
  TutorialChatExpectation,
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

function findTutorialSequentialSkill(state: TutorialRuntimeState) {
  return (
    state.skills.find((skill) => skill.rootPath === TUTORIAL_SEQUENTIAL_SKILL_ROOT) ??
    state.skills.find((skill) => skill.name === TUTORIAL_SEQUENTIAL_SKILL_NAME) ??
    null
  );
}

function findTutorialMcpServer(state: TutorialRuntimeState) {
  return state.mcpServers.find((server) => server.name === TUTORIAL_MCP_NAME) ?? null;
}

function findTutorialAgentByPreset(state: TutorialRuntimeState, preset?: "tutorial_agent" | "tutorial_agent_base") {
  if (preset === "tutorial_agent") return findTutorialAgent(state.agents);
  if (preset === "tutorial_agent_base") return findTutorialAgentBase(state.agents);
  return null;
}

function hasSkillTracePath(assistant: TutorialRuntimeState["history"][number] | null, path: string) {
  return !!assistant?.skillTrace?.some((entry) => entry.content.includes(path));
}

function hasSkillLoaded(
  assistant: TutorialRuntimeState["history"][number] | null,
  identifiers: Array<string | null | undefined>
) {
  const values = identifiers.map((item) => item?.trim()).filter((item): item is string => !!item);
  return !!assistant?.skillTrace?.some(
    (entry) => entry.label === "Skill load" && values.some((value) => entry.content.includes(value))
  );
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

function toolMessageSucceeded(message: TutorialRuntimeState["history"][number] | null | undefined) {
  if (!message || message.role !== "tool") return false;
  return !/工具執行失敗/.test(message.content);
}

function buildGenericTutorialPendingStatus(step: TutorialStepDefinition, issues: string[]) {
  if (issues.length === 0) return step.completionLabel ?? "等待完成本步驟。";
  return issues.join(" ");
}

function evaluateAutomationChatStep(step: TutorialStepDefinition, state: TutorialRuntimeState): TutorialStepEvaluation {
  const automation = step.automation;
  const expect = automation?.expect as TutorialChatExpectation | undefined;
  const prompt = expect?.userPrompt?.trim() || automation?.composerSeed?.trim() || "";
  const { assistantIndex, assistant } = prompt
    ? findAssistantReplyAfterPrompt(state.history, prompt)
    : { assistantIndex: -1, assistant: null as TutorialRuntimeState["history"][number] | null };
  const toolMessages = assistantIndex >= 0 ? collectAdjacentToolMessages(state.history, assistantIndex) : [];
  const issues: string[] = [];

  if ((expect?.requireAssistant ?? true) && !assistant) {
    issues.push(step.completionLabel ?? "請先送出指定訊息並等待 Agent 回覆。");
  }

  if (assistant && expect?.assistantContentIncludes?.length) {
    const missing = expect.assistantContentIncludes.filter((token) => !assistant.content.includes(token));
    if (missing.length) {
      issues.push(`已收到回覆，但還缺少這些內容：${missing.join("、")}。`);
    }
  }

  if (assistant && expect?.successfulToolMessageIncludes?.length) {
    const missing = expect.successfulToolMessageIncludes.filter((token) => {
      const matched = toolMessages.find((item) => item.content.includes(token));
      return !toolMessageSucceeded(matched);
    });
    if (missing.length) {
      issues.push(`已收到回覆，但還沒有看到成功的工具調用：${missing.join("、")}。`);
    }
  }

  if (assistant && expect?.requireOpenedToolResult && !state.openedToolResultMessageIds.includes(assistant.id)) {
    issues.push("已收到回覆，請再展開「查看 tool result」完成驗證。");
  }

  if (assistant && expect?.skillTraceIncludes?.length) {
    const missing = expect.skillTraceIncludes.filter((path) => !hasSkillTracePath(assistant, path));
    if (missing.length) {
      issues.push(`已收到回覆，但 skill trace 尚未顯示：${missing.join("、")}。`);
    }
  }

  if (assistant && expect?.skillLoadContainsAny?.length && !hasSkillLoaded(assistant, expect.skillLoadContainsAny)) {
    issues.push("已收到回覆，但還沒有看到這個案例預期的 skill load 紀錄。");
  }

  return {
    completed: issues.length === 0 && (!expect || expect.requireAssistant === false || !!assistant),
    targetId: step.targetId ?? "chat-input",
    canContinue: issues.length === 0 && (!expect || expect.requireAssistant === false || !!assistant),
    statusText: issues.length === 0 ? `${step.checklistLabel} 已完成。` : buildGenericTutorialPendingStatus(step, issues)
  };
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
  if (step.automation?.expect) {
    return evaluateAutomationChatStep(step, state);
  }

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
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請先送出指定訊息並等待 Agent 回覆。"
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
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請先送出指定訊息並等待 Agent 回覆。"
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
    case "set_history_limit_to_one": {
      const completed = state.historyMessageLimit === 1;
      return {
        completed,
        targetId: step.targetId ?? "chat-config-history-card",
        canContinue: completed,
        statusText: completed
          ? "Messages sent to model 已改為 1，案例結束後會自動恢復原本設定。"
          : "請前往 Chat Config > History & Retry，將 Messages sent to model 改成 1。"
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
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請先送出指定訊息並等待 Agent 回覆。"
      };
    }
    case "first_chat_user_profile_tool": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請先送出指定訊息並等待 Agent 回覆。"
      };
    }
    case "ensure_tutorial_sequential_skill": {
      const skill = findTutorialSequentialSkill(state);
      const completed =
        !!skill &&
        skill.docCount >= 2 &&
        skill.assetCount >= 1 &&
        skill.skillMarkdown.includes(TUTORIAL_SEQUENTIAL_ADVANCED_PATH) &&
        skill.skillMarkdown.includes(TUTORIAL_SEQUENTIAL_EXAMPLES_PATH) &&
        skill.skillMarkdown.includes(TUTORIAL_SEQUENTIAL_ASSET_PATH);
      return {
        completed,
        targetId: step.targetId ?? "chat-config-skills-card",
        canContinue: completed,
        statusText: completed
          ? `已建立教學 skill：${skill?.name}`
          : "系統正在建立教學用 sequential-thinking skill，完成後即可前往下一步。"
      };
    }
    case "enable_tutorial_skill_access": {
      const agent = findTutorialAgentBase(state.agents);
      const skill = findTutorialSequentialSkill(state);
      const completed =
        !!agent &&
        !!skill &&
        agent.enableSkills === true &&
        (agent.allowedSkillIds === undefined || agent.allowedSkillIds.includes(skill.id));
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? `目前 Agent 已允許使用 skill：${skill?.name}`
          : "請到 Agents 頁編輯剛剛的 Agent，開啟 Skills，並允許使用這個教學 skill。"
      };
    }
    case "first_chat_skill_tone": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，確認 Agent 會以較冷靜、有條理的方式回覆。"
      };
    }
    case "first_chat_skill_user_profile": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，等待回覆，並展開「查看 tool result」。"
      };
    }
    case "first_chat_skill_references": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，讓 skill 同時使用 advanced 與 examples references。"
      };
    }
    case "first_chat_skill_asset_template": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，並確認回覆帶有模板區塊（例如【問題】、【拆解】、【最終回答】）。"
      };
    }
    case "register_tutorial_agent_browser_mcp": {
      const server = findTutorialMcpServer(state);
      const toolNames = server ? (state.mcpToolsByServer[server.id] ?? []).map((tool) => tool.name) : [];
      const hasRequiredTools = toolNames.includes("browser_open") && toolNames.includes("browser_snapshot");
      const completed = !!server && hasRequiredTools;
      const editorOpen = typeof document !== "undefined" && document.querySelector('[data-tutorial-id="mcp-editor-modal"]');
      return {
        completed,
        targetId: editorOpen ? "mcp-editor-modal" : step.targetId ?? "chat-config-mcp-card",
        canContinue: completed,
        statusText: completed
          ? `已完成教學用MCP註冊：${server?.name}`
          : server
          ? "已建立教學用MCP，但還需要 Connect & List Tools，並確認有 browser_open 與 browser_snapshot。"
          : "請建立名稱為「教學用MCP」的 MCP 項目，填入 SSE URL，Connect & List Tools 後再按 Save。"
      };
    }
    case "enable_tutorial_mcp_access": {
      const agent = findTutorialAgentBase(state.agents);
      const server = findTutorialMcpServer(state);
      const completed =
        !!agent &&
        !!server &&
        agent.enableMcp === true &&
        (agent.allowedMcpServerIds === undefined || agent.allowedMcpServerIds.includes(server.id));
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? "目前 Agent 已允許使用教學用MCP。"
          : "請到 Agents 頁編輯目前 Agent，打開 MCP 權限，並允許使用教學用MCP。"
      };
    }
    case "first_chat_mcp_browser_open": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，讓 Agent 明確使用 browser_open 開啟 GitHub Trending。"
      };
    }
    case "first_chat_mcp_browser_snapshot": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，讓 Agent 使用 browser_snapshot 讀取目前頁面，並展開 tool result。"
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

  controller.setConfigModal(null);

  if (step.automation?.skillExecutionMode) {
    controller.setSkillExecutionMode(step.automation.skillExecutionMode);
  }

  if (step.automation?.activeAgentPreset) {
    const agent = findTutorialAgentByPreset(state, step.automation.activeAgentPreset);
    if (agent) {
      controller.setActiveAgentId(agent.id);
      controller.setSelectedAgentId(agent.id);
    }
  }

  if (step.automation?.clearChatOnEnter) {
    controller.clearChat();
  }

  if (step.automation?.composerSeed && state.currentChatInput.trim() !== step.automation.composerSeed.trim()) {
    controller.setComposerSeed(step.automation.composerSeed);
  }

  switch (step.behavior) {
    case "setup_groq_credential":
    case "create_groq_agent":
    case "create_tutorial_doc":
    case "create_tutorial_time_tool":
    case "set_history_limit_to_one":
    case "fill_tutorial_user_profile":
      break;
    case "enable_tutorial_doc_access": {
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      break;
    }
    case "enable_tutorial_builtin_tool_access": {
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      break;
    }
    case "first_chat_joke":
    case "first_chat_doc_persona":
    case "first_chat_time_tool":
    case "first_chat_user_profile_tool":
      break;
    case "ensure_tutorial_sequential_skill": {
      controller.setActiveTab("chat_config");
      controller.setSkillExecutionMode("single_turn");
      controller.ensureTutorialSequentialSkill();
      break;
    }
    case "enable_tutorial_skill_access": {
      controller.setActiveTab("agents");
      controller.setSkillExecutionMode("single_turn");
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      break;
    }
    case "first_chat_skill_tone":
    case "first_chat_skill_user_profile":
    case "first_chat_skill_references":
    case "first_chat_skill_asset_template":
      break;
    case "register_tutorial_agent_browser_mcp":
      controller.setActiveTab("chat_config");
      break;
    case "enable_tutorial_mcp_access": {
      controller.setActiveTab("agents");
      const agent = findTutorialAgentBase(state.agents);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      break;
    }
    case "first_chat_mcp_browser_open":
    case "first_chat_mcp_browser_snapshot":
      break;
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
