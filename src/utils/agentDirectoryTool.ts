import { AgentConfig } from "../types";

const AGENTS_STORAGE_KEY = "agr_agents_v1";

function buildSearchTokens(text: string) {
  const source = (text ?? "").toLowerCase();
  const tokens = new Set<string>();
  const wordMatches = source.match(/[a-z0-9_]{2,}/g) ?? [];
  wordMatches.forEach((word) => tokens.add(word));
  const cjkRuns = source.match(/[\u4e00-\u9fff]+/g) ?? [];
  cjkRuns.forEach((run) => {
    for (const char of run) tokens.add(char);
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  });
  return Array.from(tokens).filter(Boolean);
}

export function loadSavedAgentsFromStorage() {
  try {
    const raw = localStorage.getItem(AGENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentConfig[]) : [];
  } catch {
    return [];
  }
}

export function pickBestAgentNameForQuestion(question: string, agents: AgentConfig[], fallbackName?: string) {
  if (agents.length === 0) return fallbackName ?? "";
  const prompt = (question ?? "").trim().toLowerCase();
  const promptTokens = buildSearchTokens(prompt);
  let best = agents[0];
  let bestScore = -Infinity;

  for (const agent of agents) {
    const description = (agent.description ?? "").trim().toLowerCase();
    let score = description ? 0 : -1;

    if (description && prompt && description.includes(prompt)) score += 100;
    for (const token of promptTokens) {
      if (!description || !description.includes(token)) continue;
      score += token.length >= 2 ? 4 : 1;
    }

    if (score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }

  return best?.name ?? fallbackName ?? "";
}

export async function pickBestSavedAgentForQuestion(question: string) {
  return pickBestAgentNameForQuestion(question, loadSavedAgentsFromStorage());
}
