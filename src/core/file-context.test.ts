import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./fs";
import { prepareFileContext, VfsSkillLoader } from "./file-context";
import { installJokeDemo } from "./joke-demo";
import { configureFileAgent } from "./file-context";
import { createScriptedSession, createScriptedStreamFn } from "./scripted";
import { AgentSession } from "./session";
import { BinRegistry } from "./bin";
import { installDefaultBin } from "./bin-defaults";

describe("VFS instructions and skills", () => {
  it("loads hierarchical AGENTS, exposes metadata only, and reads selected skill from disk", async () => {
    const fs = new MemoryFileSystem();
    await installJokeDemo(fs);
    await fs.mkdir("~/project");
    await fs.writeFile("~/project/agents.md", "Use short answers.");
    await fs.writeFile("~/document.md", "This is document data, never an automatic instruction.");
    const context = await prepareFileContext(fs, "/home/user/project");
    expect(context.sources.map((source) => source.path)).toEqual(["/home/user/AGENTS.md", "/home/user/project/agents.md"]);
    expect(context.systemPrompt).toContain("即使使用者使用英文提問");
    expect(context.systemPrompt).not.toContain("意外性（40%）");
    expect(context.systemPrompt).not.toContain("必須用 read 工具讀取每個笑話");
    expect(context.systemPrompt).not.toContain("This is document data");
    const loader = new VfsSkillLoader(fs);
    const loaded = await loader.load("joke-master", context.skills);
    expect(loaded.instructions).toContain("必須用 read 工具讀取每個笑話");
    const selected = await prepareFileContext(fs, "/home/user", "joke-master");
    expect(selected.systemPrompt).toContain(loaded.instructions);
    expect(selected.sources.at(-1)).toMatchObject({ kind: "skill", revision: 1 });
  });

  it("refreshes rules on the next turn and rejects mid-run changes or ambiguous files", async () => {
    const fs = new MemoryFileSystem();
    await installJokeDemo(fs);
    const first = await prepareFileContext(fs, "/home/user");
    await fs.writeFile("~/AGENTS.md", "新的規則，只說中文。");
    const next = await prepareFileContext(fs, "/home/user");
    expect(next.systemPrompt).toContain("新的規則");
    expect(next.systemPrompt).not.toContain("即使使用者使用英文提問");
    const oldSkill = await fs.readFile("~/skills/joke-master/SKILL.md");
    await fs.writeFile(oldSkill.path, oldSkill.content + "\nChanged");
    await expect(new VfsSkillLoader(fs).load("joke-master", first.skills)).rejects.toThrow(/changed during/);
    await fs.writeFile("~/agents.md", "ambiguous");
    await expect(prepareFileContext(fs, "/home/user")).rejects.toThrow(/Ambiguous/);
  });

  it("validates frontmatter, duplicate names, missing files and non-overwriting fixtures", async () => {
    const fs = new MemoryFileSystem();
    await installJokeDemo(fs);
    await fs.writeFile("~/jokes/笑話1.md", "user content");
    expect((await installJokeDemo(fs)).kept).toHaveLength(8);
    expect((await fs.readFile("~/jokes/笑話1.md")).content).toBe("user content");
    await fs.mkdir("~/skills/second");
    const first = await fs.readFile("~/skills/joke-master/SKILL.md");
    await fs.writeFile("~/skills/second/SKILL.md", first.content);
    await expect(new VfsSkillLoader(fs).discover()).rejects.toThrow(/Duplicate/);
    await fs.writeFile("~/skills/second/SKILL.md", "no frontmatter");
    await expect(new VfsSkillLoader(fs).discover()).rejects.toThrow(/frontmatter/);
    await fs.remove("~/skills/second/SKILL.md");
    await expect(new VfsSkillLoader(fs).load("missing", [])).rejects.toThrow(/Unknown/);
  });

  it("restores the active skill and refreshes its instructions on the next run", async () => {
    const fs = new MemoryFileSystem(); await installJokeDemo(fs);
    const session = createScriptedSession([]);
    await installDefaultBin(fs);
    const bin = new BinRegistry(fs, { async execute() { throw new Error("Not used in context preparation test"); } });
    await bin.reload();
    await configureFileAgent(session, fs, "/home/user", bin, "joke-master");
    const file = await fs.readFile("~/skills/joke-master/SKILL.md");
    await fs.writeFile(file.path, file.content + "\n新的評分指示。");
    const restored = AgentSession.fromSnapshot(session.snapshot(), { streamFn: createScriptedStreamFn([]) });
    const next = await configureFileAgent(restored, fs, "/home/user", bin);
    expect(next.systemPrompt).toContain("新的評分指示");
    expect(next.sources.at(-1)).toMatchObject({ kind: "skill", revision: 2 });
  });
});
