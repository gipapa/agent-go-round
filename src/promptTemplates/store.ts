import YAML from "yaml";
import { McpPromptTemplateKey, getDefaultMcpPromptTemplates, loadMcpPromptTemplates } from "../storage/settingsStore";
import toolDecisionZhRaw from "./defaults/tool-decision.zh.yaml?raw";
import toolDecisionEnRaw from "./defaults/tool-decision.en.yaml?raw";
import skillDecisionZhRaw from "./defaults/skill-decision.zh.yaml?raw";
import skillDecisionEnRaw from "./defaults/skill-decision.en.yaml?raw";
import skillRuntimeSystemZhRaw from "./defaults/skill-runtime-system.zh.yaml?raw";
import skillRuntimeSystemEnRaw from "./defaults/skill-runtime-system.en.yaml?raw";
import skillVerifyZhRaw from "./defaults/skill-verify.zh.yaml?raw";
import skillVerifyEnRaw from "./defaults/skill-verify.en.yaml?raw";
import skillBootstrapPlanZhRaw from "./defaults/skill-bootstrap-plan.zh.yaml?raw";
import skillBootstrapPlanEnRaw from "./defaults/skill-bootstrap-plan.en.yaml?raw";
import skillPlannerStepZhRaw from "./defaults/skill-planner-step.zh.yaml?raw";
import skillPlannerStepEnRaw from "./defaults/skill-planner-step.en.yaml?raw";
import skillCompletionGateZhRaw from "./defaults/skill-completion-gate.zh.yaml?raw";
import skillCompletionGateEnRaw from "./defaults/skill-completion-gate.en.yaml?raw";

export type PromptTemplateBaseId =
  | "tool-decision"
  | "skill-decision"
  | "skill-runtime-system"
  | "skill-verify"
  | "skill-bootstrap-plan"
  | "skill-planner-step"
  | "skill-completion-gate";

export type PromptTemplateFileId =
  | "tool-decision.zh"
  | "tool-decision.en"
  | "skill-decision.zh"
  | "skill-decision.en"
  | "skill-runtime-system.zh"
  | "skill-runtime-system.en"
  | "skill-verify.zh"
  | "skill-verify.en"
  | "skill-bootstrap-plan.zh"
  | "skill-bootstrap-plan.en"
  | "skill-planner-step.zh"
  | "skill-planner-step.en"
  | "skill-completion-gate.zh"
  | "skill-completion-gate.en";

export type PromptTemplateCategory = "tool_decision" | "skill_decision" | "skill_runtime";

export type PromptTemplateDefinition = {
  id: PromptTemplateFileId;
  baseId: PromptTemplateBaseId;
  path: string;
  title: string;
  description: string;
  category: PromptTemplateCategory;
  language: McpPromptTemplateKey;
  placeholders: string[];
  defaultContent: string;
};

export type PromptTemplateGroup = {
  baseId: PromptTemplateBaseId;
  title: string;
  description: string;
  category: PromptTemplateCategory;
  placeholders: string[];
  entries: Partial<Record<McpPromptTemplateKey, ParsedPromptTemplate>>;
};

