import type { SessionEvent } from "../core/session";
export type JokeAnswer = { scores: Array<{ path: string; score: number; reason: string }>; winner: { path: string; text: string; reason: string } };
type EvidenceFile = { path: string; content: string; revision: number };
export type JokeContext = { agents: EvidenceFile; skill: EvidenceFile; scoring: EvidenceFile };

/** Resolve acceptance sources from actual VFS nodes, independently of the loader under test. */
export function jokeContextFromFiles(files: readonly EvidenceFile[]): JokeContext {
  function required(paths: string[]): EvidenceFile {
    const matches = files.filter(file => paths.includes(file.path));
    if (matches.length !== 1) throw new Error(`Expected one VFS instruction/reference file at ${paths.join(" or ")}`);
    return matches[0];
  }
  return {
    agents: required(["/home/user/AGENTS.md", "/home/user/agents.md"]),
    skill: required(["/home/user/skills/joke-master/SKILL.md", "/home/user/skills/joke-master/skill.md"]),
    scoring: required(["/home/user/skills/joke-master/references/scoring.md"])
  };
}

export function parseJokeAnswer(text: string): JokeAnswer {
  const block = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1)?.[1] ?? text;
  try { return JSON.parse(block.trim()) as JokeAnswer; }
  catch { throw new Error("Final answer does not contain the required score JSON"); }
}

export function validateJokeAnswer(text: string, files: Record<string, { content: string; revision: number }>, events: readonly SessionEvent[], runId: string, context: JokeContext): JokeAnswer {
  const answer = parseJokeAnswer(text);
  const expected = Object.keys(files).sort();
  if (expected.length !== 5 || !answer || !Array.isArray(answer.scores) || answer.scores.some(item => !item || typeof item.path !== "string") || JSON.stringify(answer.scores.map((item) => item.path).sort()) !== JSON.stringify(expected)) throw new Error("Expected exactly one score for each of the five joke files");
  for (const item of answer.scores) {
    if (!Number.isFinite(item.score) || item.score < 1 || item.score > 10 || typeof item.reason !== "string" || !/[\u3400-\u9fff]/u.test(item.reason)) throw new Error(`Invalid score or non-Chinese explanation: ${item.path}`);
  }
  const winner = answer.winner;
  if (!winner || !Object.hasOwn(files, winner.path) || typeof winner.reason !== "string" || !/[\u3400-\u9fff]/u.test(winner.reason)) throw new Error("Winner is missing or not explained in Chinese");
  if (typeof winner.text !== "string" || winner.text !== files[winner.path].content) throw new Error("Winner text does not match the actual file");
  if (answer.scores.find((item) => item.path === winner.path)!.score !== Math.max(...answer.scores.map((item) => item.score))) throw new Error("Winner does not have the highest score");
  const run = events.filter((event) => event.runId === runId);
  for (const kind of ["agents", "skill"] as const) {
    const file = context[kind];
    if (!run.some(event => event.type === "context_loaded" && event.source.kind === kind && event.source.path === file.path && event.source.revision === file.revision)) throw new Error(`${kind === "agents" ? "AGENTS.md" : "joke-master SKILL.md"} was not loaded at its current VFS path/revision`);
  }
  function requireCompleteRead(file: EvidenceFile): void {
    const totalLines = file.content.split("\n").length;
    const successfulTools = new Set(run.flatMap(event => event.type === "tool_finished" && !event.isError ? [event.toolCallId] : []));
    const ranges = run.flatMap(event => {
      if (event.type !== "file_access" || event.method !== "readFile" || event.path !== file.path || event.revision !== file.revision || event.readRange?.totalLines !== totalLines || !successfulTools.has(event.toolCallId)) return [];
      return [event.readRange];
    }).sort((a, b) => a.startLine - b.startLine);
    let covered = 0;
    for (const range of ranges) {
      if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine || range.endLine > totalLines || range.startLine > covered + 1) continue;
      covered = Math.max(covered, range.endLine);
    }
    if (covered !== totalLines) throw new Error(`File was not read completely at its current revision: ${file.path}`);
  }
  requireCompleteRead(context.scoring);
  for (const [path, file] of Object.entries(files)) requireCompleteRead({ path, ...file });
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  if (!/[\u3400-\u9fff]/u.test(prose)) throw new Error("Final answer must include Chinese prose");
  return answer;
}
