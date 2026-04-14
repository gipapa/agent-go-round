import {
  AgentConfig,
  BuiltInToolConfig,
  ChatTraceEntry,
  DocItem,
  LoadedSkillRuntime,
  McpServerConfig,
  McpTool,
  SkillAvailability,
  SkillConfig,
  SkillDocItem,
  SkillFileItem,
  SkillSessionSnapshot
} from "../types";
import { generateId } from "../utils/id";
import { resolveReferencedSkillAssets, resolveReferencedSkillDocs } from "./skillReferenceResolver";
import { getDefaultPromptTemplate } from "../promptTemplates/store";

export function pushSkillTrace(trace: ChatTraceEntry[], label: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) return;
  trace.push({ label, content: trimmed });
}

function replacePromptTemplate(baseTemplate: string, replacements: Record<string, string>) {
  let prompt = baseTemplate;
  Object.entries(replacements).forEach(([placeholder, value]) => {
    prompt = prompt.split(placeholder).join(value);
  });
  return prompt;
}

export function buildSkillDecisionPrompt(
  userInput: string,
  skillListJson: string,
  language: "zh" | "en",
  template?: string
) {
  const fallbackTemplate = getDefaultPromptTemplate(language === "en" ? "skill-decision.en" : "skill-decision.zh");
  const baseTemplate = template?.trim() || fallbackTemplate;
  const replacements = {
    "{{userInput}}": userInput,
    "{{skillListJson}}": skillListJson
  };

  let prompt = replacePromptTemplate(baseTemplate, replacements);
  if (!baseTemplate.includes("{{userInput}}")) {
    prompt += `${language === "en" ? "\n\nUser request:\n" : "\n\n使用者提問如下:\n"}${userInput}`;
  }
  if (!baseTemplate.includes("{{skillListJson}}")) {
    prompt += `${language === "en" ? "\n\nAvailable skills:\n" : "\n\n可用 skills 如下:\n"}${skillListJson}`;
  }
  if (!baseTemplate.includes('"type":"no_skill"')) {
    prompt += `${language === "en" ? '\n\nIf no skill is needed, return: {"type":"no_skill"}' : '\n\n如果不需要 skill，回傳：{"type":"no_skill"}'}`;
  }
  if (!baseTemplate.includes('"type":"skill_call"')) {
    prompt += `${
      language === "en"
        ? '\n\nIf one skill should be loaded, return: {"type":"skill_call","skillId":"...","input":{}}'
        : '\n\n如果需要載入一個 skill，回傳：{"type":"skill_call","skillId":"...","input":{}}'
    }`;
  }
  if (!/一次只能選一個 skill|Only choose one skill/.test(baseTemplate)) {
    prompt += language === "en" ? "\n\nOnly choose one skill." : "\n\n一次只能選一個 skill。";
  }
  return prompt;
}

export function buildSkillSessionSnapshot(args: { agent: AgentConfig | null; skills: SkillConfig[] }): SkillSessionSnapshot | null {
  const { agent, skills } = args;
  if (!agent) return null;

  const allowedSkillIds = agent.allowedSkillIds ? new Set(agent.allowedSkillIds) : null;
  const availableSkills: SkillAvailability[] = skills.map((skill) => {
    if (agent.enableSkills !== true) {
      return {
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        allowed: false,
        reason: "Skills disabled for this agent."
      };
    }
    if (allowedSkillIds && !allowedSkillIds.has(skill.id)) {
      return {
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        allowed: false,
        reason: "Skill not granted in agent access control."
      };
    }
    return {
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      allowed: true
    };
  });

  return {
    sessionId: generateId(),
    agentId: agent.id,
    createdAt: Date.now(),
    availableSkills
  };
}

export function getAllowedSkillsFromSnapshot(snapshot: SkillSessionSnapshot | null, registry: SkillConfig[]) {
  if (!snapshot) return [];
  const allowedIds = new Set(snapshot.availableSkills.filter((item) => item.allowed).map((item) => item.skillId));
  return registry.filter((skill) => allowedIds.has(skill.id));
}

export function buildSkillDecisionCatalog(skills: SkillConfig[]) {
  const compactText = (value: string | undefined, maxChars: number) => {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
  };

  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    summary: compactText(skill.decisionHint || skill.description || "", 180)
  }));
}

export function buildSkillExecutionInput(userInput: string, skillInput: any) {
  if (skillInput === undefined || skillInput === null) return userInput;
  if (typeof skillInput === "object" && !Array.isArray(skillInput) && Object.keys(skillInput).length === 0) {
    return userInput;
  }
  return `${userInput}\n\nSkill input:\n${typeof skillInput === "string" ? skillInput : JSON.stringify(skillInput, null, 2)}`;
}

