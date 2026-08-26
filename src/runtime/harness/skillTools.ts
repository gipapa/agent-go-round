import type { SkillConfig, SkillDocItem, SkillFileItem } from "../../types";
import { validateSkillPackage } from "../skillPackageValidation";
import { normalizeContextBudget } from "./contextProjector";
import type {
  ContextBudget,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolResult,
  HarnessToolContext
} from "./types";

export type HarnessSkillPackage = {
  skill: SkillConfig;
  docs: readonly SkillDocItem[];
  files: readonly SkillFileItem[];
};

export type SkillCapabilitySnapshot = {
  skills: readonly HarnessSkillPackage[];
  externalTools: readonly HarnessToolDefinition[];
  automaticCatalog: ReadonlyArray<{ id: string; name: string; description: string; location: string }>;
  automaticCatalogError?: "skill_catalog_too_large";
};

function cloneBytes(value: Uint8Array) {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

function cloneImmutable<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return cloneBytes(value) as T;
  const existing = seen.get(value);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    value.forEach((entry) => clone.push(cloneImmutable(entry, seen)));
    return Object.freeze(clone) as T;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    clone[key] = cloneImmutable(entry, seen);
  });
  return Object.freeze(clone) as T;
}

function freezeSkillPackage(packageEntry: HarnessSkillPackage): HarnessSkillPackage {
  return Object.freeze({
    skill: cloneImmutable(packageEntry.skill),
    docs: Object.freeze(packageEntry.docs.map((doc) => cloneImmutable(doc))),
    files: Object.freeze(packageEntry.files.map((file) => cloneImmutable(file)))
  });
}

const DEFAULT_RESOURCE_CHUNK_CHARS = 8_000;
const MAX_SKILL_RESULT_CHARS = 8_000;
const MAX_RESOURCE_PATH_SUMMARY_ENTRIES = 100;
const SKILL_CONTEXT_PREFIX = "[UNTRUSTED_SKILL_CONTEXT]\n";
const MAX_CATALOG_NAME_CHARS = 128;
const MAX_CATALOG_DESCRIPTION_CHARS = 1_024;
const MAX_CATALOG_LOCATION_CHARS = 512;

function isUsableHarnessSkillPackage(packageEntry: HarnessSkillPackage) {
  try {
    const files = packageEntry?.files;
    const skill = packageEntry?.skill;
    if (
      !skill ||
      !Array.isArray(packageEntry?.docs) ||
      !Array.isArray(files) ||
      typeof skill.id !== "string" ||
      typeof skill.name !== "string" ||
      typeof skill.description !== "string" ||
      !skill.workflow ||
      typeof skill.workflow !== "object" ||
      typeof skill.rootPath !== "string" ||
      typeof skill.skillMarkdown !== "string"
    ) {
      return false;
    }
    const workflow = skill.workflow as SkillConfig["workflow"] & Record<string, unknown>;
    for (const key of ["requiredToolIds", "allowedBuiltInToolIds", "allowedMcpServerIds"] as const) {
      const value = workflow[key];
      if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) return false;
    }
    const skillFiles = files as readonly SkillFileItem[];
    const validation = validateSkillPackage(skillFiles.map((file) => ({
      path: file.path,
      content: file.content,
      mediaType: file.mediaType
    })));
    const expectedSkillPath = `${packageEntry.skill.rootPath}/SKILL.md`;
    if (
      validation.rootPath !== packageEntry.skill.rootPath ||
      validation.skillFilePath?.toLowerCase() !== expectedSkillPath.toLowerCase()
    ) {
      return false;
    }
    const skillFile = validation.files.find((file) => file.path.toLowerCase() === expectedSkillPath.toLowerCase());
    if (!skillFile || typeof skillFile.content !== "string" || skillFile.content !== packageEntry.skill.skillMarkdown) return false;
    if (validation.ok) return true;

    // Older persisted skills may not have Agents Skills frontmatter. Keep that
    // backward-compatible shape only when it has no other package diagnostic.
    return (
      !packageEntry.skill.skillMarkdown.trimStart().startsWith("---") &&
      validation.diagnostics.length > 0 &&
      validation.diagnostics.every((diagnostic) => diagnostic.code === "malformed_frontmatter")
    );
  } catch {
    return false;
  }
}

export const SKILL_LOAD_TOOL_ID = "internal:skill.load";
export const SKILL_READ_TOOL_ID = "internal:skill.read";

