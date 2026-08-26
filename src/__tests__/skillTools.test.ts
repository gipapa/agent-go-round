import { describe, expect, it, vi } from "vitest";
import {
  buildSkillCapabilitySnapshot,
  createSkillInternalToolRunner,
  SKILL_LOAD_TOOL_ID,
  SKILL_READ_TOOL_ID,
  SKILL_INTERNAL_TOOL_DEFINITIONS,
  type HarnessSkillPackage
} from "../runtime/harness/skillTools";
import { buildBuiltinHarnessToolDefinitions } from "../runtime/toolEffectRunner";
import { projectModelContext } from "../runtime/harness/contextProjector";
import { runAgentLoop } from "../runtime/harness/runAgentLoop";
import type { BuiltInToolConfig, SkillConfig } from "../types";

function skill(id: string, patch: Partial<SkillConfig> = {}): HarnessSkillPackage {
  const config: SkillConfig = {
    id,
    name: id,
    version: "1.0.0",
    description: `${id} description`,
    workflow: { instructions: `Instructions for ${id}`, allowBuiltInTools: true, requiredToolIds: ["builtin:echo"] },
    skillMarkdown: `# ${id}`,
    rootPath: id,
    fileCount: 4,
    docCount: 1,
    scriptCount: 1,
    assetCount: 1,
    updatedAt: 0,
    ...patch
  };
  return {
    skill: config,
    docs: [{ id: `${id}:references/guide.md`, skillId: id, path: `${id}/references/guide.md`, title: "guide", content: "abcdef", updatedAt: 0 }],
    files: [
      { id: `${id}:${id}/SKILL.md`, skillId: id, path: `${id}/SKILL.md`, kind: "skill", content: config.skillMarkdown, updatedAt: 0 },
      { id: `${id}:references/guide.md`, skillId: id, path: `${id}/references/guide.md`, kind: "reference", content: "abcdef", updatedAt: 0 },
      { id: `${id}:assets/info.txt`, skillId: id, path: `${id}/assets/info.txt`, kind: "asset", content: "asset text", updatedAt: 0 },
      { id: `${id}:scripts/run.js`, skillId: id, path: `${id}/scripts/run.js`, kind: "script", content: "return 1", updatedAt: 0 }
    ]
  };
}

const echo: BuiltInToolConfig = {
  id: "echo",
  name: "echo",
  description: "Echo",
  code: "return input",
  updatedAt: 0,
  source: "system",
  readonly: true
};

