import { afterEach, describe, expect, it } from "vitest";
import { McpClientManager } from "../mcp/clientManager";
import { runHarnessChatTurn } from "../chat/harnessChatTurn";
import type { AgentAdapter } from "../adapters/base";
import type { ChatMessage } from "../types";
import type { HarnessSkillPackage } from "../runtime/harness/skillTools";

describe("harness chat turn adapter", () => {
  const managers: McpClientManager[] = [];

  afterEach(() => managers.splice(0).forEach((manager) => manager.closeAll()));

  it("projects one canonical run into the existing assistant message", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: "final from harness" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const patches: Array<{ id: string; patch: Partial<ChatMessage> }> = [];

    const result = await runHarnessChatTurn({
      requestId: "request-1",
      runId: "run-1",
      generation: 1,
      assistantMessageId: "assistant-1",
      userInput: "hello",
      agent: { id: "agent", name: "Agent", type: "custom" },
      adapter,
      docs: [],
      skills: [],
      builtInTools: [],
      mcpServers: [],
      mcpTools: [],
      mcpClientManager: manager,
      patchMessage: (id, patch) => patches.push({ id, patch })
    });

    expect(result).toMatchObject({ requestId: "request-1", status: "success", displayContent: "final from harness" });
    expect(patches.at(-1)).toMatchObject({
      id: "assistant-1",
      patch: {
        content: "final from harness",
        isStreaming: false
      }
    });
    expect(patches.at(-1)?.patch.harnessRun).toMatchObject({ runId: "run-1", terminalReason: "final", stepCount: 1 });
  });

  it("does not persist internal skill instructions in the assistant trace", async () => {
    let callCount = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        if (callCount++ === 0) {
          yield { type: "done", text: JSON.stringify({ type: "tool_call", toolId: "internal:skill.load", input: { skillId: "private" } }) };
          return;
        }
        yield { type: "done", text: "done" };
      }
    };
    const privateSkill = {
      skill: {
        id: "private",
        name: "Private",
        version: "1.0.0",
        description: "Private skill",
        workflow: { instructions: "SECRET_SKILL_INSTRUCTION" },
        skillMarkdown: "# Private",
        rootPath: "private",
        fileCount: 1,
        docCount: 0,
        scriptCount: 0,
        assetCount: 0,
        updatedAt: 0
      },
      docs: [],
      files: [{
        id: "private:private/SKILL.md",
        skillId: "private",
        path: "private/SKILL.md",
        kind: "skill",
        content: "# Private",
        updatedAt: 0
      }]
    } satisfies HarnessSkillPackage;
    const manager = new McpClientManager();
    managers.push(manager);
    const patches: Array<{ id: string; patch: Partial<ChatMessage> }> = [];

    await runHarnessChatTurn({
      requestId: "request-private",
      runId: "run-private",
      generation: 1,
      assistantMessageId: "assistant-private",
      userInput: "load the skill",
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true },
      adapter,
      docs: [],
      skills: [privateSkill],
      builtInTools: [],
      mcpServers: [],
      mcpTools: [],
      mcpClientManager: manager,
      patchMessage: (id, patch) => patches.push({ id, patch })
    });

    const traceText = patches.flatMap(({ patch }) => patch.skillTrace ?? []).map((entry) => entry.content).join("\n");
    expect(traceText).not.toContain("SECRET_SKILL_INSTRUCTION");
    expect(traceText).toContain("internal:skill.load: success");
  });

  it("marks an abort during skill package loading as degraded instead of failure", async () => {
    const controller = new AbortController();
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: "should not run" };
      }
    };
    const manager = new McpClientManager();
    managers.push(manager);
    const patches: Array<{ id: string; patch: Partial<ChatMessage> }> = [];
    const loading = new Promise<HarnessSkillPackage[]>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("loading aborted")), { once: true });
    });
    const run = runHarnessChatTurn({
      requestId: "request-abort",
      runId: "run-abort",
      generation: 1,
      assistantMessageId: "assistant-abort",
      userInput: "hello",
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true },
      adapter,
      docs: [],
      skills: [],
      builtInTools: [],
      mcpServers: [],
      mcpTools: [],
      mcpClientManager: manager,
      signal: controller.signal,
      loadSkillPackages: () => loading,
      patchMessage: (id, patch) => patches.push({ id, patch })
    });
    await Promise.resolve();
    controller.abort("user stopped");
    const result = await run;
    expect(result.status).toBe("degraded");
    expect(patches.at(-1)?.patch.harnessRun).toMatchObject({ terminalReason: "aborted" });
    expect(patches.at(-1)?.patch.content).toContain("執行中斷");
    expect(patches.at(-1)?.patch.harnessRun?.activity).toEqual(expect.arrayContaining([
      { type: "run_start", message: "generation=1" },
      { type: "run_end", message: "aborted" }
    ]));
  });

  it("records a terminal event when harness setup fails before the core loop starts", async () => {
    const manager = new McpClientManager();
    managers.push(manager);
    const patches: Array<{ id: string; patch: Partial<ChatMessage> }> = [];
    const result = await runHarnessChatTurn({
      requestId: "request-setup-failure",
      runId: "run-setup-failure",
      generation: 2,
      assistantMessageId: "assistant-setup-failure",
      userInput: "hello",
      agent: { id: "agent", name: "Agent", type: "custom", enableSkills: true },
      adapter: { async *chat() { yield { type: "done", text: "unused" }; } },
      docs: [],
      skills: [],
      builtInTools: [],
      mcpServers: [],
      mcpTools: [],
      mcpClientManager: manager,
      loadSkillPackages: async () => { throw new Error("skill store unavailable"); },
      patchMessage: (id, patch) => patches.push({ id, patch })
    });
    expect(result.status).toBe("failure");
    expect(patches.at(-1)?.patch.harnessRun?.activity).toEqual(expect.arrayContaining([
      { type: "run_start", message: "generation=2" },
      { type: "run_end", message: "transport_error" }
    ]));
  });
});
