import { saveBuiltInTools } from "../storage/builtInToolStore";
import { listSkillFiles, listSkills, restoreSkillSnapshots } from "../storage/skillStore";
import { normalizeCredentialUrl } from "../utils/credential";
import { SYSTEM_REQUEST_CONFIRMATION_TOOL_ID, SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";
import { AgentConfig } from "../types";
import {
  TUTORIAL_TIME_TOOL_CODE,
  TUTORIAL_TIME_TOOL_DESCRIPTION,
  TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
  TUTORIAL_TIME_TOOL_NAME
} from "./tutorialBuiltInToolTemplate";
export {
  TUTORIAL_TIME_TOOL_CODE,
  TUTORIAL_TIME_TOOL_DESCRIPTION,
  TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
  TUTORIAL_TIME_TOOL_NAME
} from "./tutorialBuiltInToolTemplate";
import {
  TUTORIAL_CHATGPT_BROWSER_ASSET_PATH,
  TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH,
  TUTORIAL_CHATGPT_BROWSER_SKILL_NAME,
  TUTORIAL_CHATGPT_BROWSER_SKILL_ROOT,
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
export const TUTORIAL_DOC_CONTENT = "你是個說話結尾都會喵喵叫的助手。每次回答的結尾都要補上一句喵。";
export const TUTORIAL_MCP_NAME = "教學用MCP";
export const TUTORIAL_PRIMARY_LOAD_BALANCER_NAME = "教學用Load Balancer 1";
export const TUTORIAL_SECONDARY_LOAD_BALANCER_NAME = "教學用Load Balancer 2";
export const TUTORIAL_PRIMARY_MODEL = "groq/compound";
export const TUTORIAL_SECONDARY_MODEL = "groq/compound-mini";

function isManagedMagiAgent(agent: AgentConfig) {
  return agent.managedBy === "magi" && !!agent.managedUnitId;
}

function findLoadBalancerByName(state: TutorialRuntimeState, name: string) {
  return state.loadBalancers.find((entry) => entry.name.trim() === name) ?? null;
}

function findGroqCredential(state: TutorialRuntimeState) {
  return state.credentials.find((entry) => entry.preset === "groq" && entry.keys.some((key) => key.apiKey.trim()));
}

function findTutorialPrimaryCredentialKey(state: TutorialRuntimeState) {
  const primary = findLoadBalancerByName(state, TUTORIAL_PRIMARY_LOAD_BALANCER_NAME);
  const primaryInstance = primary?.instances[0] ?? null;
  const primaryCredential =
    (primaryInstance ? state.credentials.find((entry) => entry.id === primaryInstance.credentialId) : null) ??
    findGroqCredential(state) ??
    null;
  if (!primaryCredential) return null;
  const primaryKey =
    primaryCredential.keys.find((key) => key.id === primaryInstance?.credentialKeyId && key.apiKey.trim()) ??
    primaryCredential.keys.find((key) => state.credentialTestResults[key.id]?.ok === true) ??
    primaryCredential.keys.find((key) => key.apiKey.trim()) ??
    null;
  if (!primaryKey) return null;
  return { credential: primaryCredential, key: primaryKey };
}

function findTutorialSecondaryCredentialKey(state: TutorialRuntimeState) {
  const primary = findTutorialPrimaryCredentialKey(state);
  if (!primary) return null;

  const sameCredentialOtherKey =
    primary.credential.keys.find((key) => key.id !== primary.key.id && key.apiKey.trim()) ?? null;
  if (sameCredentialOtherKey) {
    return {
      credential: primary.credential,
      key: sameCredentialOtherKey
    };
  }

  const otherCredential =
    state.credentials.find((entry) => entry.id !== primary.credential.id && entry.preset !== "chrome_prompt" && entry.keys.some((key) => key.apiKey.trim())) ?? null;
  if (!otherCredential) return null;
  const otherKey =
    otherCredential.keys.find((key) => state.credentialTestResults[key.id]?.ok === true) ??
    otherCredential.keys.find((key) => key.apiKey.trim()) ??
    null;
  if (!otherKey) return null;
  return { credential: otherCredential, key: otherKey };
}

function findTutorialAgentPrimaryInstance(state: TutorialRuntimeState, agent: AgentConfig) {
  if (!agent.loadBalancerId) return null;
  const loadBalancer = state.loadBalancers.find((entry) => entry.id === agent.loadBalancerId) ?? null;
  if (!loadBalancer) return null;
  const instance = loadBalancer.instances[0] ?? null;
  if (!instance) return null;
  const credential = state.credentials.find((entry) => entry.id === instance.credentialId) ?? null;
  return { loadBalancer, instance, credential };
}

function findTutorialAgentBase(state: TutorialRuntimeState) {
  return (
    state.agents.find((agent) => {
      if (isManagedMagiAgent(agent)) return false;
      const primary = findTutorialAgentPrimaryInstance(state, agent);
      return (
        !!primary &&
        primary.credential?.preset === "groq" &&
        normalizeCredentialUrl(primary.credential.endpoint) === "https://api.groq.com/openai/v1" &&
        primary.instance.model === TUTORIAL_PRIMARY_MODEL
      );
    }) ?? null
  );
}

function findTutorialAgent(state: TutorialRuntimeState) {
  const agent = findTutorialAgentBase(state);
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

function loadBalancerMatchesTutorialGroq(state: TutorialRuntimeState, loadBalancerName: string) {
  const loadBalancer = findLoadBalancerByName(state, loadBalancerName);
  const firstInstance = loadBalancer?.instances[0];
  if (!loadBalancer || !firstInstance) return false;
  const credential = state.credentials.find((entry) => entry.id === firstInstance.credentialId) ?? null;
  return (
    credential?.preset === "groq" &&
    normalizeCredentialUrl(credential.endpoint) === "https://api.groq.com/openai/v1" &&
    firstInstance.model === TUTORIAL_PRIMARY_MODEL
  );
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

function findTutorialChatgptBrowserSkill(state: TutorialRuntimeState) {
  return (
    state.skills.find((skill) => skill.rootPath === TUTORIAL_CHATGPT_BROWSER_SKILL_ROOT) ??
    state.skills.find((skill) => skill.name === TUTORIAL_CHATGPT_BROWSER_SKILL_NAME) ??
    null
  );
}

function findTutorialMcpServer(state: TutorialRuntimeState) {
  return state.mcpServers.find((server) => server.name === TUTORIAL_MCP_NAME) ?? null;
}

function findTutorialAgentByPreset(state: TutorialRuntimeState, preset?: "tutorial_agent" | "tutorial_agent_base") {
  if (preset === "tutorial_agent") return findTutorialAgent(state);
  if (preset === "tutorial_agent_base") return findTutorialAgentBase(state);
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

function findAssistantTurnAfterPrompt(history: TutorialRuntimeState["history"], prompt: string) {
  const lastPromptIndex = [...history].reverse().findIndex((item) => item.role === "user" && item.content.trim() === prompt);
  const actualPromptIndex = lastPromptIndex >= 0 ? history.length - 1 - lastPromptIndex : -1;
  if (actualPromptIndex < 0) {
    return {
      promptIndex: -1,
      nextUserIndex: -1,
      assistantIndex: -1,
      assistant: null as TutorialRuntimeState["history"][number] | null,
      assistantIds: [] as string[]
    };
  }
  const relativeNextUserIndex = history.slice(actualPromptIndex + 1).findIndex((item) => item.role === "user");
  const nextUserIndex = relativeNextUserIndex >= 0 ? actualPromptIndex + 1 + relativeNextUserIndex : history.length;
  const turnMessages = history.slice(actualPromptIndex + 1, nextUserIndex);
  const assistantIndexes = turnMessages
    .map((item, offset) => ({ item, index: actualPromptIndex + 1 + offset }))
    .filter(({ item }) => item.role === "assistant" && item.content.trim().length > 0)
    .map(({ index }) => index);
  const assistantIndex = assistantIndexes.length > 0 ? assistantIndexes[assistantIndexes.length - 1] : -1;
  if (assistantIndex < 0) {
    return {
      promptIndex: actualPromptIndex,
      nextUserIndex,
      assistantIndex: -1,
      assistant: null as TutorialRuntimeState["history"][number] | null,
      assistantIds: [] as string[]
    };
  }
  return {
    promptIndex: actualPromptIndex,
    nextUserIndex,
    assistantIndex,
    assistant: history[assistantIndex] ?? null,
    assistantIds: assistantIndexes.map((index) => history[index]?.id).filter((id): id is string => !!id)
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

function collectTurnToolMessages(history: TutorialRuntimeState["history"], promptIndex: number, nextUserIndex: number) {
  if (promptIndex < 0) return [] as TutorialRuntimeState["history"];
  return history
    .slice(promptIndex + 1, nextUserIndex >= 0 ? nextUserIndex : history.length)
    .filter((item): item is TutorialRuntimeState["history"][number] => item.role === "tool");
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
  const { promptIndex, nextUserIndex, assistantIndex, assistant, assistantIds } = prompt
    ? findAssistantTurnAfterPrompt(state.history, prompt)
    : {
        promptIndex: -1,
        nextUserIndex: -1,
        assistantIndex: -1,
        assistant: null as TutorialRuntimeState["history"][number] | null,
        assistantIds: [] as string[]
      };
  const adjacentToolMessages = assistantIndex >= 0 ? collectAdjacentToolMessages(state.history, assistantIndex) : [];
  const turnToolMessages = promptIndex >= 0 ? collectTurnToolMessages(state.history, promptIndex, nextUserIndex) : [];
  const toolMessages = adjacentToolMessages.length > 0 ? adjacentToolMessages : turnToolMessages;
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

  if (assistant && expect?.assistantContentIncludesAny?.length) {
    const matched = expect.assistantContentIncludesAny.some((token) => assistant.content.includes(token));
    if (!matched) {
      issues.push(`已收到回覆，但還沒有出現這些預期內容中的任一項：${expect.assistantContentIncludesAny.join("、")}。`);
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

  if (assistant && expect?.successfulToolMessageIncludesAny?.length) {
    const matched = expect.successfulToolMessageIncludesAny.some((token) => {
      const item = toolMessages.find((entry) => entry.content.includes(token));
      return toolMessageSucceeded(item);
    });
    if (!matched) {
      issues.push(`已收到回覆，但還沒有看到這些成功工具調用中的任一項：${expect.successfulToolMessageIncludesAny.join("、")}。`);
    }
  }

  if (
    assistant &&
    expect?.requireOpenedToolResult &&
    !assistantIds.some((assistantId) => state.openedToolResultMessageIds.includes(assistantId))
  ) {
    issues.push("已收到回覆，請再展開「查看 tool result」完成驗證。");
  }

  if (assistant && expect?.skillTraceIncludes?.length) {
    const missing = expect.skillTraceIncludes.filter((path) => !hasSkillTracePath(assistant, path));
    if (missing.length) {
      issues.push(`已收到回覆，但 skill trace 尚未顯示：${missing.join("、")}。`);
    }
  }

  if (assistant && expect?.skillTraceIncludesAny?.length) {
    const matched = expect.skillTraceIncludesAny.some((path) => hasSkillTracePath(assistant, path));
    if (!matched) {
      issues.push(`已收到回覆，但 skill trace 還沒有出現這些內容中的任一項：${expect.skillTraceIncludesAny.join("、")}。`);
    }
  }

  if (assistant && expect?.skillLoadContainsAny?.length && !hasSkillLoaded(assistant, expect.skillLoadContainsAny)) {
    issues.push("已收到回覆，但還沒有看到這個案例預期的 skill load 紀錄。");
  }

  if (assistant && expect?.requireSkillTodo && !(assistant.skillTodo && assistant.skillTodo.length > 0)) {
    issues.push("已收到回覆，但還沒有看到 multi-turn todo 面板資料。");
  }

  if (
    assistant &&
    expect?.requireSkillTodoProgress &&
    !(assistant.skillTodo && assistant.skillTodo.some((item) => item.status !== "pending"))
  ) {
    issues.push("已收到回覆，但 multi-turn todo 尚未出現進度變化。");
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
      const success = groq ? groq.keys.some((key) => state.credentialTestResults[key.id]?.ok === true) : false;
      return {
        completed: success,
        targetId: step.targetId ?? "credentials-modal",
        canContinue: success,
        statusText: success ? "Groq provider 已測試成功。" : "請先新增 Groq credential，填入 API key 並完成連線測試。"
      };
    }
    case "create_single_load_balancer": {
      const loadBalancer = findLoadBalancerByName(state, TUTORIAL_PRIMARY_LOAD_BALANCER_NAME);
      const completed = !!loadBalancer && loadBalancer.instances.length >= 1 && loadBalancerMatchesTutorialGroq(state, TUTORIAL_PRIMARY_LOAD_BALANCER_NAME);
      return {
        completed,
        targetId: step.targetId ?? "chat-config-load-balancer-card",
        canContinue: completed,
        statusText: completed
          ? `已建立單一 instance load balancer：${loadBalancer?.name}`
          : `請建立「教學用Load Balancer 1」，至少加入 1 個 instance，並使用 Groq credential + ${TUTORIAL_PRIMARY_MODEL}。`
      };
    }
    case "create_groq_agent": {
      const agent = findTutorialAgent(state);
      const baseAgent = findTutorialAgentBase(state);
      const singleLoadBalancer = findLoadBalancerByName(state, TUTORIAL_PRIMARY_LOAD_BALANCER_NAME);
      const usesSingleLoadBalancer = !!baseAgent && !!singleLoadBalancer && baseAgent.loadBalancerId === singleLoadBalancer.id;
      return {
        completed: !!agent && usesSingleLoadBalancer,
        targetId: typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]') ? "agent-edit-modal" : "agents-add-button",
        canContinue: !!agent && usesSingleLoadBalancer,
        statusText: agent && usesSingleLoadBalancer
          ? `已建立 Agent：${agent.name}`
          : baseAgent
          ? "已建立 Agent，但請確認它綁定的是「教學用Load Balancer 1」，且 Access Control 全部保持未勾選。"
          : "請新增 Agent，並將 Load Balancer 設為「教學用Load Balancer 1」，再按 Save。"
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
    case "create_multi_load_balancer": {
      const loadBalancer = findLoadBalancerByName(state, TUTORIAL_SECONDARY_LOAD_BALANCER_NAME);
      const primary = findTutorialPrimaryCredentialKey(state);
      const secondary = findTutorialSecondaryCredentialKey(state);
      const completed =
        !!loadBalancer &&
        loadBalancer.instances.length >= 3 &&
        !!primary &&
        !!secondary &&
        loadBalancer.instances[0]?.credentialId === primary.credential.id &&
        loadBalancer.instances[0]?.credentialKeyId === primary.key.id &&
        loadBalancer.instances[0]?.model === TUTORIAL_PRIMARY_MODEL &&
        loadBalancer.instances[1]?.credentialId === primary.credential.id &&
        loadBalancer.instances[1]?.credentialKeyId === primary.key.id &&
        loadBalancer.instances[1]?.model === TUTORIAL_SECONDARY_MODEL &&
        loadBalancer.instances[2]?.model === TUTORIAL_PRIMARY_MODEL &&
        (loadBalancer.instances[2]?.credentialId !== primary.credential.id ||
          loadBalancer.instances[2]?.credentialKeyId !== primary.key.id);
      return {
        completed,
        targetId: step.targetId ?? "chat-config-credentials-card",
        canContinue: completed,
        statusText: completed
          ? `已建立多 instance load balancer：${loadBalancer?.name}`
          : !secondary
          ? "請先回到 Credentials，新增第二把 key 或另一個可用 provider。系統偵測到後會自動建立「教學用Load Balancer 2」。"
          : "系統正在根據你的 credentials 自動建立「教學用Load Balancer 2」。"
      };
    }
    case "switch_tutorial_agent_to_multi_load_balancer": {
      const loadBalancer = findLoadBalancerByName(state, TUTORIAL_SECONDARY_LOAD_BALANCER_NAME);
      const agent = findTutorialAgentBase(state);
      const completed = !!agent && !!loadBalancer && agent.loadBalancerId === loadBalancer.id;
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? `目前 Agent 已切換到 ${loadBalancer?.name}`
          : "請編輯目前 Agent，將 Load Balancer 改成「教學用Load Balancer 2」。"
      };
    }
    case "create_tutorial_doc": {
      const doc = state.docs.find((item) => item.title === TUTORIAL_DOC_NAME);
      const contentOk = !!doc && doc.content.trim() === TUTORIAL_DOC_CONTENT;
      return {
        completed: contentOk,
        targetId: step.targetId ?? "chat-config-docs-card",
        canContinue: contentOk,
        statusText: contentOk
          ? `已建立文件：${doc?.title}`
          : "系統正在建立教學用DOC。"
      };
    }
    case "enable_tutorial_doc_access": {
      const agent = findTutorialAgentBase(state);
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
        tool.description.trim() === TUTORIAL_TIME_TOOL_DESCRIPTION &&
        JSON.stringify(tool.inputSchema ?? {}) === JSON.stringify(TUTORIAL_TIME_TOOL_INPUT_SCHEMA) &&
        tool.code.trim() === TUTORIAL_TIME_TOOL_CODE.trim();
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="built-in-tools-modal"]')
            ? "built-in-tools-add-button"
            : step.targetId ?? "chat-config-tools-card",
        canContinue: completed,
        statusText: completed
          ? `已建立工具：${tool?.name}`
          : "系統正在建立教學用時鐘工具。"
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
          : "請前往 Chat Config > History，將 Messages sent to model 改成 1。"
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
      const agent = findTutorialAgentBase(state);
      const timeTool = findTutorialTimeTool(state);
      const builtInEnabled = !!agent && agent.enableBuiltInTools === true;
      const allowAllBuiltIns = !!agent && agent.allowedBuiltInToolIds === undefined;
      const hasTimeTool =
        !!timeTool &&
        !!agent &&
        (allowAllBuiltIns || !!agent.allowedBuiltInToolIds?.includes(timeTool.id));
      const hasProfileTool =
        !!agent &&
        (allowAllBuiltIns || !!agent.allowedBuiltInToolIds?.includes(SYSTEM_USER_PROFILE_TOOL_ID));
      const completed = builtInEnabled && hasTimeTool && hasProfileTool;
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? "目前 Agent 已允許使用教學用時鐘工具與 get_user_profile。"
          : "請在 Agent 的 Built-in Tools 中允許全部工具，或至少允許教學用時鐘工具與 get_user_profile。"
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
    case "ensure_tutorial_chatgpt_browser_skill": {
      const skill = findTutorialChatgptBrowserSkill(state);
      const completed =
        !!skill &&
        skill.docCount >= 1 &&
        skill.assetCount >= 1 &&
        skill.skillMarkdown.includes(TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH) &&
        skill.skillMarkdown.includes(TUTORIAL_CHATGPT_BROWSER_ASSET_PATH);
      return {
        completed,
        targetId: step.targetId ?? "chat-config-skills-card",
        canContinue: completed,
        statusText: completed
          ? `已建立教學 skill：${skill?.name}`
          : "系統正在建立教學用 Browser workflow multi-turn skill，完成後即可前往下一步。"
      };
    }
    case "enable_tutorial_skill_access": {
      const agent = findTutorialAgentBase(state);
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
    case "enable_tutorial_chatgpt_browser_skill_access": {
      const agent = findTutorialAgentBase(state);
      const skill = findTutorialChatgptBrowserSkill(state);
      const builtInReady =
        !!agent &&
        agent.enableBuiltInTools === true &&
        (agent.allowedBuiltInToolIds === undefined || agent.allowedBuiltInToolIds.includes(SYSTEM_REQUEST_CONFIRMATION_TOOL_ID));
      const mcpReady = !!agent && agent.enableMcp === true;
      const completed =
        !!agent &&
        !!skill &&
        agent.enableSkills === true &&
        (agent.allowedSkillIds === undefined || agent.allowedSkillIds.includes(skill.id)) &&
        builtInReady &&
        mcpReady;
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? `目前 Agent 已允許使用 skill：${skill?.name}，且可使用所需的 MCP / Built-in Tools。`
          : "請到 Agents 頁編輯目前 Agent，開啟 Skills，並允許使用這個 Browser workflow multi-turn skill；啟用 Skills 後，MCP 與 Built-in Tools 應維持允許全部。"
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
    case "first_chat_skill_chatgpt_open": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，讓 multi-turn skill 使用 browser_open 打開目標網站。"
      };
    }
    case "first_chat_skill_chatgpt_ask": {
      return {
        completed: false,
        targetId: step.targetId ?? "chat-input",
        canContinue: false,
        statusText: step.completionLabel ?? "請送出指定問題，讓 multi-turn skill 完成開站、導航、點擊與內容摘要。"
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
      const agent = findTutorialAgentBase(state);
      const server = findTutorialMcpServer(state);
      const mcpOnlyMode = state.scenarioId === "agent-browser-mcp-chat";
      const completed =
        !!agent &&
        !!server &&
        agent.enableMcp === true &&
        (agent.allowedMcpServerIds === undefined || agent.allowedMcpServerIds.includes(server.id)) &&
        (!mcpOnlyMode || (agent.enableDocs !== true && agent.enableBuiltInTools !== true && agent.enableSkills !== true));
      return {
        completed,
        targetId:
          typeof document !== "undefined" && document.querySelector('[data-tutorial-id="agent-edit-modal"]')
            ? "agent-edit-modal"
            : "agents-edit-active-button",
        canContinue: completed,
        statusText: completed
          ? mcpOnlyMode
            ? "目前 Agent 已只開啟教學用MCP 權限。"
            : "目前 Agent 已允許使用教學用MCP。"
          : mcpOnlyMode
          ? "請到 Agents 頁編輯目前 Agent，只開啟 MCP 權限，並允許使用教學用MCP。Docs、Built-in Tools、Skills 請維持關閉。"
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

  let targetAgentId: string | null = null;
  if (step.automation?.activeAgentPreset) {
    const agent = findTutorialAgentByPreset(state, step.automation.activeAgentPreset);
    if (agent) {
      targetAgentId = agent.id;
      controller.setActiveAgentId(agent.id);
      controller.setSelectedAgentId(agent.id);
    }
  } else {
    targetAgentId = state.agents.find((agent) => agent.id === state.activeAgentId)?.id ?? null;
  }

  if (step.automation?.skillExecutionMode) {
    controller.setSkillExecutionMode(step.automation.skillExecutionMode);
  }
  if (typeof step.automation?.skillVerifyMax === "number") {
    controller.setSkillVerifyMax(step.automation.skillVerifyMax);
  }
  if (typeof step.automation?.skillToolLoopMax === "number") {
    controller.setSkillToolLoopMax(step.automation.skillToolLoopMax);
  }
  if (
    targetAgentId &&
    (typeof step.automation?.loadBalancerDelaySecond === "number" || typeof step.automation?.loadBalancerMaxRetries === "number")
  ) {
    controller.setAgentLoadBalancerRetryPolicy(targetAgentId, {
      delaySecond: step.automation?.loadBalancerDelaySecond,
      maxRetries: step.automation?.loadBalancerMaxRetries
    });
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
    case "switch_tutorial_agent_to_multi_load_balancer":
      break;
    case "create_single_load_balancer":
      controller.ensureTutorialPrimaryLoadBalancer();
      break;
    case "create_multi_load_balancer":
      controller.ensureTutorialSecondaryLoadBalancer();
      break;
    case "create_tutorial_doc":
      controller.ensureTutorialDoc();
      break;
    case "create_tutorial_time_tool":
      controller.ensureTutorialTimeTool();
      break;
    case "set_history_limit_to_one":
    case "fill_tutorial_user_profile":
      break;
    case "enable_tutorial_doc_access": {
      const agent = findTutorialAgentBase(state);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      break;
    }
    case "enable_tutorial_builtin_tool_access": {
      const agent = findTutorialAgentBase(state);
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
    case "ensure_tutorial_chatgpt_browser_skill": {
      controller.setActiveTab("chat_config");
      controller.setSkillExecutionMode("multi_turn");
      controller.ensureTutorialChatgptBrowserSkill();
      controller.ensureTutorialAgentBrowserMcpTools();
      break;
    }
    case "enable_tutorial_skill_access": {
      controller.setActiveTab("agents");
      controller.setSkillExecutionMode("single_turn");
      const agent = findTutorialAgentBase(state);
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
    case "enable_tutorial_chatgpt_browser_skill_access": {
      controller.setActiveTab("agents");
      controller.setSkillExecutionMode("multi_turn");
      const agent = findTutorialAgentBase(state);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      controller.ensureTutorialAgentBrowserMcpTools();
      break;
    }
    case "first_chat_skill_chatgpt_open":
    case "first_chat_skill_chatgpt_ask":
      controller.ensureTutorialAgentBrowserMcpTools();
      break;
    case "register_tutorial_agent_browser_mcp":
      controller.setActiveTab("chat_config");
      controller.ensureTutorialAgentBrowserMcpTools();
      break;
    case "enable_tutorial_mcp_access": {
      controller.setActiveTab("agents");
      const agent = findTutorialAgentBase(state);
      if (agent) {
        controller.setActiveAgentId(agent.id);
        controller.setSelectedAgentId(agent.id);
      }
      controller.ensureTutorialAgentBrowserMcpTools();
      break;
    }
    case "first_chat_mcp_browser_open":
    case "first_chat_mcp_browser_snapshot":
      controller.ensureTutorialAgentBrowserMcpTools();
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
