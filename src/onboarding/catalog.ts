import { TutorialScenarioDefinition } from "./types";
import { parseTutorialScenario } from "./catalogCore";
import docsPersonaChatRaw from "./tutorials/docs-persona-chat.yaml?raw";
import firstAgentChatRaw from "./tutorials/first-agent-chat.yaml?raw";
import builtInToolsChatRaw from "./tutorials/built-in-tools-chat.yaml?raw";
import sequentialSkillChatRaw from "./tutorials/sequential-skill-chat.yaml?raw";
import agentBrowserMcpChatRaw from "./tutorials/agent-browser-mcp-chat.yaml?raw";
import chatgptBrowserSkillRaw from "./tutorials/chatgpt-browser-skill.yaml?raw";

type TutorialCatalogIssue = {
  scenarioId: string;
  message: string;
};

const tutorialCatalogIssues: TutorialCatalogIssue[] = [];

function safeParseScenario(raw: string, scenarioId: string) {
  try {
    return parseTutorialScenario(raw);
  } catch (error: any) {
    tutorialCatalogIssues.push({
      scenarioId,
      message: String(error?.message ?? error ?? "Unknown tutorial parsing error")
    });
    return null;
  }
}

export const tutorialCatalog: TutorialScenarioDefinition[] = [
  safeParseScenario(firstAgentChatRaw, "first-agent-chat"),
  safeParseScenario(docsPersonaChatRaw, "docs-persona-chat"),
  safeParseScenario(builtInToolsChatRaw, "built-in-tools-chat"),
  safeParseScenario(sequentialSkillChatRaw, "sequential-skill-chat"),
  safeParseScenario(agentBrowserMcpChatRaw, "agent-browser-mcp-chat"),
  safeParseScenario(chatgptBrowserSkillRaw, "chatgpt-browser-skill")
].filter((scenario): scenario is TutorialScenarioDefinition => !!scenario);

export function getTutorialScenario(id: string) {
  return tutorialCatalog.find((scenario) => scenario.id === id) ?? null;
}

export function getTutorialCatalogError(id: string) {
  return tutorialCatalogIssues.find((issue) => issue.scenarioId === id)?.message ?? null;
}
