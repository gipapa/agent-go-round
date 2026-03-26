import { parse } from "yaml";
import { TutorialScenarioDefinition, TutorialStepAutomation, TutorialStepBehaviorId, TutorialStepDefinition } from "./types";

function normalizeStringArray(input: unknown) {
  return Array.isArray(input) ? input.map((item) => String(item ?? "").trim()).filter(Boolean) : undefined;
}

function normalizeAutomation(input: any): TutorialStepAutomation | undefined {
  if (!input || typeof input !== "object") return undefined;
  const expectInput = input.expect && typeof input.expect === "object" ? input.expect : undefined;
  const automation: TutorialStepAutomation = {
    composerSeed: typeof input.composerSeed === "string" ? input.composerSeed.trim() : undefined,
    clearChatOnEnter: input.clearChatOnEnter === true,
    skillExecutionMode: input.skillExecutionMode === "multi_turn" ? "multi_turn" : input.skillExecutionMode === "single_turn" ? "single_turn" : undefined,
    skillVerifyMax: typeof input.skillVerifyMax === "number" ? input.skillVerifyMax : undefined,
    skillToolLoopMax: typeof input.skillToolLoopMax === "number" ? input.skillToolLoopMax : undefined,
    loadBalancerDelaySecond: typeof input.loadBalancerDelaySecond === "number" ? input.loadBalancerDelaySecond : undefined,
    loadBalancerMaxRetries: typeof input.loadBalancerMaxRetries === "number" ? input.loadBalancerMaxRetries : undefined,
    activeAgentPreset:
      input.activeAgentPreset === "tutorial_agent" || input.activeAgentPreset === "tutorial_agent_base"
        ? input.activeAgentPreset
        : undefined,
    expect: expectInput
      ? {
          userPrompt: typeof expectInput.userPrompt === "string" ? expectInput.userPrompt.trim() : undefined,
          requireAssistant: expectInput.requireAssistant !== false,
          assistantContentIncludes: normalizeStringArray(expectInput.assistantContentIncludes),
          assistantContentIncludesAny: normalizeStringArray(expectInput.assistantContentIncludesAny),
          successfulToolMessageIncludes: normalizeStringArray(expectInput.successfulToolMessageIncludes),
          successfulToolMessageIncludesAny: normalizeStringArray(expectInput.successfulToolMessageIncludesAny),
          requireOpenedToolResult: expectInput.requireOpenedToolResult === true,
          skillTraceIncludes: normalizeStringArray(expectInput.skillTraceIncludes),
          skillTraceIncludesAny: normalizeStringArray(expectInput.skillTraceIncludesAny),
          skillLoadContainsAny: normalizeStringArray(expectInput.skillLoadContainsAny),
          requireSkillTodo: expectInput.requireSkillTodo === true,
          requireSkillTodoProgress: expectInput.requireSkillTodoProgress === true
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
    behavior,
    automation: normalizeAutomation(input.automation)
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

export function parseTutorialScenario(raw: string) {
  return normalizeScenario(parse(raw));
}