describe("skill capability snapshot", () => {
  it("keeps disabled/required-missing skills out of automatic catalog while preserving explicit packages", () => {
    const packages = [skill("auto"), skill("manual", { workflow: { instructions: "manual", disableModelInvocation: true } }), skill("missing")];
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: true,
      skills: packages,
      externalTools: [],
      maxCatalogChars: 10_000
    });
    expect(snapshot.skills).toHaveLength(3);
    expect(snapshot.automaticCatalog).toEqual([]);
  });

  it("fails closed when the automatic catalog is too large", () => {
    const snapshot = buildSkillCapabilitySnapshot({ enabled: true, skills: [skill("large")], externalTools: [], maxCatalogChars: 1 });
    expect(snapshot.automaticCatalogError).toBe("skill_catalog_too_large");
    expect(snapshot.automaticCatalog).toEqual([]);
  });

  it("excludes instructions that exceed the runtime automatic-activation budget", () => {
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: true,
      skills: [skill("oversized", { workflow: { instructions: "x".repeat(20) } })],
      externalTools: [],
      maxCatalogChars: 10_000,
      maxSkillInstructionChars: 10
    });
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.automaticCatalog).toEqual([]);
  });

  it("copies and freezes nested skill policy data for the run snapshot", () => {
    const packageEntry = skill("immutable", {
      workflow: {
        instructions: "immutable",
        allowBuiltInTools: true,
        requiredToolIds: ["builtin:echo"],
        allowedBuiltInToolIds: ["builtin:echo"]
      }
    });
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: true,
      skills: [packageEntry],
      externalTools: buildBuiltinHarnessToolDefinitions([echo]),
      maxCatalogChars: 10_000
    });
    packageEntry.skill.workflow.requiredToolIds?.push("builtin:forged");
    packageEntry.skill.workflow.allowedBuiltInToolIds?.push("builtin:forged");
    expect(snapshot.skills[0].skill.workflow.requiredToolIds).toEqual(["builtin:echo"]);
    expect(snapshot.skills[0].skill.workflow.allowedBuiltInToolIds).toEqual(["builtin:echo"]);
    expect(Object.isFrozen(snapshot.skills[0].skill)).toBe(true);
    expect(Object.isFrozen(snapshot.skills[0].skill.workflow)).toBe(true);
    expect(Object.isFrozen(snapshot.skills[0].skill.workflow.requiredToolIds)).toBe(true);
  });

  it("keeps external tool definitions immutable even when skills are disabled", () => {
    const external = buildBuiltinHarnessToolDefinitions([echo]);
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: false,
      skills: [],
      externalTools: external,
      maxCatalogChars: 10_000
    });
    external[0].description = "forged after snapshot";
    expect(snapshot.externalTools[0].description).toBe("Echo");
    expect(Object.isFrozen(snapshot.externalTools[0])).toBe(true);
  });

  it("excludes a corrupted package snapshot before automatic or explicit activation", async () => {
    const valid = skill("valid");
    const corrupted = {
      ...skill("corrupted"),
      files: skill("corrupted").files.filter((file) => file.kind !== "skill")
    };
    const external = buildBuiltinHarnessToolDefinitions([echo]);
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: true,
      skills: [valid, corrupted],
      externalTools: external,
      maxCatalogChars: 10_000
    });
    expect(snapshot.skills.map(({ skill: entry }) => entry.id)).toEqual(["valid"]);
    expect(snapshot.automaticCatalog.map((entry) => entry.id)).toEqual(["valid"]);

    const runner = createSkillInternalToolRunner({
      snapshot,
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }
    });
    await expect(runner.execute({
      callId: "corrupted-load",
      toolId: SKILL_LOAD_TOOL_ID,
      input: { skillId: "corrupted" },
      origin: "controller"
    }, {
      signal: new AbortController().signal,
      runId: "run",
      generation: 1,
      definition: SKILL_INTERNAL_TOOL_DEFINITIONS[0]
    })).resolves.toMatchObject({ outcome: "failed_before_dispatch", errorCode: "skill_unavailable" });
  });

  it("does not advertise a required tool that the skill policy excludes", async () => {
    const blocked = skill("blocked", {
      workflow: { instructions: "blocked", allowBuiltInTools: false, requiredToolIds: ["builtin:echo"] }
    });
    const external = buildBuiltinHarnessToolDefinitions([echo]);
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: true,
      skills: [blocked],
      externalTools: external,
      maxCatalogChars: 10_000
    });
    expect(snapshot.automaticCatalog).toEqual([]);
    const runner = createSkillInternalToolRunner({
      snapshot,
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }
    });
    await expect(runner.execute({
      callId: "blocked-load",
      toolId: SKILL_LOAD_TOOL_ID,
      input: { skillId: "blocked" },
      origin: "controller"
    }, {
      signal: new AbortController().signal,
      runId: "run",
      generation: 1,
      definition: SKILL_INTERNAL_TOOL_DEFINITIONS[0]
    })).resolves.toMatchObject({ outcome: "failed_before_dispatch", errorCode: "required_tool_unavailable" });
  });
});

