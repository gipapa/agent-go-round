import { describe, expect, it, vi } from "vitest";
import { createDecisionRunners, type InvokeDecisionArgs } from "../runtime/decisionRunners";
import type { AgentConfig, LoadedSkillRuntime, SkillConfig } from "../types";

const agent: AgentConfig = { id: "agent-1", name: "Agent One", type: "openai_compat" };
const skill: SkillConfig = {
  id: "skill-1",
  name: "Research",
  version: "1.0.0",
  description: "Research a topic",
  workflow: {},
  skillMarkdown: "# Research",
  rootPath: "research",
  fileCount: 1,
  docCount: 0,
  scriptCount: 0,
  assetCount: 0,
  updatedAt: 1
};
const runtime: LoadedSkillRuntime = {
  skillId: skill.id,
  name: skill.name,
  description: skill.description,
  instructions: "Research carefully",
  referencedPaths: [],
  loadedReferences: [],
  assetPaths: [],
  loadedAssets: [],
  allowMcp: true,
  allowBuiltInTools: true
};

describe("decision runners", () => {
  it("builds and parses a tool decision through the injected agent runtime", async () => {
    const invoke = vi.fn(async (_args: InvokeDecisionArgs) => '{"type":"builtin_tool_call","tool":"clock","input":{}}');
    const pushLog = vi.fn();
    const runners = createDecisionRunners({ invoke, pushLog });

    const result = await runners.runToolDecision({
      agent,
      userInput: "What time is it?",
      retry: { max: 0, delaySec: 0 },
      toolEntries: [],
      promptTemplate: "Request={{userInput}}\nTools={{toolListJson}}",
      fallbackPromptTemplate: "fallback",
      requestId: "request-1"
    });

    expect(result).toEqual({ type: "builtin_tool_call", tool: "clock", input: {} });
    expect(invoke).toHaveBeenCalledOnce();
    const invocation = invoke.mock.calls[0][0];
    expect(invocation).toMatchObject({
      agent,
      requestId: "request-1",
      requestLabel: "tool decision"
    });
    expect(invocation.input).toContain("What time is it?");
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ ok: true, message: "Tool decision: builtin_tool_call" }));
  });

  it("normalizes a skill decision and records its outcome", async () => {
    const invoke = vi.fn(async () => '{"type":"no_skill"}');
    const pushLog = vi.fn();
    const runners = createDecisionRunners({ invoke, pushLog });

    await expect(runners.runSkillDecision({
      agent,
      userInput: "Say hello",
      retry: { max: 0, delaySec: 0 },
      skills: [skill],
      language: "en"
    })).resolves.toEqual({ type: "no_skill" });

    expect(invoke.mock.calls[0][0].input).toContain("Research");
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ category: "skills", ok: true }));
  });

  it("uses the deterministic bootstrap fallback after invalid model output", async () => {
    const invoke = vi.fn(async () => "not json");
    const pushLog = vi.fn();
    const onTrace = vi.fn();
    const runners = createDecisionRunners({ invoke, pushLog });

    const result = await runners.runSkillBootstrapPlan({
      agent,
      retry: { max: 0, delaySec: 0 },
      skill,
      runtime,
      userInput: "Review https://example.com/repo",
      onTrace
    });

    expect(result.startUrl).toBe("https://example.com/repo");
    expect(result.todo).toHaveLength(5);
    expect(onTrace).toHaveBeenCalledWith("Bootstrap raw", "not json");
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      message: "Skill bootstrap plan invalid schema (1/1)"
    }));
  });
});
