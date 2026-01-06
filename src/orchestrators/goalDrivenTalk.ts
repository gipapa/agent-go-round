import { AgentConfig, ChatMessage, DocItem, McpServerConfig, McpTool } from "../types";
import { AgentAdapter } from "../adapters/base";
import { runOneToOne } from "./oneToOne";
import { McpSseClient } from "../mcp/sseClient";
import { callTool } from "../mcp/toolRegistry";

type Action =
  | { type: "plan"; items: Array<{ goal: string; agent: string }> }
  | { type: "think"; thought: string }
  | { type: "doc_lookup"; query?: string }
  | { type: "mcp_call"; tool: string; input?: any; serverId?: string }
  | { type: "final"; answer: string };

export type GoalDrivenEvent =
  | { type: "assistant"; message: ChatMessage }
  | { type: "tool"; message: ChatMessage }
  | { type: "final"; message: ChatMessage }
  | { type: "error"; message: ChatMessage };

function extractJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function normalizeAction(obj: any): Action | null {
  if (!obj || typeof obj !== "object") return null;

  if (obj.type === "plan" && Array.isArray(obj.items)) {
    const items = obj.items
      .map((it: any) => (it && typeof it.goal === "string" && typeof it.agent === "string" ? { goal: it.goal, agent: it.agent } : null))
      .filter(Boolean) as Array<{ goal: string; agent: string }>;
    if (items.length) return { type: "plan", items };
  }

  if (obj.type === "final" && typeof obj.answer === "string") {
    return { type: "final", answer: obj.answer };
  }
  if (obj.type === "think" && typeof obj.thought === "string") {
    return { type: "think", thought: obj.thought };
  }
  if (obj.type === "doc_lookup") {
    return { type: "doc_lookup", query: typeof obj.query === "string" ? obj.query : undefined };
  }
  if (obj.type === "mcp_call" && typeof obj.tool === "string") {
    return { type: "mcp_call", tool: obj.tool, input: obj.input, serverId: typeof obj.serverId === "string" ? obj.serverId : undefined };
  }
  return null;
}

function makeMsg(role: ChatMessage["role"], content: string, name?: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, name, ts: Date.now() };
}

function stringifyAny(v: any): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function buildActionPrompt(args: {
  goal: string;
  turn: number;
  hasDoc: boolean;
  activeMcpName?: string;
  activeMcpId?: string;
  mcpTools?: McpTool[];
  agentName: string;
}) {
  const toolLines = [
    `- plan (first turn only): {"type":"plan","items":[{"goal":"sub-goal 1","agent":"${args.agentName}"}, ...]}`,
    `- think: {"type":"think","thought":"reasoning or review for next step"}`,
    args.hasDoc ? `- doc_lookup: {"type":"doc_lookup","query":"what you need from the doc"}` : `- doc_lookup: unavailable (no doc selected)`,
    args.activeMcpName
      ? `- mcp_call: {"type":"mcp_call","tool":"<tool name>","input":{...}} (active server: ${args.activeMcpName})`
      : `- mcp_call: unavailable (no active MCP server)`,
    `- final: {"type":"final","answer":"concise final answer or summary"}`
  ]
    .filter(Boolean)
    .join("\n");

  const mcpToolSection =
    args.activeMcpName && args.mcpTools
      ? `Active MCP server: ${args.activeMcpName}${args.activeMcpId ? ` (id: ${args.activeMcpId})` : ""}\nTools:\n` +
        (args.mcpTools.length
          ? args.mcpTools.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")
          : "- No tools returned yet; use tools/list first.")
      : "";

  return (
    `You are in GOAL-DRIVEN TALK mode. Follow an analyze -> act -> review loop until you can provide the best final answer.\n` +
    `GOAL:\n${args.goal}\n\n` +
    `Agents available: ${args.agentName} (primary executor). Always note which agent owns each sub-goal in the plan.\n\n` +
    (mcpToolSection ? `${mcpToolSection}\n\n` : "") +
    `At each turn, reply with exactly ONE JSON object (no Markdown, no code fences).\n` +
    `Allowed actions:\n${toolLines}\n\n` +
    `Be deliberate. Prefer a quick think step when helpful. Turn #${args.turn}: choose the next action.`
  );
}

