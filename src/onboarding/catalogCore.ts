import { parse } from "yaml";
import {
  TutorialScenarioDefinition,
  TutorialStepAutomation,
  TutorialStepBehaviorId,
  TutorialStepDefinition,
  TutorialTab
} from "./types";

const TUTORIAL_TABS: TutorialTab[] = ["chat", "chat_config", "agents", "profile"];

function normalizeStringArray(input: unknown) {
  return Array.isArray(input) ? input.map((item) => String(item ?? "").trim()).filter(Boolean) : undefined;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

function normalizeTutorialTab(input: unknown): TutorialTab | undefined {
  return typeof input === "string" && TUTORIAL_TABS.includes(input as TutorialTab) ? (input as TutorialTab) : undefined;
}

function normalizeAutomation(input: unknown): TutorialStepAutomation | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const expectInput = asRecord(record.expect);
  const automation: TutorialStepAutomation = {
    composerSeed: typeof record.composerSeed === "string" ? record.composerSeed.trim() : undefined,
    clearChatOnEnter: record.clearChatOnEnter === true,
    skillExecutionMode: record.skillExecutionMode === "multi_turn" ? "multi_turn" : record.skillExecutionMode === "single_turn" ? "single_turn" : undefined,
    skillVerifyMax: typeof record.skillVerifyMax === "number" ? record.skillVerifyMax : undefined,
    skillToolLoopMax: typeof record.skillToolLoopMax === "number" ? record.skillToolLoopMax : undefined,
    loadBalancerDelaySecond: typeof record.loadBalancerDelaySecond === "number" ? record.loadBalancerDelaySecond : undefined,
    loadBalancerMaxRetries: typeof record.loadBalancerMaxRetries === "number" ? record.loadBalancerMaxRetries : undefined,
    activeAgentPreset:
      record.activeAgentPreset === "tutorial_agent" || record.activeAgentPreset === "tutorial_agent_base"
        ? record.activeAgentPreset
        : undefined,
    expect: expectInput
      ? {
          userPrompt: typeof expectInput.userPrompt === "string" ? expectInput.userPrompt.trim() : undefined,
          requireAssistant: expectInput.requireAssistant !== false,
          assistantContentIncludes: normalizeStringArray(expectInput.assistantContentIncludes),
          assistantContentIncludesAny: normalizeStringArray(expectInput.assistantContentIncludesAny),
          successfulToolMessageIncludes: normalizeStringArray(expectInput.successfulToolMessageIncludes),
          successfulToolMessageIncludesAny: normalizeStringArray(expectInput.successfulToolMessageIncludesAny),
          successfulToolNames: normalizeStringArray(expectInput.successfulToolNames),
          successfulToolNamesAny: normalizeStringArray(expectInput.successfulToolNamesAny),
          requireOpenedToolResult: expectInput.requireOpenedToolResult === true,
          skillTraceIncludes: normalizeStringArray(expectInput.skillTraceIncludes),
          skillTraceIncludesAny: normalizeStringArray(expectInput.skillTraceIncludesAny),
          skillLoadContainsAny: normalizeStringArray(expectInput.skillLoadContainsAny),
          requireSkillTodo: expectInput.requireSkillTodo === true,
          requireSkillTodoProgress: expectInput.requireSkillTodoProgress === true,
          requireSkillTodoTerminal: expectInput.requireSkillTodoTerminal === true
        }
      : undefined
  };

  if (
    !automation.composerSeed &&
    !automation.clearChatOnEnter &&
    !automation.skillExecutionMode &&
    automation.skillVerifyMax === undefined &&
    automation.skillToolLoopMax === undefined &&
    automation.loadBalancerDelaySecond === undefined &&
    automation.loadBalancerMaxRetries === undefined &&
    !automation.activeAgentPreset &&
    !automation.expect
  ) {
    return undefined;
  }

  return automation;
}

function normalizeStep(input: unknown): TutorialStepDefinition {
  const record = asRecord(input);
  if (!record) {
    throw new Error("Tutorial step must be an object.");
  }
  const behavior = String(record.behavior ?? "").trim() as TutorialStepBehaviorId;
  if (!behavior) {
    throw new Error(`Tutorial step "${String(record.id ?? "")}" is missing behavior.`);
  }

  return {
    id: String(record.id ?? "").trim(),
    title: String(record.title ?? "").trim(),
    checklistLabel: String(record.checklistLabel ?? record.title ?? "").trim(),
    instructionTitle: String(record.instructionTitle ?? record.title ?? "").trim(),
    instructionBody: String(record.instructionBody ?? "").trim(),
    actionLabel: typeof record.actionLabel === "string" ? record.actionLabel : undefined,
    completionLabel: typeof record.completionLabel === "string" ? record.completionLabel : undefined,
    tab: normalizeTutorialTab(record.tab),
    targetId: typeof record.targetId === "string" ? record.targetId : undefined,
    behavior,
    automation: normalizeAutomation(record.automation)
  };
}

function normalizeScenario(input: unknown): TutorialScenarioDefinition {
  const record = asRecord(input);
  if (!record) {
    throw new Error("Tutorial scenario must be an object.");
  }
  const steps = Array.isArray(record.steps) ? record.steps.map(normalizeStep) : [];
  if (!steps.length) {
    throw new Error(`Tutorial scenario "${String(record.id ?? "")}" must include steps.`);
  }

  return {
    id: String(record.id ?? "").trim(),
    title: String(record.title ?? "").trim(),
    description: String(record.description ?? "").trim(),
    exitTitle: String(record.exitTitle ?? "離開案例教學").trim(),
    exitBody: String(record.exitBody ?? "").trim(),
    steps
  };
}

export function parseTutorialScenario(raw: string) {
  return normalizeScenario(parse(raw));
}
