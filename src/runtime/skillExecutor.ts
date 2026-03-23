import { ChatTraceEntry, LoadedSkillRuntime, SkillConfig, SkillExecutionMode } from "../types";
import { pushSkillTrace } from "./skillRuntime";

export type SkillVerifyDecision =
  | { type: "pass"; reason?: string }
  | { type: "refine"; reason: string; revisionPrompt?: string };

export function clampSkillVerifyMax(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(5, Math.round(value)));
}

export function buildSkillExecutionModeTrace(args: {
  mode: SkillExecutionMode;
  verifyMax: number;
  verifierName?: string;
}) {
  const lines = [
    `執行模式：${args.mode === "multi_turn" ? "多輪 skill refine" : "單輪 skill"}`,
    args.mode === "multi_turn" ? `最多 verify 次數：${args.verifyMax}` : "單輪模式不做結果 refine。",
    args.mode === "multi_turn" && args.verifierName ? `Verifier：${args.verifierName}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

export function pushSkillExecutionModeTrace(trace: ChatTraceEntry[], args: {
  mode: SkillExecutionMode;
  verifyMax: number;
  verifierName?: string;
}) {
  pushSkillTrace(trace, "Skill executor", buildSkillExecutionModeTrace(args));
}

export function buildSkillVerifyPrompt(args: {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  currentInput: string;
  answer: string;
  round: number;
}) {
  return [
    "Return JSON only. Do not add any other text.",
    "",
    "You are verifying the result of an internal skill-assisted answer.",
    "Do not rewrite the answer unless refinement is necessary.",
    "",
    `Skill: ${args.skill.name} (${args.skill.id})`,
    args.skill.description ? `Skill description: ${args.skill.description}` : "",
    args.runtime.instructions ? `Internal skill workflow:\n${args.runtime.instructions}` : "",
    args.runtime.loadedReferences.length
      ? `Loaded skill references:\n${args.runtime.loadedReferences.map((doc) => `- ${doc.path}`).join("\n")}`
      : "Loaded skill references: none",
    args.runtime.loadedAssets.length
      ? `Loaded skill assets:\n${args.runtime.loadedAssets.map((file) => `- ${file.path}`).join("\n")}`
      : "Loaded skill assets: none",
    "",
    `Verification round: ${args.round}`,
    "",
    "Original user request:",
    args.userInput,
    "",
    "Current effective prompt sent to the answering agent:",
    args.currentInput,
    "",
    "Current answer:",
    args.answer,
    "",
    'If the answer is acceptable, return: {"type":"pass","reason":"..."}',
    "",
    'If refinement is needed, return: {"type":"refine","reason":"...","revisionPrompt":"..."}',
    "",
    "Use refine only when the answer clearly failed to follow the skill workflow, skipped necessary verification, or missed an obvious tool/reference usage opportunity."
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeSkillVerifyDecision(obj: any): SkillVerifyDecision | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "pass") {
    return { type: "pass", reason: typeof obj.reason === "string" ? obj.reason.trim() : undefined };
  }
  if (obj.type === "refine" && typeof obj.reason === "string" && obj.reason.trim()) {
    return {
      type: "refine",
      reason: obj.reason.trim(),
      revisionPrompt: typeof obj.revisionPrompt === "string" && obj.revisionPrompt.trim() ? obj.revisionPrompt.trim() : undefined
    };
  }
  return null;
}

export function buildSkillRefinementInput(args: {
  currentInput: string;
  verifyDecision: Extract<SkillVerifyDecision, { type: "refine" }>;
  round: number;
}) {
  return [
    args.currentInput,
    "",
    `[Skill self-refine round ${args.round}]`,
    `Verifier feedback: ${args.verifyDecision.reason}`,
    args.verifyDecision.revisionPrompt ? `Revision request:\n${args.verifyDecision.revisionPrompt}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