export async function runGoalDrivenTalk(args: {
  adapter: AgentAdapter;
  agent: AgentConfig;
  goal: string;
  history: ChatMessage[];
  system?: string;
  selectedDoc?: DocItem | null;
  activeMcpServer?: McpServerConfig | null;
  activeMcpTools?: McpTool[];
  maxTurns?: number;
  onEvent?: (ev: GoalDrivenEvent) => void;
  onLog?: (t: string) => void;
}): Promise<string> {
  const maxTurns = args.maxTurns ?? 8;
  const session: ChatMessage[] = [...args.history];
  const docText = args.selectedDoc ? `[DOC:${args.selectedDoc.title}]\n${args.selectedDoc.content}` : "No doc selected.";
  let hasPlan = false;

  const emit = (ev: GoalDrivenEvent) => {
    if (ev.message) session.push(ev.message);
    args.onEvent?.(ev);
  };

  for (let turn = 1; turn <= maxTurns; turn++) {
    args.onLog?.(`Goal-driven turn ${turn}: requesting next action...`);

    const prompt = buildActionPrompt({
      goal: args.goal,
      turn,
      hasDoc: !!args.selectedDoc,
      activeMcpName: args.activeMcpServer?.name,
      activeMcpId: args.activeMcpServer?.id,
      mcpTools: args.activeMcpTools ?? [],
      agentName: args.agent.name
    });

    const text = await runOneToOne({
      adapter: args.adapter,
      agent: args.agent,
      input: hasPlan ? prompt : `First, create a sub-goal plan before anything else.\n${prompt}`,
      history: session,
      system: args.system,
      onDelta: () => {}
    });

    const action = normalizeAction(extractJsonObject(text));
    if (!action) {
      const m = makeMsg("assistant", text, args.agent.name);
      emit({ type: "assistant", message: m });
      return text;
    }

    if (action.type === "think") {
      const m = makeMsg("assistant", action.thought, args.agent.name);
      emit({ type: "assistant", message: m });
      continue;
    }

    if (action.type === "plan") {
      hasPlan = true;
      const planLines = action.items.map((it, idx) => `${idx + 1}. ${it.goal} — assigned to ${it.agent}`).join("\n");
      const m = makeMsg("assistant", `Plan established:\n${planLines}`, args.agent.name);
      emit({ type: "assistant", message: m });
      continue;
    }

    if (action.type === "doc_lookup") {
      const docMsg = makeMsg("tool", docText, "doc");
      emit({ type: "tool", message: docMsg });
      continue;
    }

    if (action.type === "mcp_call") {
      const targetServer =
        (action.serverId && args.activeMcpServer && args.activeMcpServer.id === action.serverId
          ? args.activeMcpServer
          : args.activeMcpServer) ?? null;

      if (!targetServer) {
        const m = makeMsg("tool", "MCP call skipped: no active MCP server selected.", "mcp");
        emit({ type: "tool", message: m });
        continue;
      }

      try {
        const client = new McpSseClient(targetServer);
        client.connect(args.onLog);
        const result = await callTool(client, action.tool, action.input ?? {});
        const m = makeMsg(
          "tool",
          `MCP ${targetServer.name} -> ${action.tool}\ninput:\n${stringifyAny(action.input ?? {})}\noutput:\n${stringifyAny(result)}`,
          "mcp"
        );
        emit({ type: "tool", message: m });
      } catch (e: any) {
        const err = makeMsg("tool", `MCP error for ${action.tool}: ${e?.message ?? String(e)}`, "mcp");
        emit({ type: "tool", message: err });
      }
      continue;
    }

    if (action.type === "final") {
      const m = makeMsg("assistant", action.answer, args.agent.name);
      emit({ type: "final", message: m });
      return action.answer;
    }
  }

  const fallback = makeMsg("assistant", "Reached turn limit. Here is the best available answer based on prior steps.", args.agent.name);
  emit({ type: "assistant", message: fallback });
  return fallback.content;
}
