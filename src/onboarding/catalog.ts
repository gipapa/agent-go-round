import { parse } from "yaml";
import { TutorialScenarioDefinition, TutorialStepBehaviorId, TutorialStepDefinition } from "./types";
import docsPersonaChatRaw from "./tutorials/docs-persona-chat.yaml?raw";
import firstAgentChatRaw from "./tutorials/first-agent-chat.yaml?raw";
import builtInToolsChatRaw from "./tutorials/built-in-tools-chat.yaml?raw";

type TutorialCatalogIssue = {
  scenarioId: string;
  message: string;
};

function normalizeStep(input: any): TutorialStepDefinition {
  if (!input || typeof input !== "object") {
    throw new Error("Tutorial step must be an object.");
  }
  const behavior = String(input.behavior ?? "").trim() as TutorialStepBehaviorId;
  if (!behavior) {
    throw new Error(`Tutorial step "${String(input.id ?? "")}" is missing behavior.`);
  }

  return {
    id: String(input.id ?? "").trim(),
    title: String(input.title ?? "").trim(),
    checklistLabel: String(input.checklistLabel ?? input.title ?? "").trim(),
    instructionTitle: String(input.instructionTitle ?? input.title ?? "").trim(),
    instructionBody: String(input.instructionBody ?? "").trim(),
    actionLabel: typeof input.actionLabel === "string" ? input.actionLabel : undefined,
    completionLabel: typeof input.completionLabel === "string" ? input.completionLabel : undefined,
    tab: typeof input.tab === "string" ? input.tab : undefined,
    targetId: typeof input.targetId === "string" ? input.targetId : undefined,
    behavior
  };
}

function normalizeScenario(input: any): TutorialScenarioDefinition {
  if (!input || typeof input !== "object") {
    throw new Error("Tutorial scenario must be an object.");
  }
  const steps = Array.isArray(input.steps) ? input.steps.map(normalizeStep) : [];
  if (!steps.length) {
    throw new Error(`Tutorial scenario "${String(input.id ?? "")}" must include steps.`);
  }

  return {
    id: String(input.id ?? "").trim(),
    title: String(input.title ?? "").trim(),
    description: String(input.description ?? "").trim(),
    exitTitle: String(input.exitTitle ?? "離開案例教學").trim(),
    exitBody: String(input.exitBody ?? "").trim(),
    steps
  };
}

function parseScenario(raw: string) {
  return normalizeScenario(parse(raw));
}

const tutorialCatalogIssues: TutorialCatalogIssue[] = [];

function safeParseScenario(raw: string, scenarioId: string) {
  try {
    return parseScenario(raw);
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
  safeParseScenario(builtInToolsChatRaw, "built-in-tools-chat")
].filter((scenario): scenario is TutorialScenarioDefinition => !!scenario);

export function getTutorialScenario(id: string) {
  return tutorialCatalog.find((scenario) => scenario.id === id) ?? null;
}

export function getTutorialCatalogError(id: string) {
  return tutorialCatalogIssues.find((issue) => issue.scenarioId === id)?.message ?? null;
}
