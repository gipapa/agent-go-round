import { describe, expect, it } from "vitest";
import { jokeContextFromFiles, validateJokeAnswer, type JokeAnswer } from "./joke-validation";
import type { SessionEvent } from "../core/session";

function fixture() {
  const files = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`/home/user/jokes/笑話${index + 1}.md`, { content: `內容${index + 1}\n最後一行\n`, revision: 2 }]));
  const paths = Object.keys(files);
  const context = jokeContextFromFiles([
    { path: "/home/user/AGENTS.md", content: "使用繁體中文。", revision: 2 },
    { path: "/home/user/skills/joke-master/SKILL.md", content: "最新的指示。", revision: 3 },
    { path: "/home/user/skills/joke-master/references/scoring.md", content: "評分準則\n完整內容", revision: 4 }
  ]);
  const answer: JokeAnswer = { scores: paths.map(path => ({ path, score: 8, reason: "出人意料的笑點" })), winner: { path: paths[0], text: files[paths[0]].content, reason: "最好笑的轉折" } };
  const shared = { version: 1 as const, sessionId: "s", runId: "r" };
  const events: SessionEvent[] = [
    ...(["agents", "skill"] as const).map(kind => ({ ...shared, type: "context_loaded" as const, source: { kind, path: context[kind].path, revision: context[kind].revision } })),
    ...[context.scoring, ...paths.map(path => ({ path, ...files[path] }))].flatMap(file => [
      { ...shared, type: "file_access" as const, toolCallId: file.path, method: "readFile", path: file.path, revision: file.revision, readRange: { startLine: 1, endLine: file.content.split("\n").length, totalLines: file.content.split("\n").length } },
      { ...shared, type: "tool_finished" as const, toolCallId: file.path, toolName: "read", isError: false }
    ])
  ];
  const render = (value = answer) => "以下是評分。\n```json\n" + JSON.stringify(value) + "\n```";
  return { files, paths, context, answer, events, shared, render, validate: (trace = events, text = render()) => validateJokeAnswer(text, files, trace, "r", context) };
}

describe("joke acceptance evidence", () => {
  it("requires five current files and the complete winner text", () => {
    const { validate, answer, render } = fixture();
    expect(validate().scores).toHaveLength(5);
    expect(() => validate(undefined, render({ ...answer, winner: { ...answer.winner, text: answer.winner.text.trim() } }))).toThrow(/does not match/);
    expect(() => validate(undefined, render({ ...answer, winner: { ...answer.winner, text: undefined } } as unknown as JokeAnswer))).toThrow(/does not match/);
    expect(() => validate(undefined, render({ ...answer, scores: [...answer.scores.slice(0, 4), answer.scores[0]] }))).toThrow(/exactly one/);
  });

  it.each(["agents", "skill"] as const)("rejects missing, misplaced or stale %s instructions", kind => {
    const { events, validate } = fixture();
    for (const patch of [{ path: "/home/user/wrong.md" }, { revision: 1 }]) {
      expect(() => validate(events.map(event => event.type === "context_loaded" && event.source.kind === kind ? { ...event, source: { ...event.source, ...patch } } : event))).toThrow(/current VFS path\/revision/);
    }
    expect(() => validate(events.filter(event => event.type !== "context_loaded" || event.source.kind !== kind))).toThrow(/not loaded/);
  });

  it("rejects unread files, stale references, failed tools and another run's reads", () => {
    const { events, paths, validate, context } = fixture();
    expect(() => validate(events.filter(event => event.type !== "file_access" || event.path !== paths[0]))).toThrow(/not read completely/);
    for (const path of [paths[0], context.scoring.path]) {
      expect(() => validate(events.map(event => event.type === "file_access" && event.path === path ? { ...event, revision: 1 } : event))).toThrow(/current revision/);
    }
    expect(() => validate(events.map(event => event.type === "tool_finished" ? { ...event, isError: true } : event))).toThrow(/not read completely/);
    expect(() => validate(events.map(event => event.type === "file_access" ? { ...event, runId: "previous" } : event))).toThrow(/not read completely/);
    expect(() => validate(events.map(event => event.type === "file_access" ? { ...event, readRange: undefined } : event))).toThrow(/not read completely/);
  });

  it("requires every page without gaps at the same revision", () => {
    const { events, paths, validate } = fixture();
    const first = events.find(event => event.type === "file_access" && event.path === paths[0])!;
    if (first.type !== "file_access") throw new Error("Missing fixture");
    const rest = events.filter(event => event !== first);
    const page = (startLine: number, endLine: number): SessionEvent => ({ ...first, readRange: { startLine, endLine, totalLines: 3 } });
    expect(() => validate([...rest, page(1, 1)])).toThrow(/not read completely/);
    expect(() => validate([...rest, page(1, 1), page(3, 3)])).toThrow(/not read completely/);
    expect(validate([...rest, page(3, 3), page(1, 2)]).scores).toHaveLength(5);
  });

  it("accepts lowercase aliases only in the designated VFS locations", () => {
    const { context } = fixture();
    const files = [context.agents, context.skill, context.scoring];
    expect(jokeContextFromFiles(files.map(file => ({ ...file, path: file.path.replace("AGENTS.md", "agents.md").replace("SKILL.md", "skill.md") }))).skill.path).toMatch(/\/joke-master\/skill\.md$/);
    expect(() => jokeContextFromFiles(files.map(file => ({ ...file, path: file.path.replace("/skills/", "/.pi/skills/") })))).toThrow(/Expected one VFS/);
    expect(() => jokeContextFromFiles([...files, { ...context.agents, path: "/home/user/agents.md" }])).toThrow(/Expected one VFS/);
  });
});
