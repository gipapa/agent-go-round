import { afterEach, describe, expect, it } from "vitest";
import { McpClientManager } from "../mcp/clientManager";
import { runHarnessOneToOne } from "../orchestrators/harnessOneToOne";
import type { AgentAdapter } from "../adapters/base";
import type { BuiltInToolConfig, SkillConfig } from "../types";
import type { HarnessSkillPackage } from "../runtime/harness/skillTools";
import type { HarnessEvent, HarnessMessage } from "../runtime/harness/types";

const echo: BuiltInToolConfig = {
  id: "echo",
  name: "echo",
  description: "Read an input value.",
  code: "return input.value;",
  inputSchema: { type: "object", properties: { value: { type: "number" } } },
  updatedAt: 0,
  source: "system",
  readonly: true
};

const packageForTest: HarnessSkillPackage = {
  skill: {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "Demo skill",
    workflow: { instructions: "Use the echo tool.", allowBuiltInTools: true, requiredToolIds: ["builtin:echo"] },
    skillMarkdown: "# Demo",
    rootPath: "demo",
    fileCount: 1,
    docCount: 0,
    scriptCount: 0,
    assetCount: 0,
    updatedAt: 0
  } satisfies SkillConfig,
  docs: [],
  files: [{
    id: "demo:demo/SKILL.md",
    skillId: "demo",
    path: "demo/SKILL.md",
    kind: "skill",
    content: "# Demo",
    updatedAt: 0
  }]
};