export type PromptTemplateFileState = {
  id: PromptTemplateFileId;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type ParsedPromptTemplate = {
  id: PromptTemplateFileId;
  baseId: PromptTemplateBaseId;
  path: string;
  title: string;
  description: string;
  category: PromptTemplateCategory;
  language: McpPromptTemplateKey;
  placeholders: string[];
  content: string;
  template: string;
  parseError?: string;
};

const PROMPT_TEMPLATE_KEY = "agr_prompt_template_files_v1";

const PROMPT_TEMPLATE_DEFINITIONS: PromptTemplateDefinition[] = [
  {
    id: "tool-decision.zh",
    baseId: "tool-decision",
    path: "prompt-templates/tool-decision.zh.yaml",
    title: "Tool Decision Prompt",
    description: "控制自動判斷是否需要使用工具的前置 prompt。",
    category: "tool_decision",
    language: "zh",
    placeholders: ["{{userInput}}", "{{toolListJson}}", "{{noToolJson}}", "{{userProfileJson}}", "{{builtinToolJson}}", "{{mcpCallJson}}"],
    defaultContent: toolDecisionZhRaw
  },
  {
    id: "tool-decision.en",
    baseId: "tool-decision",
    path: "prompt-templates/tool-decision.en.yaml",
    title: "Tool Decision Prompt",
    description: "Controls the preflight prompt for tool selection.",
    category: "tool_decision",
    language: "en",
    placeholders: ["{{userInput}}", "{{toolListJson}}", "{{noToolJson}}", "{{userProfileJson}}", "{{builtinToolJson}}", "{{mcpCallJson}}"],
    defaultContent: toolDecisionEnRaw
  },
  {
    id: "skill-decision.zh",
    baseId: "skill-decision",
    path: "prompt-templates/skill-decision.zh.yaml",
    title: "Skill Decision Prompt",
    description: "控制是否先載入 skill 再進入一般 tool decision。",
    category: "skill_decision",
    language: "zh",
    placeholders: ["{{userInput}}", "{{skillListJson}}"],
    defaultContent: skillDecisionZhRaw
  },
  {
    id: "skill-decision.en",
    baseId: "skill-decision",
    path: "prompt-templates/skill-decision.en.yaml",
    title: "Skill Decision Prompt",
    description: "Controls whether a skill should be loaded before normal tool selection.",
    category: "skill_decision",
    language: "en",
    placeholders: ["{{userInput}}", "{{skillListJson}}"],
    defaultContent: skillDecisionEnRaw
  },
  {
    id: "skill-runtime-system.zh",
    baseId: "skill-runtime-system",
    path: "prompt-templates/skill-runtime-system.zh.yaml",
    title: "Skill Runtime System Prompt",
    description: "控制 skill 載入後附加給模型的內部系統前言。",
    category: "skill_runtime",
    language: "zh",
    placeholders: ["{{skillName}}", "{{skillId}}"],
    defaultContent: skillRuntimeSystemZhRaw
  },
  {
    id: "skill-runtime-system.en",
    baseId: "skill-runtime-system",
    path: "prompt-templates/skill-runtime-system.en.yaml",
    title: "Skill Runtime System Prompt",
    description: "Controls the internal system preamble appended after a skill is loaded.",
    category: "skill_runtime",
    language: "en",
    placeholders: ["{{skillName}}", "{{skillId}}"],
    defaultContent: skillRuntimeSystemEnRaw
  },
  {
    id: "skill-verify.zh",
    baseId: "skill-verify",
    path: "prompt-templates/skill-verify.zh.yaml",
    title: "Skill Verify Prompt",
    description: "控制 multi-turn skill refine 中 verifier 判斷 pass / refine 的 prompt。",
    category: "skill_runtime",
    language: "zh",
    placeholders: [
      "{{skillName}}",
      "{{skillId}}",
      "{{skillDescription}}",
      "{{runtimeInstructions}}",
      "{{loadedReferences}}",
      "{{loadedAssets}}",
      "{{round}}",
      "{{userInput}}",
      "{{currentInput}}",
      "{{answer}}"
    ],
    defaultContent: skillVerifyZhRaw
  },
  {
    id: "skill-verify.en",
    baseId: "skill-verify",
    path: "prompt-templates/skill-verify.en.yaml",
    title: "Skill Verify Prompt",
    description: "Controls the verifier prompt for multi-turn skill refine.",
    category: "skill_runtime",
    language: "en",
    placeholders: [
      "{{skillName}}",
      "{{skillId}}",
      "{{skillDescription}}",
      "{{runtimeInstructions}}",
      "{{loadedReferences}}",
      "{{loadedAssets}}",
      "{{round}}",
      "{{userInput}}",
      "{{currentInput}}",
      "{{answer}}"
    ],
    defaultContent: skillVerifyEnRaw
  },
  {
    id: "skill-bootstrap-plan.zh",
    baseId: "skill-bootstrap-plan",
    path: "prompt-templates/skill-bootstrap-plan.zh.yaml",
    title: "Skill Bootstrap Plan Prompt",
    description: "控制 multi-turn skill 初始 todo 與 startUrl 推論。",
    category: "skill_runtime",
    language: "zh",
    placeholders: ["{{skillName}}", "{{skillId}}", "{{skillDescription}}", "{{runtimeInstructions}}", "{{userInput}}"],
    defaultContent: skillBootstrapPlanZhRaw
  },
  {
    id: "skill-bootstrap-plan.en",
    baseId: "skill-bootstrap-plan",
    path: "prompt-templates/skill-bootstrap-plan.en.yaml",
    title: "Skill Bootstrap Plan Prompt",
    description: "Controls the initial multi-turn skill todo plan and startUrl inference.",
    category: "skill_runtime",
    language: "en",
    placeholders: ["{{skillName}}", "{{skillId}}", "{{skillDescription}}", "{{runtimeInstructions}}", "{{userInput}}"],
    defaultContent: skillBootstrapPlanEnRaw
  },
  {
    id: "skill-planner-step.zh",
    baseId: "skill-planner-step",
    path: "prompt-templates/skill-planner-step.zh.yaml",
    title: "Skill Planner Step Prompt",
    description: "控制 multi-turn skill 每一步的下一動決策。",
    category: "skill_runtime",
    language: "zh",
    placeholders: [
      "{{skillName}}",
      "{{skillId}}",
      "{{skillDescription}}",
      "{{runtimeInstructions}}",
      "{{userInput}}",
      "{{todoSummary}}",
      "{{currentContext}}",
      "{{toolScopeSummary}}",
      "{{constraintBlock}}",
      "{{currentPhaseHint}}",
      "{{allowedOutputs}}"
    ],
    defaultContent: skillPlannerStepZhRaw
  },
  {
    id: "skill-planner-step.en",
    baseId: "skill-planner-step",
    path: "prompt-templates/skill-planner-step.en.yaml",
    title: "Skill Planner Step Prompt",
    description: "Controls each observe / act / ask_user / finish decision for multi-turn skill runtime.",
    category: "skill_runtime",
    language: "en",
    placeholders: [
      "{{skillName}}",
      "{{skillId}}",
      "{{skillDescription}}",
      "{{runtimeInstructions}}",
      "{{userInput}}",
      "{{todoSummary}}",
      "{{currentContext}}",
      "{{toolScopeSummary}}",
      "{{constraintBlock}}",
      "{{currentPhaseHint}}",
      "{{allowedOutputs}}"
    ],
    defaultContent: skillPlannerStepEnRaw
  },
  {
    id: "skill-completion-gate.zh",
    baseId: "skill-completion-gate",
    path: "prompt-templates/skill-completion-gate.zh.yaml",
    title: "Skill Completion Gate Prompt",
    description: "控制 multi-turn skill 是否真的完成任務的最後判斷。",
    category: "skill_runtime",
    language: "zh",
    placeholders: ["{{skillName}}", "{{skillId}}", "{{skillDescription}}", "{{runtimeInstructions}}", "{{userInput}}", "{{todoSummary}}", "{{currentContext}}"],
    defaultContent: skillCompletionGateZhRaw
  },
  {
    id: "skill-completion-gate.en",
    baseId: "skill-completion-gate",
    path: "prompt-templates/skill-completion-gate.en.yaml",
    title: "Skill Completion Gate Prompt",
    description: "Controls the final completion check for multi-turn skill runtime.",
    category: "skill_runtime",
    language: "en",
    placeholders: ["{{skillName}}", "{{skillId}}", "{{skillDescription}}", "{{runtimeInstructions}}", "{{userInput}}", "{{todoSummary}}", "{{currentContext}}"],
    defaultContent: skillCompletionGateEnRaw
  }
];

function parsePromptYamlContent(raw: string, fallback: PromptTemplateDefinition) {
  const parsed = YAML.parse(raw) as Record<string, unknown> | null;
  const template = typeof parsed?.template === "string" ? parsed.template.trim() : "";
  if (!template) throw new Error("Missing required `template` field.");
  return {
    title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
    description:
      typeof parsed?.description === "string" && parsed.description.trim() ? parsed.description.trim() : fallback.description,
    category: (typeof parsed?.category === "string" && parsed.category.trim() ? parsed.category.trim() : fallback.category) as PromptTemplateCategory,
    language: (parsed?.language === "zh" || parsed?.language === "en" ? parsed.language : fallback.language) as McpPromptTemplateKey,
    placeholders: Array.isArray(parsed?.placeholders)
      ? parsed.placeholders.filter((item): item is string => typeof item === "string" && !!item.trim())
      : fallback.placeholders,
    template
  };
}

function replaceTemplateBody(raw: string, template: string) {
  const definition = YAML.parse(raw) as Record<string, unknown> | null;
  const next = { ...(definition ?? {}), template };
  return YAML.stringify(next);
}

function getDefaultStates(now = Date.now()): PromptTemplateFileState[] {
  return PROMPT_TEMPLATE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    content: definition.defaultContent,
    createdAt: now,
    updatedAt: now
  }));
}

