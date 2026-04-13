import { LoadedSkillRuntime, SkillCompletionDecision, SkillConfig, SkillStepDecision } from "../types";
import { getDefaultPromptTemplate } from "../promptTemplates/store";

function compactBlock(text: string | undefined, maxChars: number) {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (!normalized) return "";
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeSkillStepDecision(obj: any): SkillStepDecision | null {
  if (!obj || typeof obj !== "object" || typeof obj.type !== "string") return null;
  const todoIds = Array.isArray(obj.todoIds) ? obj.todoIds.filter((v: unknown) => typeof v === "string" && v.trim()) : undefined;
  if (obj.type === "observe" && typeof obj.reason === "string" && obj.reason.trim()) {
    return { type: "observe", reason: obj.reason.trim(), todoIds };
  }
  if (
    obj.type === "act" &&
    typeof obj.reason === "string" &&
    obj.reason.trim() &&
    (obj.toolKind === "mcp" || obj.toolKind === "builtin") &&
    typeof obj.toolName === "string" &&
    obj.toolName.trim()
  ) {
    return {
      type: "act",
      reason: obj.reason.trim(),
      toolKind: obj.toolKind,
      toolName: obj.toolName.trim(),
      input: obj.input,
      todoIds
    };
  }
  if (obj.type === "ask_user" && typeof obj.reason === "string" && obj.reason.trim() && typeof obj.message === "string" && obj.message.trim()) {
    return { type: "ask_user", reason: obj.reason.trim(), message: obj.message.trim(), todoIds };
  }
  if (obj.type === "finish" && typeof obj.reason === "string" && obj.reason.trim()) {
    return { type: "finish", reason: obj.reason.trim(), todoIds };
  }
  return null;
}

export function normalizeSkillCompletionDecision(obj: any): SkillCompletionDecision | null {
  if (!obj || typeof obj !== "object" || typeof obj.type !== "string") return null;
  const todoIds = Array.isArray(obj.todoIds) ? obj.todoIds.filter((v: unknown) => typeof v === "string" && v.trim()) : undefined;
  if (obj.type === "complete") {
    return { type: "complete", reason: typeof obj.reason === "string" ? obj.reason.trim() : undefined, todoIds };
  }
  if (obj.type === "incomplete" && typeof obj.reason === "string" && obj.reason.trim()) {
    return {
      type: "incomplete",
      reason: obj.reason.trim(),
      suggestedFocus: typeof obj.suggestedFocus === "string" && obj.suggestedFocus.trim() ? obj.suggestedFocus.trim() : undefined,
      todoIds
    };
  }
  return null;
}

export function buildBootstrapPlanPrompt(args: {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  template?: string;
}) {
  const baseTemplate = args.template?.trim() || getDefaultPromptTemplate("skill-bootstrap-plan.en");
  let prompt = baseTemplate
    .split("{{skillName}}")
    .join(args.skill.name)
    .split("{{skillId}}")
    .join(args.skill.id)
    .split("{{skillDescription}}")
    .join(args.skill.description || "")
    .split("{{runtimeInstructions}}")
    .join(compactBlock(args.runtime.instructions, 1600))
    .split("{{userInput}}")
    .join(args.userInput);

  if (!baseTemplate.includes("{{userInput}}")) {
    prompt += `\n\nUser request:\n${args.userInput}`;
  }
  if (!baseTemplate.includes('"taskSummary"')) {
    prompt += '\n\nReturn: {"taskSummary":"...","startUrl":"https://... or empty string","todo":["...","..."]}';
  }
  return prompt;
}

export function buildPlannerStepPrompt(args: {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  currentContext: string;
  currentPhaseHint?: string;
  toolScopeSummary: string;
  todoSummary: string;
  mustObserve: boolean;
  mustAct: boolean;
  template?: string;
}) {
  const allowedOutputs = args.mustObserve
    ? [
        'Allowed outputs: {"type":"observe","reason":"...","todoIds":["..."]}',
        '{"type":"ask_user","reason":"...","message":"...","todoIds":["..."]}'
      ]
    : args.mustAct
      ? [
          'Allowed outputs: {"type":"act","reason":"...","toolKind":"mcp|builtin","toolName":"...","input":{},"todoIds":["..."]}',
          '{"type":"ask_user","reason":"...","message":"...","todoIds":["..."]}'
        ]
      : [
          'Allowed outputs: {"type":"observe","reason":"...","todoIds":["..."]}',
          '{"type":"act","reason":"...","toolKind":"mcp|builtin","toolName":"...","input":{},"todoIds":["..."]}',
          '{"type":"ask_user","reason":"...","message":"...","todoIds":["..."]}',
          '{"type":"finish","reason":"...","todoIds":["..."]}'
        ];

  const constraintBlock = [
    args.mustObserve ? "Constraint: the next step must be observe or ask_user because the previous action changed state." : "",
    args.mustAct ? "Constraint: repeated observation did not advance the workflow; the next step must be act or ask_user." : ""
  ]
    .filter(Boolean)
    .join("\n");

  const baseTemplate = args.template?.trim() || getDefaultPromptTemplate("skill-planner-step.en");
  let prompt = baseTemplate
    .split("{{skillName}}")
    .join(args.skill.name)
    .split("{{skillId}}")
    .join(args.skill.id)
    .split("{{skillDescription}}")
    .join(args.skill.description || "")
    .split("{{runtimeInstructions}}")
    .join(compactBlock(args.runtime.instructions, 1400))
    .split("{{userInput}}")
    .join(args.userInput)
    .split("{{todoSummary}}")
    .join(args.todoSummary)
    .split("{{currentContext}}")
    .join(compactBlock(args.currentContext, 2200))
    .split("{{toolScopeSummary}}")
    .join(args.toolScopeSummary)
    .split("{{constraintBlock}}")
    .join(constraintBlock)
    .split("{{currentPhaseHint}}")
    .join(args.currentPhaseHint ? `Runtime hint:\n${args.currentPhaseHint}` : "")
    .split("{{allowedOutputs}}")
    .join(allowedOutputs.join("\n"));

  if (!baseTemplate.includes("{{allowedOutputs}}")) {
    prompt += `\n\n${allowedOutputs.join("\n")}`;
  }
  return prompt;
}

export function buildCompletionGatePrompt(args: {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  currentContext: string;
  todoSummary: string;
  template?: string;
}) {
  const baseTemplate = args.template?.trim() || getDefaultPromptTemplate("skill-completion-gate.en");
  let prompt = baseTemplate
    .split("{{skillName}}")
    .join(args.skill.name)
    .split("{{skillId}}")
    .join(args.skill.id)
    .split("{{skillDescription}}")
    .join(args.skill.description || "")
    .split("{{runtimeInstructions}}")
    .join(compactBlock(args.runtime.instructions, 1200))
    .split("{{userInput}}")
    .join(args.userInput)
    .split("{{todoSummary}}")
    .join(args.todoSummary)
    .split("{{currentContext}}")
    .join(compactBlock(args.currentContext, 1800));

  if (!baseTemplate.includes('"type":"complete"')) {
    prompt += '\n\nIf the task is complete or is at a justified blocked/manual stop, return: {"type":"complete","reason":"...","todoIds":["..."]}';
  }
  if (!baseTemplate.includes('"type":"incomplete"')) {
    prompt += '\nIf more work is still needed, return: {"type":"incomplete","reason":"...","suggestedFocus":"...","todoIds":["..."]}';
  }
  return prompt;
}