describe("harness one-to-one composition", () => {
  const managers: McpClientManager[] = [];

  afterEach(() => managers.splice(0).forEach((manager) => manager.closeAll()));

  it("uses one canonical loop for skill load, tool effect, and final", async () => {
    const responses = [
      '{"type":"tool_call","toolId":"internal:skill.load","input":{"skillId":"demo"}}',
      '{"type":"tool_call","toolId":"builtin:echo","input":{"value":42}}',
      "The task is complete."
    ];
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: responses.shift() ?? "" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const events: HarnessEvent[] = [];
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true, allowedSkillIds: ["demo"] },
      adapter,
      input: "run demo",
      skills: [packageForTest],
      availableBuiltinTools: [echo],
      mcpClientManager: manager,
      runId: "run-1",
      generation: 1,
      emit: (event) => events.push(event)
    });
    expect(result.stopReason).toBe("final");
    expect(result.finalAnswer).toBe("The task is complete.");
    expect(result.transcript.filter((message) => message.role === "tool").map((message) => message.toolId)).toEqual([
      "internal:skill.load",
      "builtin:echo"
    ]);
  });

  it("honors a skill's agent-doc policy after the skill is loaded", async () => {
    const systems: string[] = [];
    const responses = [
      '{"type":"tool_call","toolId":"internal:skill.load","input":{"skillId":"demo"}}',
      "done"
    ];
    const adapter: AgentAdapter = {
      async *chat(request) {
        systems.push(request.system ?? "");
        yield { type: "done", text: responses.shift() ?? "" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true, allowedSkillIds: ["demo"] },
      adapter,
      input: "run without agent docs",
      docs: [{ id: "secret", title: "Private", content: "PRIVATE_AGENT_DOCUMENT", updatedAt: 0 }],
      skills: [packageForTest],
      availableBuiltinTools: [echo],
      mcpClientManager: manager,
      runId: "run-agent-doc-policy",
      generation: 1
    });
    expect(result.stopReason).toBe("final");
    expect(systems[0]).toContain("PRIVATE_AGENT_DOCUMENT");
    expect(systems[1]).not.toContain("PRIVATE_AGENT_DOCUMENT");
  });

  it("tells the model to load a matching skill before using external tools", async () => {
    let system = "";
    const adapter: AgentAdapter = {
      async *chat(request) {
        system = request.system ?? "";
        yield { type: "done", text: "done" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true, allowedSkillIds: ["demo"] },
      adapter,
      input: "run demo",
      skills: [packageForTest],
      availableBuiltinTools: [echo],
      mcpClientManager: manager,
      runId: "run-skill-guidance",
      generation: 1
    });
    expect(result.stopReason).toBe("final");
    expect(system).toContain("first call internal:skill.load");
    expect(system).toContain("[UNTRUSTED_SKILL_CATALOG]");
  });

  it("allows controller-origin explicit activation of model-disabled skills", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: "explicit skill answer" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const events: HarnessEvent[] = [];
    const explicitSkill = {
      ...packageForTest,
      skill: {
        ...packageForTest.skill,
        workflow: { ...packageForTest.skill.workflow, disableModelInvocation: true }
      }
    } satisfies HarnessSkillPackage;
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true, allowedSkillIds: ["demo"] },
      adapter,
      input: "use the explicit skill",
      skills: [explicitSkill],
      explicitSkillId: "demo",
      availableBuiltinTools: [echo],
      mcpClientManager: manager,
      runId: "run-explicit",
      generation: 1,
      emit: (event) => events.push(event)
    });
    expect(result.stopReason).toBe("final");
    expect(result.finalAnswer).toBe("explicit skill answer");
    const controllerMessage = result.transcript.find(
      (message): message is Extract<HarnessMessage, { role: "assistant" }> => message.role === "assistant" && !!message.action
    );
    expect(controllerMessage?.action?.origin).toBe("controller");
    expect(result.transcript.some((message) => message.role === "tool" && message.toolId === "internal:skill.load")).toBe(true);
    expect(events.findIndex((event) => event.type === "run_start")).toBeLessThan(events.findIndex((event) => event.type === "tool_preflight"));
  });

  it("fails explicit activation before the first model call when a required tool is unavailable", async () => {
    let modelCalls = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        modelCalls += 1;
        yield { type: "done", text: "should not run" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true, allowedSkillIds: ["demo"] },
      adapter,
      input: "run demo",
      skills: [packageForTest],
      explicitSkillId: "demo",
      mcpClientManager: manager,
      runId: "run-explicit-required-tool",
      generation: 1
    });
    expect(result.stopReason).toBe("tool_unavailable");
    expect(modelCalls).toBe(0);
    expect(result.transcript.at(-1)).toMatchObject({ role: "tool", errorCode: "required_tool_unavailable" });
  });

  it("enforces agent tool category and allowlist boundaries before catalog and effects", async () => {
    const systems: string[] = [];
    const responses = [
      '{"type":"tool_call","toolId":"builtin:echo","input":{"value":42}}',
      "done"
    ];
    const adapter: AgentAdapter = {
      async *chat(request) {
        systems.push(request.system ?? "");
        yield { type: "done", text: responses.shift() ?? "done" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        enableBuiltInTools: false,
        enableMcp: false,
        allowedBuiltInToolIds: ["different-tool"],
        allowedMcpServerIds: ["different-server"]
      },
      adapter,
      input: "do not use blocked tools",
      availableBuiltinTools: [echo],
      availableMcpServers: [{ id: "server", name: "Server", sseUrl: "https://example.com/mcp" }],
      availableMcpTools: [{
        server: { id: "server", name: "Server", sseUrl: "https://example.com/mcp" },
        tools: [{ name: "search", inputSchema: { type: "object" } }]
      }],
      mcpClientManager: manager,
      runId: "run-agent-scope",
      generation: 1
    });
    expect(result.stopReason).toBe("final");
    expect(systems.every((system) => !system.includes("builtin:echo") && !system.includes("mcp:server:search"))).toBe(true);
    expect(result.transcript.at(-2)).toMatchObject({ role: "tool", toolId: "builtin:echo", errorCode: "tool_unavailable" });
  });

  it("fails fast when an explicitly requested skill is unavailable", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        throw new Error("model should not be called");
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true },
      adapter,
      input: "use missing skill",
      skills: [],
      explicitSkillId: "missing",
      availableBuiltinTools: [echo],
      mcpClientManager: manager,
      runId: "run-missing-skill",
      generation: 1
    });
    expect(result.stopReason).toBe("tool_unavailable");
    expect(result.transcript.at(-1)).toMatchObject({ role: "tool", errorCode: "tool_unavailable" });
  });

  it("honors an explicit text capability even when the adapter also exposes native chat", async () => {
    let textCalls = 0;
    let nativeCalls = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        textCalls += 1;
        yield { type: "done", text: "text capability final" };
      },
      async *nativeChat() {
        nativeCalls += 1;
        yield { type: "done", finishReason: "stop" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      adapter,
      transportCandidates: [{ id: "text", agent: { id: "agent", name: "Agent", type: "openai_compat" }, adapter, capability: "text_protocol" }],
      input: "hello",
      mcpClientManager: manager,
      runId: "run-capability",
      generation: 1
    });
    expect(result.stopReason).toBe("final");
    expect(textCalls).toBe(1);
    expect(nativeCalls).toBe(0);
  });

  it("does not dispatch tools when text transport reports an unexpected native call", async () => {
    let dispatches = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        yield {
          type: "error",
          kind: "provider",
          retryable: false,
          message: "unexpected_native_tool_call_in_text_mode: provider returned 1 native tool call payload."
        };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom", enableBuiltInTools: true },
      adapter,
      transportCandidates: [{ id: "text", agent: { id: "agent", name: "Agent", type: "custom" }, adapter, capability: "text_protocol" }],
      input: "hello",
      availableBuiltinTools: [{ ...echo, code: "dispatches += 1; return input.value;" }],
      mcpClientManager: manager,
      runId: "run-unexpected-native-text-call",
      generation: 1
    });

    expect(result.stopReason).toBe("transport_error");
    expect(dispatches).toBe(0);
    expect(result.transcript.some((message) => message.role === "tool")).toBe(false);
  });

  it("fails closed for a load-balancer candidate without an explicit capability", async () => {
    let calls = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        calls += 1;
        yield { type: "done", text: "should not run" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom" },
      adapter,
      transportCandidates: [{ id: "unconfigured", agent: { id: "agent", name: "Agent", type: "custom" }, adapter }],
      input: "hello",
      mcpClientManager: manager,
      runId: "run-unconfigured-capability",
      generation: 1
    });
    expect(result.stopReason).toBe("transport_error");
    expect(calls).toBe(0);
  });

  it("contains invalid tool schemas before they reach the model catalog", async () => {
    let receivedSystem = "";
    const invalidTool = { ...echo, inputSchema: { $ref: "https://example.com/tool.json" } };
    const adapter: AgentAdapter = {
      async *chat(request) {
        receivedSystem = request.system ?? "";
        yield { type: "done", text: "safe final" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom" },
      adapter,
      input: "hello",
      availableBuiltinTools: [invalidTool],
      mcpClientManager: manager,
      runId: "run-invalid-schema",
      generation: 1
    });
    expect(result.stopReason).toBe("final");
    expect(receivedSystem).not.toContain("builtin:echo");
  });

  it("reprojects the canonical transcript for a failover candidate with a larger context budget", async () => {
    let smallCalls = 0;
    let largeCalls = 0;
    const smallAdapter: AgentAdapter = {
      async *chat() {
        smallCalls += 1;
        yield { type: "done", text: "small should not run" };
      }
    };
    const largeAdapter: AgentAdapter = {
      async *chat() {
        largeCalls += 1;
        yield { type: "done", text: "large candidate final" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const events: HarnessEvent[] = [];
    const result = await runHarnessOneToOne({
      agent: { id: "agent", name: "Agent", type: "custom" },
      adapter: smallAdapter,
      transportCandidates: [
        {
          id: "small",
          agent: { id: "small", name: "Small", type: "custom" },
          adapter: smallAdapter,
          capability: "text_protocol",
          contextBudget: { maxTotalChars: 300 }
        },
        {
          id: "large",
          agent: { id: "large", name: "Large", type: "custom" },
          adapter: largeAdapter,
          capability: "text_protocol",
          contextBudget: { maxTotalChars: 2_000 }
        }
      ],
      input: "hello",
      system: "system context ".repeat(40),
      mcpClientManager: manager,
      runId: "run-budget-failover",
      generation: 1,
      emit: (event) => events.push(event)
    });
    expect(result.stopReason).toBe("final");
    expect(result.finalAnswer).toBe("large candidate final");
    expect(smallCalls).toBe(0);
    expect(largeCalls).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "context_projected", candidateId: "large" }));
  });
});