describe("skill internal tools", () => {
  it("resolves an allowed skill by its stable name aliases", async () => {
    const packageEntry = skill("stable-id", {
      name: "Tutorial Skill",
      skillMarkdown: "---\nname: tutorial-slug\ndescription: Tutorial skill\n---\n# Tutorial Skill"
    });
    const snapshot = buildSkillCapabilitySnapshot({
      enabled: true,
      skills: [packageEntry],
      externalTools: buildBuiltinHarnessToolDefinitions([echo]),
      maxCatalogChars: 10_000
    });
    const runner = createSkillInternalToolRunner({
      snapshot,
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }
    });
    const context = {
      signal: new AbortController().signal,
      runId: "run",
      generation: 1,
      definition: SKILL_INTERNAL_TOOL_DEFINITIONS[0]
    };

    await expect(runner.execute({
      callId: "load-by-frontmatter-name",
      toolId: SKILL_LOAD_TOOL_ID,
      input: { skillId: "tutorial-slug" },
      origin: "model"
    }, context)).resolves.toMatchObject({ outcome: "success" });
  });

  it("loads an explicit skill once, blocks switching, and intersects external tools", async () => {
    const one = skill("one");
    const two = skill("two", { workflow: { instructions: "two", disableModelInvocation: true, allowBuiltInTools: true, requiredToolIds: ["builtin:echo"] } });
    const external = buildBuiltinHarnessToolDefinitions([echo, {
      ...echo,
      id: "other",
      name: "other"
    }]);
    const snapshot = buildSkillCapabilitySnapshot({ enabled: true, skills: [one, two], externalTools: external, maxCatalogChars: 10_000 });
    const loaded = vi.fn();
    const runner = createSkillInternalToolRunner({ snapshot, budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }, onSkillLoaded: loaded });
    const loadDefinition = SKILL_INTERNAL_TOOL_DEFINITIONS.find((definition) => definition.id === SKILL_LOAD_TOOL_ID)!;
    const readDefinition = SKILL_INTERNAL_TOOL_DEFINITIONS.find((definition) => definition.id === SKILL_READ_TOOL_ID)!;
    const context = { signal: new AbortController().signal, runId: "run", generation: 1, definition: loadDefinition };
    const explicitCall = { callId: "c1", toolId: SKILL_LOAD_TOOL_ID, input: { skillId: "manual" }, origin: "controller" as const };
    const explicitPackage = skill("manual", { workflow: { instructions: "manual", allowBuiltInTools: true } });
    const explicitRunner = createSkillInternalToolRunner({
      snapshot: buildSkillCapabilitySnapshot({ enabled: true, skills: [explicitPackage], externalTools: external, maxCatalogChars: 10_000 }),
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 },
      onSkillLoaded: loaded
    });
    await expect(explicitRunner.execute(explicitCall, context)).resolves.toMatchObject({ outcome: "success" });
    expect(explicitRunner.getScopedTools().map((tool) => tool.id)).toEqual(["builtin:echo", "builtin:other"]);
    await expect(explicitRunner.execute({ ...explicitCall, callId: "c2", input: { skillId: "other" } }, context)).resolves.toMatchObject({ errorCode: "skill_unavailable" });

    const modelRunner = createSkillInternalToolRunner({ snapshot, budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 } });
    await expect(modelRunner.execute({ ...explicitCall, input: { skillId: "two" }, origin: "model" }, context)).resolves.toMatchObject({ errorCode: "skill_requires_explicit_activation" });
    expect(loaded).toHaveBeenCalled();
    void readDefinition;
  });

  it("reads bounded cached chunks and rejects traversal/scripts", async () => {
    const pkg = skill("reader");
    const onRead = vi.fn();
    const runner = createSkillInternalToolRunner({
      snapshot: buildSkillCapabilitySnapshot({ enabled: true, skills: [pkg], externalTools: [buildBuiltinHarnessToolDefinitions([echo])[0]], maxCatalogChars: 10_000 }),
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 4 },
      onResourceLoaded: onRead
    });
    const loadDefinition = SKILL_INTERNAL_TOOL_DEFINITIONS[0];
    const context = { signal: new AbortController().signal, runId: "run", generation: 1, definition: loadDefinition };
    await runner.execute({ callId: "load", toolId: SKILL_LOAD_TOOL_ID, input: { skillId: "reader" }, origin: "model" }, context);
    const read = await runner.execute({ callId: "read", toolId: SKILL_READ_TOOL_ID, input: { path: "references/guide.md", offset: 0, maxChars: 3 }, origin: "model" }, context);
    expect(read.modelContent).toContain("abc");
    const cached = await runner.execute({ callId: "read-again", toolId: SKILL_READ_TOOL_ID, input: { path: "references/guide.md", offset: 0, maxChars: 3 }, origin: "model" }, context);
    expect(cached.modelContent).toBe(read.modelContent);
    expect(onRead).toHaveBeenCalledOnce();
    await expect(runner.execute({ callId: "bad", toolId: SKILL_READ_TOOL_ID, input: { path: "../secrets" }, origin: "model" }, context)).resolves.toMatchObject({ errorCode: "invalid_resource_path" });
    await expect(runner.execute({ callId: "script", toolId: SKILL_READ_TOOL_ID, input: { path: "scripts/run.js" }, origin: "model" }, context)).resolves.toMatchObject({ errorCode: "resource_not_readable" });
  });

  it("limits distinct resource reads within one run", async () => {
    const pkg = skill("resource-limit", { workflow: { instructions: "resources", requiredToolIds: [] } });
    const files = [
      ...pkg.files,
      ...[1, 2, 3, 4].map((index) => ({
        id: `resource-limit:assets/${index}.txt`,
        skillId: "resource-limit",
        path: `resource-limit/assets/${index}.txt`,
        kind: "asset" as const,
        content: `resource-${index}`,
        updatedAt: 0
      }))
    ];
    const runner = createSkillInternalToolRunner({
      snapshot: buildSkillCapabilitySnapshot({
        enabled: true,
        skills: [{ ...pkg, files }],
        externalTools: [],
        maxCatalogChars: 10_000
      }),
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }
    });
    const signal = new AbortController().signal;
    const context = { signal, runId: "run", generation: 1, definition: SKILL_INTERNAL_TOOL_DEFINITIONS[0] };
    await runner.execute({ callId: "load", toolId: SKILL_LOAD_TOOL_ID, input: { skillId: "resource-limit" }, origin: "model" }, context);
    for (let index = 1; index <= 3; index += 1) {
      await expect(runner.execute({ callId: `read-${index}`, toolId: SKILL_READ_TOOL_ID, input: { path: `assets/${index}.txt` }, origin: "model" }, context)).resolves.toMatchObject({ outcome: "success" });
    }
    await expect(runner.execute({ callId: "read-4", toolId: SKILL_READ_TOOL_ID, input: { path: "assets/4.txt" }, origin: "model" }, context)).resolves.toMatchObject({
      outcome: "rejected",
      errorCode: "resource_limit"
    });
  });

  it("honors useSkillDocs when exposing reference resources", async () => {
    const pkg = skill("docs-disabled", {
      workflow: { instructions: "no docs", allowBuiltInTools: false, requiredToolIds: [], useSkillDocs: false }
    });
    const runner = createSkillInternalToolRunner({
      snapshot: buildSkillCapabilitySnapshot({ enabled: true, skills: [pkg], externalTools: [], maxCatalogChars: 10_000 }),
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }
    });
    const context = { signal: new AbortController().signal, runId: "run", generation: 1, definition: SKILL_INTERNAL_TOOL_DEFINITIONS[0] };
    await expect(runner.execute({ callId: "load", toolId: SKILL_LOAD_TOOL_ID, input: { skillId: "docs-disabled" }, origin: "model" }, context)).resolves.toMatchObject({ outcome: "success" });
    await expect(runner.execute({ callId: "reference", toolId: SKILL_READ_TOOL_ID, input: { path: "references/guide.md" }, origin: "model" }, context)).resolves.toMatchObject({
      outcome: "failed_before_dispatch",
      errorCode: "resource_unavailable"
    });
    await expect(runner.execute({ callId: "asset", toolId: SKILL_READ_TOOL_ID, input: { path: "assets/info.txt" }, origin: "model" }, context)).resolves.toMatchObject({ outcome: "success" });
  });

  it("never projects binary resource bytes into the text loop", async () => {
    const pkg = skill("binary");
    const binaryPackage = {
      ...pkg,
      files: [
        ...pkg.files,
        { id: "binary:assets/data.txt", skillId: "binary", path: "binary/assets/data.txt", kind: "asset" as const, content: new Uint8Array([0xff, 0x00, 0xfe]), updatedAt: 0 }
      ]
    } satisfies HarnessSkillPackage;
    const runner = createSkillInternalToolRunner({
      snapshot: buildSkillCapabilitySnapshot({ enabled: true, skills: [binaryPackage], externalTools: [buildBuiltinHarnessToolDefinitions([echo])[0]], maxCatalogChars: 10_000 }),
      budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 }
    });
    const context = { signal: new AbortController().signal, runId: "run", generation: 1, definition: SKILL_INTERNAL_TOOL_DEFINITIONS[0] };
    await runner.execute({ callId: "load", toolId: SKILL_LOAD_TOOL_ID, input: { skillId: "binary" }, origin: "model" }, context);
    await expect(runner.execute({ callId: "binary-read", toolId: SKILL_READ_TOOL_ID, input: { path: "assets/data.txt" }, origin: "model" }, context)).resolves.toMatchObject({
      outcome: "rejected",
      errorCode: "binary_resource"
    });
  });

  it("runs skill activation, external action, and final answer through one loop", async () => {
    const pkg = skill("loop");
    const external = buildBuiltinHarnessToolDefinitions([echo]);
    const snapshot = buildSkillCapabilitySnapshot({ enabled: true, skills: [pkg], externalTools: external, maxCatalogChars: 10_000 });
    const internal = createSkillInternalToolRunner({ snapshot, budget: { maxSkillInstructionChars: 1_000, maxResourceChars: 1_000 } });
    const allInitialTools = [...SKILL_INTERNAL_TOOL_DEFINITIONS, ...external];
    const transportSteps = [
      { status: "step" as const, candidateId: "fake", step: { type: "tool_call" as const, toolId: SKILL_LOAD_TOOL_ID, input: { skillId: "loop" } } },
      { status: "step" as const, candidateId: "fake", step: { type: "tool_call" as const, toolId: "builtin:echo", input: { value: 1 } } },
      { status: "step" as const, candidateId: "fake", step: { type: "final" as const, answer: "complete" } }
    ];
    const result = await runAgentLoop({
      runId: "skill-loop",
      generation: 1,
      userInput: "use the loop skill",
      tools: allInitialTools,
      transport: { runStep: async () => transportSteps.shift()! },
      effectRunner: {
        execute: async (call, toolContext) => call.toolId.startsWith("internal:")
          ? await internal.execute(call, toolContext)
          : { outcome: "success", modelContent: "echoed", displaySummary: "echoed", effectDispatched: true }
      },
      getTools: () => internal.getLoadedSkill() ? [...SKILL_INTERNAL_TOOL_DEFINITIONS, ...internal.getScopedTools()] : allInitialTools,
      projectContext: ({ transcript, tools }) => projectModelContext({ transcript, tools })
    });
    expect(result.stopReason).toBe("final");
    expect(result.transcript.filter((message) => message.role === "tool").map((message) => message.toolId)).toEqual([
      SKILL_LOAD_TOOL_ID,
      "builtin:echo"
    ]);
  });
});