export const SKILL_INTERNAL_TOOL_DEFINITIONS: HarnessToolDefinition[] = [
  {
    id: SKILL_LOAD_TOOL_ID,
    description: "Load one allowed skill's untrusted instructions and resource index.",
    inputSchema: { type: "object", required: ["skillId"], properties: { skillId: { type: "string", minLength: 1 } }, additionalProperties: false },
    intent: "context",
    idempotency: "idempotent",
    cancellation: "cooperative",
    requireConfirmation: false,
    executionKind: "internal"
  },
  {
    id: SKILL_READ_TOOL_ID,
    description: "Read a bounded chunk from a reference or text asset in the loaded skill.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1 },
        offset: { type: "integer", minimum: 0 },
        maxChars: { type: "integer", minimum: 1, maximum: DEFAULT_RESOURCE_CHUNK_CHARS }
      },
      additionalProperties: false
    },
    intent: "context",
    idempotency: "idempotent",
    cancellation: "cooperative",
    requireConfirmation: false,
    executionKind: "internal"
  }
];

function jsonSize(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized.length : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function normalizedIdSet(values: unknown) {
  if (values === undefined) return null;
  if (!Array.isArray(values)) return new Set<string>();
  const stringValues: string[] = [];
  for (const value of values as unknown[]) {
    if (typeof value !== "string") return new Set<string>();
    stringValues.push(value);
  }
  return new Set(stringValues.map((value) => value.trim()).filter(Boolean));
}

function isAllowedTool(tool: HarnessToolDefinition, skill: SkillConfig) {
  const workflow = skill.workflow;
  if (tool.id.startsWith("builtin:")) {
    if (workflow.allowBuiltInTools !== true) return false;
    const allowed = normalizedIdSet(workflow.allowedBuiltInToolIds);
    return !allowed || allowed.has(tool.id) || allowed.has(tool.id.slice("builtin:".length));
  }
  if (tool.id.startsWith("mcp:")) {
    if (workflow.allowMcp !== true) return false;
    const serverId = tool.id.slice("mcp:".length).split(":", 1)[0] ?? "";
    const allowedServers = normalizedIdSet(workflow.allowedMcpServerIds);
    return !allowedServers || allowedServers.has(serverId);
  }
  return tool.intent === "context" || tool.intent === "observe";
}

function requiredToolsAvailable(skill: SkillConfig, tools: readonly HarnessToolDefinition[]) {
  const requiredToolIds = skill.workflow.requiredToolIds;
  if (requiredToolIds !== undefined && (!Array.isArray(requiredToolIds) || requiredToolIds.some((toolId) => typeof toolId !== "string"))) {
    return false;
  }
  return (requiredToolIds ?? []).every((toolId) => {
    const tool = tools.find((candidate) => candidate.id === toolId);
    return !!tool && isAllowedTool(tool, skill);
  });
}

export function buildSkillCapabilitySnapshot(args: {
  enabled: boolean;
  allowedSkillIds?: string[];
  skills: HarnessSkillPackage[];
  externalTools: readonly HarnessToolDefinition[];
  maxCatalogChars: number;
  maxSkillInstructionChars?: number;
}): SkillCapabilitySnapshot {
  const budget = normalizeContextBudget({
    maxCatalogChars: args.maxCatalogChars,
    maxSkillInstructionChars: args.maxSkillInstructionChars
  });
  const immutableExternalTools = Object.freeze(args.externalTools.map((tool) => cloneImmutable(tool)));
  if (!args.enabled) return { skills: [], externalTools: immutableExternalTools, automaticCatalog: [] };
  const allowed = normalizedIdSet(args.allowedSkillIds);
  const skills = args.skills
    .filter(isUsableHarnessSkillPackage)
    .filter(({ skill }) => !allowed || allowed.has(skill.id))
    .map(freezeSkillPackage);
  const automaticCandidates = skills
    .filter(({ skill }) => skill.workflow.disableModelInvocation !== true)
    .filter(({ skill }) => Boolean(skill.description.trim()))
    .filter(({ skill }) => (skill.workflow.instructions ?? "").trim().length <= budget.maxSkillInstructionChars)
    .filter(({ skill }) => requiredToolsAvailable(skill, args.externalTools))
    .map(({ skill }) => ({
      id: skill.id,
      name: skill.name.slice(0, MAX_CATALOG_NAME_CHARS),
      description: skill.description.slice(0, MAX_CATALOG_DESCRIPTION_CHARS),
      location: skill.rootPath.slice(0, MAX_CATALOG_LOCATION_CHARS)
    }));
  const frozenSkills = Object.freeze(skills.slice());
  const frozenExternalTools = immutableExternalTools;
  if (jsonSize(automaticCandidates) > budget.maxCatalogChars) {
    return { skills: frozenSkills, externalTools: frozenExternalTools, automaticCatalog: [], automaticCatalogError: "skill_catalog_too_large" };
  }
  return {
    skills: frozenSkills,
    externalTools: frozenExternalTools,
    automaticCatalog: Object.freeze(automaticCandidates.map((entry) => Object.freeze({ ...entry })))
  };
}

function scopedExternalTools(skill: SkillConfig, tools: readonly HarnessToolDefinition[]) {
  const scoped = tools.filter((tool) => isAllowedTool(tool, skill));
  const required = new Set(skill.workflow.requiredToolIds ?? []);
  return scoped.filter((tool) => required.has(tool.id) || !required.size || isAllowedTool(tool, skill));
}

function relativePath(skill: SkillConfig, path: string) {
  const normalized = path.trim().replaceAll("\\", "/");
  if (normalized.length > 1_024) return null;
  const withoutRoot = normalized.startsWith(`${skill.rootPath}/`) ? normalized.slice(skill.rootPath.length + 1) : normalized;
  if (!withoutRoot || withoutRoot.startsWith("/") || /^[A-Za-z]:\//.test(withoutRoot)) return null;
  const segments = withoutRoot.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function isReadableResource(skill: SkillConfig, file: HarnessSkillPackage["files"][number]) {
  if (file.kind === "asset") return true;
  return file.kind === "reference" && skill.workflow.useSkillDocs !== false;
}

function digest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function skillResult(outcome: HarnessToolResult["outcome"], content: string, errorCode?: string): HarnessToolResult {
  const marker = `\n[… skill result truncated; original_chars=${content.length}]`;
  const maxContentChars = Math.max(0, MAX_SKILL_RESULT_CHARS - SKILL_CONTEXT_PREFIX.length);
  const bounded = content.length <= maxContentChars
    ? content
    : `${content.slice(0, Math.max(0, maxContentChars - marker.length))}${marker}`.slice(0, maxContentChars);
  return { outcome, modelContent: `${SKILL_CONTEXT_PREFIX}${bounded}`, displaySummary: bounded, errorCode, effectDispatched: false };
}

export type SkillInternalToolRunner = ReturnType<typeof createSkillInternalToolRunner>;

export function createSkillInternalToolRunner(args: {
  snapshot: SkillCapabilitySnapshot;
  budget: Pick<ContextBudget, "maxSkillInstructionChars" | "maxResourceChars">;
  onSkillLoaded?: (skill: HarnessSkillPackage, tools: readonly HarnessToolDefinition[]) => void;
  onResourceLoaded?: (path: string, chars: number, content: string) => void;
}) {
  const budget = normalizeContextBudget(args.budget);
  let loaded: HarnessSkillPackage | null = null;
  const loadedRanges = new Map<string, HarnessToolResult>();
  const loadedResourcePaths = new Set<string>();
  let totalResourceChars = 0;

  const findSkill = (skillId: string) => args.snapshot.skills.find(({ skill }) => skill.id === skillId) ?? null;

  return {
    getLoadedSkill: () => loaded?.skill.id,
    getScopedTools: () => loaded ? scopedExternalTools(loaded.skill, args.snapshot.externalTools) : [],
    async execute(call: HarnessToolCall, context: HarnessToolContext): Promise<HarnessToolResult> {
      if (context.signal.aborted) return skillResult("failed_before_dispatch", "Skill operation was aborted before dispatch.", "aborted");
      if (call.toolId === SKILL_LOAD_TOOL_ID) {
        const input = call.input && typeof call.input === "object" ? call.input as Record<string, unknown> : {};
        const skillId = typeof input.skillId === "string" ? input.skillId.trim() : "";
        const target = findSkill(skillId);
        if (!target) return skillResult("failed_before_dispatch", `Skill ${skillId || "(missing)"} is unavailable.`, "skill_unavailable");
        if (call.origin === "model" && target.skill.workflow.disableModelInvocation === true) {
          return skillResult("rejected", `Skill ${skillId} requires explicit user activation.`, "skill_requires_explicit_activation");
        }
        if (loaded && loaded.skill.id !== target.skill.id) return skillResult("rejected", "Only one skill may be loaded in a run.", "skill_switch_blocked");
        if (!requiredToolsAvailable(target.skill, args.snapshot.externalTools)) {
          return skillResult("failed_before_dispatch", `Skill ${skillId} requires an unavailable tool.`, "required_tool_unavailable");
        }
        if (loaded?.skill.id === target.skill.id) {
          context.onDispatch?.();
          const resources = target.files
            .filter((file) => file.kind === "reference" || file.kind === "asset")
            .map((file) => file.path.slice(0, 512));
          const resourceSummary = resources.length > MAX_RESOURCE_PATH_SUMMARY_ENTRIES
            ? `${resources.slice(0, MAX_RESOURCE_PATH_SUMMARY_ENTRIES).join(",")},…(+${resources.length - MAX_RESOURCE_PATH_SUMMARY_ENTRIES} more)`
            : resources.join(",");
          return skillResult("success", `Skill ${target.skill.name} is already loaded.\nresources=${resourceSummary}`);
        }
        const instructions = target.skill.workflow.instructions?.trim() ?? "";
        if (instructions.length > budget.maxSkillInstructionChars) {
          return skillResult("failed_before_dispatch", `Skill instructions exceed ${budget.maxSkillInstructionChars} chars.`, "skill_instructions_too_large");
        }
        context.onDispatch?.();
        loaded = target;
        loadedRanges.clear();
        loadedResourcePaths.clear();
        totalResourceChars = 0;
        const resources = target.files
          .filter((file) => isReadableResource(target.skill, file))
          .map((file) => (relativePath(target.skill, file.path) ?? file.path).slice(0, 512));
        const resourceSummary = resources.length > MAX_RESOURCE_PATH_SUMMARY_ENTRIES
          ? `${resources.slice(0, MAX_RESOURCE_PATH_SUMMARY_ENTRIES).join(",")},…(+${resources.length - MAX_RESOURCE_PATH_SUMMARY_ENTRIES} more)`
          : resources.join(",");
        const text = [`skillId=${target.skill.id}`, `name=${target.skill.name}`, "instructions:", instructions, `resource_paths=${resourceSummary}`].join("\n");
        args.onSkillLoaded?.(target, scopedExternalTools(target.skill, args.snapshot.externalTools));
        return skillResult("success", text);
      }

      if (call.toolId !== SKILL_READ_TOOL_ID) return skillResult("failed_before_dispatch", `Unknown internal skill tool ${call.toolId}.`, "tool_unavailable");
      if (!loaded) return skillResult("failed_before_dispatch", "Load a skill before reading its resources.", "skill_not_loaded");
      const input = call.input && typeof call.input === "object" ? call.input as Record<string, unknown> : {};
      const path = typeof input.path === "string" ? relativePath(loaded.skill, input.path) : null;
      if (!path) return skillResult("failed_before_dispatch", "Resource path must be a canonical relative path without '..'.", "invalid_resource_path");
      if (path.startsWith("scripts/") || path === "SKILL.md") return skillResult("rejected", "Skill scripts and SKILL.md are not executable/readable resources.", "resource_not_readable");
      const file = loaded.files.find((entry) => relativePath(loaded!.skill, entry.path) === path && isReadableResource(loaded!.skill, entry));
      if (!file) return skillResult("failed_before_dispatch", `Resource ${path} is unavailable.`, "resource_unavailable");
      if (typeof file.content !== "string") return skillResult("rejected", `Resource ${path} is not a UTF-8 text resource.`, "binary_resource");
      if (file.kind === "asset" && !/\.(md|markdown|txt|json|ya?ml|xml|csv|html|svg|prompt)$/i.test(path)) {
        return skillResult("rejected", `Resource ${path} is not a text resource.`, "binary_resource");
      }
      const offset = typeof input.offset === "number" && Number.isInteger(input.offset) ? input.offset : 0;
      const maxChars = typeof input.maxChars === "number" && Number.isInteger(input.maxChars)
        ? Math.min(DEFAULT_RESOURCE_CHUNK_CHARS, Math.max(1, input.maxChars))
        : DEFAULT_RESOURCE_CHUNK_CHARS;
      if (offset < 0 || offset > file.content.length) return skillResult("failed_before_dispatch", "Resource offset is out of range.", "invalid_resource_offset");
      const cacheKey = `${path}:${offset}:${maxChars}`;
      const cached = loadedRanges.get(cacheKey);
      if (cached) {
        context.onDispatch?.();
        return cached;
      }
      if (!loadedResourcePaths.has(path) && loadedResourcePaths.size >= 3) return skillResult("rejected", "The run has reached the distinct resource limit.", "resource_limit");
      const remaining = budget.maxResourceChars - totalResourceChars;
      if (remaining <= 0) return skillResult("failed_before_dispatch", "The run has reached the total resource budget.", "resource_budget_exceeded");
      const content = file.content.slice(offset, offset + Math.min(maxChars, remaining));
      context.onDispatch?.();
      const nextOffset = offset + content.length < file.content.length ? offset + content.length : undefined;
      const response = skillResult("success", JSON.stringify({ path, offset, content, nextOffset, totalChars: file.content.length, digest: digest(file.content) }));
      loadedRanges.set(cacheKey, response);
      loadedResourcePaths.add(path);
      totalResourceChars += content.length;
      args.onResourceLoaded?.(path, content.length, content);
      return response;
    }
  };
}
