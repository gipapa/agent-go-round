import { ChatTraceEntry, LoadedSkillRuntime, SkillConfig, SkillExecutionMode } from "../types";
import { pushSkillTrace } from "./skillRuntime";
import { getDefaultPromptTemplate } from "../promptTemplates/store";

export type SkillVerifyDecision =
  | { type: "pass"; reason?: string }
  | { type: "refine"; reason: string; revisionPrompt?: string };

export function clampSkillVerifyMax(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(5, Math.round(value)));
}

export function clampSkillToolLoopMax(value: number) {
  if (!Number.isFinite(value)) return 6;
  return Math.max(0, Math.min(12, Math.round(value)));
}

export function buildSkillExecutionModeTrace(args: {
  mode: SkillExecutionMode;
  verifyMax: number;
  toolLoopMax?: number;
  verifierName?: string;
}) {
  const lines = [
    `執行模式：${args.mode === "multi_turn" ? "多輪 skill refine" : "單輪 skill"}`,
    args.mode === "multi_turn" ? `最多 verify 次數：${args.verifyMax}` : "單輪模式不做結果 refine。",
    args.mode === "multi_turn" ? `每輪最多工具步數：${args.toolLoopMax ?? 0}` : "",
    args.mode === "multi_turn" && args.verifierName ? `Verifier：${args.verifierName}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

export function pushSkillExecutionModeTrace(trace: ChatTraceEntry[], args: {
  mode: SkillExecutionMode;
  verifyMax: number;
  toolLoopMax?: number;
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
  template?: string;
}) {
  const baseTemplate = args.template?.trim() || getDefaultPromptTemplate("skill-verify.en");
  const loadedReferences = args.runtime.loadedReferences.length
    ? args.runtime.loadedReferences.map((doc) => `- ${doc.path}`).join("\n")
    : "none";
  const loadedAssets = args.runtime.loadedAssets.length
    ? args.runtime.loadedAssets.map((file) => `- ${file.path}`).join("\n")
    : "none";

  let prompt = baseTemplate
    .split("{{skillName}}")
    .join(args.skill.name)
    .split("{{skillId}}")
    .join(args.skill.id)
    .split("{{skillDescription}}")
    .join(args.skill.description || "")
    .split("{{runtimeInstructions}}")
    .join(args.runtime.instructions || "")
    .split("{{loadedReferences}}")
    .join(loadedReferences)
    .split("{{loadedAssets}}")
    .join(loadedAssets)
    .split("{{round}}")
    .join(String(args.round))
    .split("{{userInput}}")
    .join(args.userInput)
    .split("{{currentInput}}")
    .join(args.currentInput)
    .split("{{answer}}")
    .join(args.answer);

  if (!baseTemplate.includes('"type":"pass"')) {
    prompt += '\n\nIf the answer is acceptable, return: {"type":"pass","reason":"..."}';
  }
  if (!baseTemplate.includes('"type":"refine"')) {
    prompt += '\n\nIf refinement is needed, return: {"type":"refine","reason":"...","revisionPrompt":"..."}';
  }
  return prompt;
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