export function loadSkillRuntime(args: {
  skill: SkillConfig;
  skillDocs: SkillDocItem[];
  skillFiles: SkillFileItem[];
  agentDocs: DocItem[];
  availableMcpServers: McpServerConfig[];
  availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  availableBuiltinTools: BuiltInToolConfig[];
  userInput: string;
  skillInput: any;
  systemPromptTemplate?: string;
}) {
  const trace: ChatTraceEntry[] = [];
  const { referencedPaths, loadedReferences } = resolveReferencedSkillDocs(args.skill, args.skillDocs);
  const { assetPaths, loadedAssets } = resolveReferencedSkillAssets(args.skill, args.skillFiles);

  const runtime: LoadedSkillRuntime = {
    skillId: args.skill.id,
    name: args.skill.name,
    description: args.skill.description,
    instructions: args.skill.workflow.instructions?.trim() ?? "",
    referencedPaths,
    loadedReferences: loadedReferences.map((doc) => ({ path: doc.path, content: doc.content })),
    assetPaths,
    loadedAssets: loadedAssets.map((file) => ({ path: file.path, content: file.content })),
    allowMcp: args.skill.workflow.allowMcp === true,
    allowBuiltInTools: args.skill.workflow.allowBuiltInTools === true,
    allowedMcpServerIds: args.skill.workflow.allowedMcpServerIds,
    allowedBuiltInToolIds: args.skill.workflow.allowedBuiltInToolIds,
    bootstrapAction: args.skill.workflow.bootstrapAction
  };

  pushSkillTrace(
    trace,
    "Skill load",
    [`已載入 skill：${runtime.name} (${runtime.skillId})`, runtime.description ? `說明：${runtime.description}` : ""].filter(Boolean).join("\n")
  );

  if (args.skillInput !== undefined && args.skillInput !== null && (typeof args.skillInput !== "object" || Object.keys(args.skillInput).length > 0)) {
    pushSkillTrace(trace, "Skill input", typeof args.skillInput === "string" ? args.skillInput : JSON.stringify(args.skillInput, null, 2));
  }

  pushSkillTrace(
    trace,
    "Skill references",
    referencedPaths.length
      ? loadedReferences.length
        ? `SKILL.md 引用了 ${referencedPaths.length} 個 references\n已載入 ${loadedReferences.length} 個\n${loadedReferences
            .map((doc) => `- ${doc.path}`)
            .join("\n")}`
        : `SKILL.md 引用了 references，但未找到對應檔案\n${referencedPaths.map((path) => `- ${path}`).join("\n")}`
      : "SKILL.md 未引用任何 references/ 檔案"
  );

  pushSkillTrace(
    trace,
    "Skill assets",
    assetPaths.length
      ? loadedAssets.length
        ? `SKILL.md 引用了 ${assetPaths.length} 個 assets\n已載入 ${loadedAssets.length} 個\n${loadedAssets
            .map((file) => `- ${file.path}`)
            .join("\n")}`
        : `SKILL.md 引用了 assets，但未找到對應檔案\n${assetPaths.map((path) => `- ${path}`).join("\n")}`
      : "SKILL.md 未引用任何 assets/ 檔案"
  );

  const scopeLines: string[] = [];
  if (args.skill.workflow.useAgentDocs) {
    scopeLines.push(`Agent docs：${args.agentDocs.length} 份`);
  }
  if (runtime.allowMcp) {
    const scopedMcpServers = runtime.allowedMcpServerIds?.length
      ? args.availableMcpServers.filter((server) => runtime.allowedMcpServerIds?.includes(server.id))
      : args.availableMcpServers;
    const scopedMcpTools = args.availableMcpTools.filter((entry) => scopedMcpServers.some((server) => server.id === entry.server.id));
    scopeLines.push(`MCP servers：${scopedMcpServers.length} 個，已載入工具 ${scopedMcpTools.reduce((sum, entry) => sum + entry.tools.length, 0)} 個`);
  }
  if (runtime.allowBuiltInTools) {
    const scopedBuiltIns = runtime.allowedBuiltInToolIds?.length
      ? args.availableBuiltinTools.filter((tool) => runtime.allowedBuiltInToolIds?.includes(tool.id))
      : args.availableBuiltinTools;
    scopeLines.push(`Built-in tools：${scopedBuiltIns.length} 個`);
  }
  if (scopeLines.length) {
    pushSkillTrace(trace, "Skill scope", scopeLines.join("\n"));
  }
  if (runtime.bootstrapAction) {
    pushSkillTrace(
      trace,
      "Skill bootstrap",
      [
        `預設第一步工具：${runtime.bootstrapAction.toolKind}/${runtime.bootstrapAction.toolName}`,
        runtime.bootstrapAction.reason ? `原因：${runtime.bootstrapAction.reason}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const systemParts: string[] = [];
  const runtimeSystemTemplate = args.systemPromptTemplate?.trim() || getDefaultPromptTemplate("skill-runtime-system.en");
  let runtimeSystemPrompt = replacePromptTemplate(runtimeSystemTemplate, {
    "{{skillName}}": runtime.name,
    "{{skillId}}": runtime.skillId
  });
  if (!runtimeSystemTemplate.includes("{{skillName}}") || !runtimeSystemTemplate.includes("{{skillId}}")) {
    runtimeSystemPrompt += `\n\nYou have loaded the internal skill "${runtime.name}" (${runtime.skillId}).`;
  }
  systemParts.push(runtimeSystemPrompt);
  if (runtime.instructions) {
    systemParts.push(`Internal skill workflow:\n${runtime.instructions}`);
  }
  if (args.skill.workflow.useAgentDocs) {
    const docBlocks = args.agentDocs.map((doc) => `[DOC:${doc.title}]\n${doc.content}`).join("\n\n");
    if (docBlocks) {
      systemParts.push(`Agent docs context:\n${docBlocks}`);
    }
  }
  if (loadedReferences.length > 0) {
    const refBlocks = loadedReferences.map((doc) => `[SKILL_DOC:${doc.path}]\n${doc.content}`).join("\n\n");
    systemParts.push(`Skill docs context:\n${refBlocks}`);
  }
  if (loadedAssets.length > 0) {
    const assetBlocks = loadedAssets.map((file) => `[SKILL_ASSET:${file.path}]\n${file.content}`).join("\n\n");
    systemParts.push(`Skill assets context:\n${assetBlocks}`);
  }

  return {
    runtime,
    finalInput: buildSkillExecutionInput(args.userInput, args.skillInput),
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    trace
  };
}
