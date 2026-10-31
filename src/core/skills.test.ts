import { describe, expect, it } from "vitest";
import { composeSystemPrompt, loadSkills, MemorySkillLoader, SkillLoadError } from "./skills";

describe("skills loader", () => {
  const loader = new MemorySkillLoader([
    { id: "review", name: "Review", description: "Review text", instructions: "Check facts before answering." },
    { id: "concise", name: "Concise", description: "Keep answers short", instructions: "Use short, direct sentences." }
  ]);

  it("loads only explicitly requested skills and composes a deterministic prompt", async () => {
    const loaded = await loadSkills(loader, ["review", "review"]);

    expect(loaded.skillIds).toEqual(["review"]);
    expect(loaded.instructions).toBe("## Skill: Review (review)\nCheck facts before answering.");
    expect(composeSystemPrompt("Base rules.", loaded)).toBe("Base rules.\n\n## Skill: Review (review)\nCheck facts before answering.");
  });

  it("fails closed for unknown skills and instruction limits", async () => {
    await expect(loadSkills(loader, ["missing"])).rejects.toBeInstanceOf(SkillLoadError);
    await expect(loadSkills(loader, ["review"], { maxInstructionCharacters: 2 })).rejects.toThrow(/exceed/);
  });

  it("lists metadata without eagerly exposing instruction bodies", async () => {
    await expect(loader.list()).resolves.toEqual([
      { id: "review", name: "Review", description: "Review text" },
      { id: "concise", name: "Concise", description: "Keep answers short" }
    ]);
  });
});
