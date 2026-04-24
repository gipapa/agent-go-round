import { AgentConfig } from "../types";
import { readJsonStorage, writeJsonStorage } from "./safeStorage";

const KEY = "agr_agents_v1";

function isAgentArray(value: unknown): value is AgentConfig[] {
  return Array.isArray(value) && value.every((item) => {
    const agent = item as Partial<AgentConfig> | null;
    return !!agent && typeof agent === "object" && typeof agent.id === "string" && typeof agent.name === "string" && typeof agent.type === "string";
  });
}

export function loadAgents(): AgentConfig[] {
  return readJsonStorage(KEY, {
    defaultValue: [],
    validate: isAgentArray
  });
}

export function saveAgents(agents: AgentConfig[]) {
  writeJsonStorage(KEY, agents);
}

export function upsertAgent(agent: AgentConfig) {
  const agents = loadAgents();
  const idx = agents.findIndex((a) => a.id === agent.id);
  if (idx >= 0) agents[idx] = agent;
  else agents.unshift(agent);
  saveAgents(agents);
}

export function deleteAgent(agentId: string) {
  const agents = loadAgents().filter((a) => a.id !== agentId);
  saveAgents(agents);
}
