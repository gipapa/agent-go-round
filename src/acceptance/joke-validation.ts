import type { SessionEvent } from "../core/session";
export type JokeAnswer = { scores: Array<{ path: string; score: number; reason: string }>; winner: { path: string; text: string; reason: string } };
export function parseJokeAnswer(text: string): JokeAnswer {
  const block = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1)?.[1] ?? text;
  try { return JSON.parse(block.trim()) as JokeAnswer; }
  catch { throw new Error("Final answer does not contain the required score JSON"); }
}
export function validateJokeAnswer(text: string, files: Record<string, { content: string; revision: number }>, events: readonly SessionEvent[], runId: string): JokeAnswer {
  const answer = parseJokeAnswer(text);
  const expected = Object.keys(files).sort();
  if (!answer || !Array.isArray(answer.scores) || JSON.stringify(answer.scores.map((item) => item.path).sort()) !== JSON.stringify(expected)) throw new Error("Expected exactly one score for each of the five joke files");
  for (const item of answer.scores) {
    if (!Number.isFinite(item.score) || item.score < 1 || item.score > 10 || typeof item.reason !== "string" || !/[\u3400-\u9fff]/u.test(item.reason)) throw new Error(`Invalid score or non-Chinese explanation: ${item.path}`);
  }
  const winner = answer.winner;
  if (!winner || !files[winner.path] || typeof winner.reason !== "string" || !/[\u3400-\u9fff]/u.test(winner.reason)) throw new Error("Winner is missing or not explained in Chinese");
  if (winner.text.trim() !== files[winner.path].content.trim()) throw new Error("Winner text does not match the actual file");
  if (answer.scores.find((item) => item.path === winner.path)!.score !== Math.max(...answer.scores.map((item) => item.score))) throw new Error("Winner does not have the highest score");
  const run = events.filter((event) => event.runId === runId);
  if (!run.some((event) => event.type === "context_loaded" && event.source.kind === "agents")) throw new Error("AGENTS.md was not loaded for this run");
  if (!run.some((event) => event.type === "context_loaded" && event.source.kind === "skill" && event.source.path.endsWith("/joke-master/SKILL.md"))) throw new Error("joke-master SKILL.md was not loaded");
  if (!run.some((event) => event.type === "file_access" && event.method === "readFile" && event.path.endsWith("/joke-master/references/scoring.md"))) throw new Error("Scoring reference was not actually read");
  for (const [path, file] of Object.entries(files)) if (!run.some((event) => event.type === "file_access" && event.method === "readFile" && event.path === path && event.revision === file.revision)) throw new Error(`File was not read at its current revision: ${path}`);
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  if (!/[\u3400-\u9fff]/u.test(prose)) throw new Error("Final answer must include Chinese prose");
  return answer;
}