function migrateLegacyToolDecisionTemplates(defaults: PromptTemplateFileState[]) {
  const legacy = loadMcpPromptTemplates();
  const legacyDefaults = getDefaultMcpPromptTemplates();
  if (legacy.zh === legacyDefaults.zh && legacy.en === legacyDefaults.en) return defaults;

  return defaults.map((entry) => {
    if (entry.id === "tool-decision.zh" && legacy.zh.trim()) {
      return { ...entry, content: replaceTemplateBody(entry.content, legacy.zh.trim()) };
    }
    if (entry.id === "tool-decision.en" && legacy.en.trim()) {
      return { ...entry, content: replaceTemplateBody(entry.content, legacy.en.trim()) };
    }
    return entry;
  });
}

export function getPromptTemplateDefinitions() {
  return PROMPT_TEMPLATE_DEFINITIONS.slice();
}

export function getPromptTemplateBaseIds() {
  return Array.from(new Set(PROMPT_TEMPLATE_DEFINITIONS.map((entry) => entry.baseId))) as PromptTemplateBaseId[];
}

export function loadPromptTemplateFiles(): PromptTemplateFileState[] {
  const defaults = migrateLegacyToolDecisionTemplates(getDefaultStates());
  try {
    const raw = localStorage.getItem(PROMPT_TEMPLATE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    const byId = new Map(
      parsed
        .filter(
          (item): item is PromptTemplateFileState =>
            !!item &&
            typeof item.id === "string" &&
            typeof item.content === "string" &&
            typeof item.createdAt === "number" &&
            typeof item.updatedAt === "number"
        )
        .map((item) => [item.id, item])
    );
    return defaults.map((entry) => {
      const stored = byId.get(entry.id);
      return stored ? { ...entry, ...stored } : entry;
    });
  } catch {
    return defaults;
  }
}

export function savePromptTemplateFiles(entries: PromptTemplateFileState[]) {
  localStorage.setItem(PROMPT_TEMPLATE_KEY, JSON.stringify(entries));
}

export function getPromptTemplateFileId(baseId: PromptTemplateBaseId, language: McpPromptTemplateKey): PromptTemplateFileId {
  return `${baseId}.${language}` as PromptTemplateFileId;
}

export function buildPromptTemplateRuntime(entries: PromptTemplateFileState[]) {
  const statesById = new Map(entries.map((entry) => [entry.id, entry]));
  const parsedEntries = PROMPT_TEMPLATE_DEFINITIONS.map((definition) => {
    const state = statesById.get(definition.id);
    const content = state?.content ?? definition.defaultContent;
    try {
      const resolved = parsePromptYamlContent(content, definition);
      return {
        id: definition.id,
        baseId: definition.baseId,
        path: definition.path,
        title: resolved.title,
        description: resolved.description,
        category: resolved.category,
        language: resolved.language,
        placeholders: resolved.placeholders,
        content,
        template: resolved.template
      } satisfies ParsedPromptTemplate;
    } catch (error: any) {
      const fallback = parsePromptYamlContent(definition.defaultContent, definition);
      return {
        id: definition.id,
        baseId: definition.baseId,
        path: definition.path,
        title: fallback.title,
        description: fallback.description,
        category: fallback.category,
        language: fallback.language,
        placeholders: fallback.placeholders,
        content,
        template: fallback.template,
        parseError: String(error?.message ?? error)
      } satisfies ParsedPromptTemplate;
    }
  });

  const byId = Object.fromEntries(parsedEntries.map((entry) => [entry.id, entry])) as Record<PromptTemplateFileId, ParsedPromptTemplate>;
  const groups = getPromptTemplateBaseIds().map((baseId) => {
    const groupEntries = parsedEntries.filter((entry) => entry.baseId === baseId);
    const first = groupEntries[0];
    return {
      baseId,
      title: first.title,
      description: first.description,
      category: first.category,
      placeholders: Array.from(new Set(groupEntries.flatMap((entry) => entry.placeholders))),
      entries: Object.fromEntries(groupEntries.map((entry) => [entry.language, entry])) as Partial<Record<McpPromptTemplateKey, ParsedPromptTemplate>>
    } satisfies PromptTemplateGroup;
  });

  function resolve(baseId: PromptTemplateBaseId, language: McpPromptTemplateKey) {
    const fileId = getPromptTemplateFileId(baseId, language);
    return byId[fileId];
  }

  return { entries: parsedEntries, byId, groups, resolve };
}

export function resetPromptTemplateToDefault(id: PromptTemplateFileId) {
  const definition = PROMPT_TEMPLATE_DEFINITIONS.find((entry) => entry.id === id);
  return definition?.defaultContent ?? "";
}

export function getDefaultPromptTemplate(id: PromptTemplateFileId) {
  const definition = PROMPT_TEMPLATE_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) return "";
  return parsePromptYamlContent(definition.defaultContent, definition).template;
}
