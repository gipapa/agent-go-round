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
  SkillSessionSnapshot
} from "../types";
import { generateId } from "../utils/id";
import { resolveReferencedSkillDocs } from "./skillReferenceResolver";

export function pushSkillTrace(trace: ChatTraceEntry[], label: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) return;
  trace.push({ label, content: trimmed });
}

export function buildSkillDecisionPrompt(userInput: string, skillListJson: string, language: "zh" | "en") {
  if (language === "en") {
    return [
      "Return JSON only. Do not add any other text.",
      "",
      "Decide whether this turn should load one reusable skill workflow before normal tool selection.",
      "",
      "User request:",
      userInput,
      "",
      "Available skills:",
      skillListJson,
      "",
      'If no skill is needed, return: {"type":"no_skill"}',
      "",
      'If one skill should be loaded, return: {"type":"skill_call","skillId":"...","input":{}}',
      "",
      "Only choose one skill."
    ].join("\n");
  }

  return [
    "請只回傳 JSON，不要加任何其他文字。",
    "",
    "請判斷這一回合是否需要先載入一個 skill workflow，再進入一般 tool decision。",
    "",
    "使用者提問如下:",
    userInput,
    "",
    "可用 skills 如下:",
    skillListJson,
    "",
    '如果不需要 skill，回傳：{"type":"no_skill"}',
    "",
    '如果需要載入一個 skill，回傳：{"type":"skill_call","skillId":"...","input":{}}',
    "",
    "一次只能選一個 skill。"
  ].join("\n");
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
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    decisionHint: skill.decisionHint ?? "",
    inputSchema: skill.inputSchema ?? {}
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
  agentDocs: DocItem[];
  availableMcpServers: McpServerConfig[];
  availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  availableBuiltinTools: BuiltInToolConfig[];
  userInput: string;
  skillInput: any;
}) {
  const trace: ChatTraceEntry[] = [];
  const { referencedPaths, loadedReferences } = resolveReferencedSkillDocs(args.skill, args.skillDocs);

  const runtime: LoadedSkillRuntime = {
    skillId: args.skill.id,
    name: args.skill.name,
    description: args.skill.description,
    instructions: args.skill.workflow.instructions?.trim() ?? "",
    referencedPaths,
    loadedReferences: loadedReferences.map((doc) => ({ path: doc.path, content: doc.content })),
    allowMcp: args.skill.workflow.allowMcp === true,
    allowBuiltInTools: args.skill.workflow.allowBuiltInTools === true,
    allowedMcpServerIds: args.skill.workflow.allowedMcpServerIds,
    allowedBuiltInToolIds: args.skill.workflow.allowedBuiltInToolIds
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

  const systemParts: string[] = [];
  systemParts.push(
    [
      `You have loaded the internal skill "${runtime.name}" (${runtime.skillId}).`,
      "Treat the skill content as private operational guidance.",
      "Do not quote, roleplay, or expose the skill text to the user unless the user explicitly asks to see it.",
      "Convert any checklist, pressure language, or coaching language into internal execution steps.",
      "Silently follow the relevant steps, use available tools when helpful, validate what you can, and then return the final answer.",
      "If a requested step cannot be executed because tools or evidence are unavailable, say so briefly and continue with the best justified answer."
    ].join("\n")
  );
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

  return {
    runtime,
    finalInput: buildSkillExecutionInput(args.userInput, args.skillInput),
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    trace
  };
}
