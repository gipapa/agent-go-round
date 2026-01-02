import { AgentConfig } from "../types";

const KEY = "agr_agents_v1";

export function loadAgents(): AgentConfig[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AgentConfig[];
  } catch {
    return [];
  }
}

export function saveAgents(agents: AgentConfig[]) {
  localStorage.setItem(KEY, JSON.stringify(agents));
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
