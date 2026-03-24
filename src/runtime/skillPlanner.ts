import { LoadedSkillRuntime, SkillCompletionDecision, SkillConfig, SkillStepDecision } from "../types";

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
}) {
  return [
    "Return JSON only. Do not add any other text.",
    "",
    "Create a short internal todo plan for a multi-turn skill workflow.",
    "Generate 3 to 7 concise todo items. Each item should represent a meaningful user-visible or workflow-visible milestone.",
    "",
    `Skill: ${args.skill.name} (${args.skill.id})`,
    args.skill.description ? `Skill description: ${args.skill.description}` : "",
    args.runtime.instructions ? `Internal workflow:\n${compactBlock(args.runtime.instructions, 1600)}` : "",
    "",
    "User request:",
    args.userInput,
    "",
    'Return: {"todo":["...","..."]}'
  ]
    .filter(Boolean)
    .join("\n");
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

  return [
    "Return JSON only. Do not add any other text.",
    "",
    "You are the internal planner for a multi-turn skill runtime.",
    "Choose the next step conservatively. Do not answer the user directly.",
    "Prefer the smallest next action that visibly advances the workflow.",
    "If the current context already contains a usable page/session/result, do not reset the workflow by repeating the same open action unless the context clearly shows the state is gone or invalid.",
    "If the current context contains interactive targets, form fields, suggestions, or submit controls, prefer act over another observe.",
    "If the current context explicitly says the requested feature is unavailable for the current device, region, or account, and no reasonable tool step can recover from that, choose finish instead of looping.",
    "If the current context shows login, verification, or consent that a human can reasonably resolve, choose ask_user instead of finishing immediately.",
    "",
    `Skill: ${args.skill.name} (${args.skill.id})`,
    args.skill.description ? `Skill description: ${args.skill.description}` : "",
    args.runtime.instructions ? `Internal workflow:\n${compactBlock(args.runtime.instructions, 1400)}` : "",
    "",
    "User request:",
    args.userInput,
    "",
    "Current todo state:",
    args.todoSummary,
    "",
    "Current internal context:",
    compactBlock(args.currentContext, 2200),
    "",
    "Available tools:",
    args.toolScopeSummary,
    "",
    args.mustObserve ? "Constraint: the next step must be observe or ask_user because the previous action changed state." : "",
    args.mustAct ? "Constraint: repeated observation did not advance the workflow; the next step must be act or ask_user." : "",
    args.currentPhaseHint ? `Runtime hint:\n${args.currentPhaseHint}` : "",
    "",
    ...allowedOutputs
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCompletionGatePrompt(args: {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  currentContext: string;
  todoSummary: string;
}) {
  return [
    "Return JSON only. Do not add any other text.",
    "",
    "Check whether the internal multi-turn skill workflow has truly completed the user's task.",
    "Be conservative. Opening a page, observing a page, or typing text is not enough by itself.",
    "If the current context explicitly says the requested feature is unavailable for the current device, region, or account, you may treat that as a justified blocked/manual stop and return complete.",
    "",
    `Skill: ${args.skill.name} (${args.skill.id})`,
    args.skill.description ? `Skill description: ${args.skill.description}` : "",
    args.runtime.instructions ? `Internal workflow:\n${compactBlock(args.runtime.instructions, 1200)}` : "",
    "",
    "User request:",
    args.userInput,
    "",
    "Current todo state:",
    args.todoSummary,
    "",
    "Current internal context:",
    compactBlock(args.currentContext, 1800),
    "",
    'If the task is complete or is at a justified blocked/manual stop, return: {"type":"complete","reason":"...","todoIds":["..."]}',
    'If more work is still needed, return: {"type":"incomplete","reason":"...","suggestedFocus":"...","todoIds":["..."]}'
  ]
    .filter(Boolean)
    .join("\n");
}
