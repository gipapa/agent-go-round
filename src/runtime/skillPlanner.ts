import { LoadedSkillRuntime, SkillCompletionDecision, SkillConfig, SkillStepDecision } from "../types";
import { getDefaultPromptTemplate } from "../promptTemplates/store";
import { SkillCompletionDecisionSchema, SkillStepDecisionSchema } from "../schemas/decisions";

function compactBlock(text: string | undefined, maxChars: number) {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (!normalized) return "";
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeSkillStepDecision(obj: unknown): SkillStepDecision | null {
  const result = SkillStepDecisionSchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeSkillCompletionDecision(obj: unknown): SkillCompletionDecision | null {
  const result = SkillCompletionDecisionSchema.safeParse(obj);
  return result.success ? result.data : null;
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
