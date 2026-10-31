import { expect, it } from "vitest";
import { validateJokeAnswer } from "./joke-validation";
import type { SessionEvent } from "../core/session";

it("rejects a plausible score table if any required file was not actually read", () => {
  const files = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`/home/user/jokes/笑話${index + 1}.md`, { content: `內容${index + 1}`, revision: 2 }]));
  const paths = Object.keys(files);
  const text = "以下是評分。\n```json\n" + JSON.stringify({ scores: paths.map((path) => ({ path, score: 8, reason: "出人意料的笑點" })), winner: { path: paths[0], text: files[paths[0]].content, reason: "最好笑的轉折" } }) + "\n```";
  const shared = { version: 1 as const, sessionId: "s", runId: "r" };
  const events: SessionEvent[] = [
    { ...shared, type: "context_loaded", source: { kind: "agents", path: "/home/user/AGENTS.md", revision: 1 } },
    { ...shared, type: "context_loaded", source: { kind: "skill", path: "/home/user/.pi/skills/joke-master/SKILL.md", revision: 1 } },
    { ...shared, type: "file_access", toolCallId: "reference", method: "readFile", path: "/home/user/.pi/skills/joke-master/references/scoring.md", revision: 1 },
    ...paths.map((path) => ({ ...shared, type: "file_access" as const, toolCallId: path, method: "readFile", path, revision: 2 }))
  ];
  expect(validateJokeAnswer(text, files, events, "r").scores).toHaveLength(5);
  expect(() => validateJokeAnswer(text, files, events.slice(0, -1), "r")).toThrow(/not read/);
  expect(() => validateJokeAnswer(text, files, events.map((event) => event.type === "file_access" && event.path === paths[0] ? { ...event, revision: 1 } : event), "r")).toThrow(/current revision/);
});
