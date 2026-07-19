import { MAGI_UNIT_LAYOUT } from "../orchestrators/magi";
import type { AgentConfig, MagiMode, MagiUnitId } from "../types";
import { generateId } from "../utils/id";

export const MAGI_MODE_LABELS: Record<MagiMode, string> = {
  magi_vote: "S.C. Magi System (基本版: 三賢人同時表決)",
  magi_consensus: "S.C. Magi System (進階版: 三賢人共識)"
};

const MAGI_RESERVED_PREFIX = "[系統保留]";

const MAGI_AGENT_DESCRIPTIONS: Record<MagiUnitId, string> = {
  Melchior: "S.C. MAGI 科學家單元。偏邏輯、證據、技術可行性與錯誤檢查。",
  Balthasar: "S.C. MAGI 母親單元。偏安全、人因、照護、營運穩定與使用者影響。",
  Casper: "S.C. MAGI 女人單元。偏直覺、自保、政治現實、風險與動機判讀。"
};

function normalizeMagiLookupKey(name: string) {
  return name.trim().toLowerCase();
}

export function formatManagedMagiAgentName(unitId: MagiUnitId) {
  return `${MAGI_RESERVED_PREFIX} ${unitId}`;
}

export function formatMagiUnitTitle(unitId: MagiUnitId) {
  const entry = MAGI_UNIT_LAYOUT.find((item) => item.unitId === unitId);
  return entry ? `${unitId} · ${entry.unitNumber}` : unitId;
}

export function isManagedMagiAgent(agent: AgentConfig | null | undefined) {
  return !!agent && agent.managedBy === "magi" && !!agent.managedUnitId;
}

export function matchesManagedMagiUnit(agent: AgentConfig, unitId: MagiUnitId) {
  if (agent.managedBy !== "magi") return false;
  if (agent.managedUnitId === unitId) return true;
  const normalizedName = normalizeMagiLookupKey(agent.name);
  return normalizedName === normalizeMagiLookupKey(unitId) || normalizedName === normalizeMagiLookupKey(formatManagedMagiAgentName(unitId));
}

export function createManagedMagiAgent(unitId: MagiUnitId): AgentConfig {
  return {
    id: generateId(),
    name: formatManagedMagiAgentName(unitId),
    type: "openai_compat",
    description: MAGI_AGENT_DESCRIPTIONS[unitId],
    loadBalancerId: "",
    managedBy: "magi",
    managedUnitId: unitId,
    tutorialRole: undefined,
    enableDocs: false,
    enableMcp: false,
    enableBuiltInTools: false,
    enableSkills: true,
    allowedDocIds: [],
    allowedMcpServerIds: [],
    allowedBuiltInToolIds: [],
    allowedSkillIds: [],
    capabilities: { streaming: true }
  };
}

export function normalizeManagedMagiAgent(agent: AgentConfig, unitId: MagiUnitId): AgentConfig {
  return {
    ...agent,
    name: formatManagedMagiAgentName(unitId),
    type: "openai_compat",
    description: MAGI_AGENT_DESCRIPTIONS[unitId],
    managedBy: "magi",
    managedUnitId: unitId,
    tutorialRole: undefined,
    enableDocs: false,
    enableMcp: false,
    enableBuiltInTools: false,
    enableSkills: true,
    allowedDocIds: [],
    allowedMcpServerIds: [],
    allowedBuiltInToolIds: [],
    allowedSkillIds: []
  };
}

export function ensureManagedMagiAgents(agents: AgentConfig[]) {
  let changed = false;
  const next = [...agents];

  MAGI_UNIT_LAYOUT.forEach(({ unitId }) => {
    const matches = next.filter((agent) => matchesManagedMagiUnit(agent, unitId));
    if (matches.length === 0) {
      next.push(createManagedMagiAgent(unitId));
      changed = true;
      return;
    }
    const current = matches[0];
    const normalized = normalizeManagedMagiAgent(current, unitId);
    if (JSON.stringify(current) !== JSON.stringify(normalized)) {
      const index = next.findIndex((agent) => agent.id === current.id);
      if (index >= 0) {
        next[index] = normalized;
        changed = true;
      }
    }
  });

  return changed ? next : agents;
}
