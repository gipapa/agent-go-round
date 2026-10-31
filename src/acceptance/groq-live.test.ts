import { writeFile } from "node:fs/promises";
import { createGroqRuntime, DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL } from "../core/provider";
import { AgentSession, type SessionTool } from "../core/session";
import { Type } from "@earendil-works/pi-ai";

type TaskReport = {
  id: string;
  status: "pass" | "fail";
  runStatus: string;
  text: string;
  toolCalls: string[];
  failureClass?: "harness" | "provider" | "quota" | "network" | "model_decision";
  failure?: string;
};

type AcceptanceState = {
  plan: "pro" | "team";
  seats: number;
};

function classifyFailure(error: string): TaskReport["failureClass"] {
  const normalized = error.toLowerCase();
  if (normalized.includes("429") || normalized.includes("quota") || normalized.includes("rate limit") || normalized.includes("insufficient")) return "quota";
  if (normalized.includes("fetch") || normalized.includes("network") || normalized.includes("timeout") || normalized.includes("econn")) return "network";
  if (normalized.includes("api") || normalized.includes("provider") || normalized.includes("http")) return "provider";
  if (normalized.includes("tool") || normalized.includes("harness") || normalized.includes("session")) return "harness";
  return "model_decision";
}

function toolText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}

function buildTools(state: AcceptanceState, calls: string[]): SessionTool[] {
  return [
    {
      name: "read_customer_record",
      label: "Read customer record",
      description: "Read the current customer record for customer cust-42.",
      parameters: Type.Object({ customerId: Type.String({ minLength: 1 }) }),
      execute: async (_id, args) => {
        const input = args as { customerId: string };
        calls.push("read_customer_record");
        return { content: [{ type: "text", text: toolText({ customerId: input.customerId, plan: state.plan, seats: state.seats }) }], details: { customerId: input.customerId, plan: state.plan, seats: state.seats } };
      }
    },
    {
      name: "set_customer_seats",
      label: "Set customer seats",
      description: "Change the seats for customer cust-42. This is a protected mutation.",
      requiresApproval: true,
      parameters: Type.Object({ customerId: Type.String({ minLength: 1 }), seats: Type.Integer({ minimum: 1, maximum: 100 }) }),
      execute: async (_id, args) => {
        const input = args as { customerId: string; seats: number };
        calls.push("set_customer_seats");
        state.seats = input.seats;
        return { content: [{ type: "text", text: toolText({ updated: true, seats: state.seats }) }], details: { updated: true, seats: state.seats } };
      }
    },
    {
      name: "set_customer_plan",
      label: "Set customer plan",
      description: "Change the customer plan. The only accepted plans are pro and team; invalid plans return a tool error.",
      parameters: Type.Object({ customerId: Type.String({ minLength: 1 }), plan: Type.String({ minLength: 1 }) }),
      execute: async (_id, args) => {
        const input = args as { customerId: string; plan: string };
        calls.push(`set_customer_plan:${input.plan}`);
        if (input.plan !== "pro" && input.plan !== "team") throw new Error("Invalid plan; choose pro or team");
        state.plan = input.plan as AcceptanceState["plan"];
        return { content: [{ type: "text", text: toolText({ updated: true, plan: state.plan }) }], details: { updated: true, plan: state.plan } };
      }
    }
  ];
}

function validateTask(id: string, result: { status: string; text: string; error?: string }, calls: string[], state: AcceptanceState): string | undefined {
  const text = result.text.toLowerCase();
  if (result.status !== "success") return result.error || `run ended with ${result.status}`;
  if (id === "read-record" && (!calls.includes("read_customer_record") || !text.includes("pro") || !text.includes("7"))) return "The model did not read and report the expected customer record";
  if (id === "mutate-and-read-back" && (state.seats !== 9 || calls.filter((call) => call === "set_customer_seats").length !== 1 || calls.filter((call) => call === "read_customer_record").length < 1 || !text.includes("9"))) return "The mutation was not followed by a verified read-back";
  if (id === "correct-tool-error" && (!calls.some((call) => call.startsWith("set_customer_plan:")) || !calls.includes("read_customer_record") || state.plan !== "team")) return "The model did not correct the invalid tool input and verify the result";
  return undefined;
}

async function runTask(runtime: Awaited<ReturnType<typeof createGroqRuntime>>, id: string, prompt: string, initial: AcceptanceState): Promise<TaskReport> {
  const state = { ...initial };
  const calls: string[] = [];
  const session = new AgentSession({
    sessionId: `groq-live-${id}`,
    model: runtime.model,
    streamFn: runtime.streamFn,
    systemPrompt: "You are operating a customer record harness. Use tools when asked. Never claim a mutation is complete until you have read the record back.",
    tools: buildTools(state, calls),
    approval: async () => true,
    maxToolCalls: 8
  });
  try {
    const result = await session.prompt(prompt);
    const failure = validateTask(id, result, calls, state);
    return {
      id,
      status: failure ? "fail" : "pass",
      runStatus: result.status,
      text: result.text,
      toolCalls: calls,
      ...(failure ? { failureClass: classifyFailure(failure), failure } : {})
    };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    return { id, status: "fail", runStatus: "exception", text: "", toolCalls: calls, failureClass: classifyFailure(failure), failure };
  }
}

describe("Groq live tool acceptance (opt-in)", () => {
  it("runs the three real-provider tool tasks and emits a classified report", async () => {
    const apiKey = process.env.AGENT_GO_ROUND_GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Set AGENT_GO_ROUND_GROQ_API_KEY (or GROQ_API_KEY) before running test:groq");
    const runtime = await createGroqRuntime({
      apiKey,
      baseUrl: process.env.AGENT_GO_ROUND_GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL,
      model: process.env.AGENT_GO_ROUND_GROQ_MODEL || DEFAULT_GROQ_MODEL
    });
    const startedAt = new Date().toISOString();
    const tasks = [
      await runTask(runtime, "read-record", "Read customer cust-42 and report the exact plan and seat count.", { plan: "pro", seats: 7 }),
      await runTask(runtime, "mutate-and-read-back", "Set customer cust-42 seats to 9, then read the record back and report the verified seat count.", { plan: "pro", seats: 7 }),
      await runTask(runtime, "correct-tool-error", "Set customer cust-42 plan to enterprise. If the tool rejects that value, correct it to team, then read the record back and report the verified plan.", { plan: "pro", seats: 7 })
    ];
    const report = {
      provider: "groq",
      model: runtime.model.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      tasks
    };
    const reportPath = process.env.AGENT_GO_ROUND_GROQ_REPORT;
    if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    expect(tasks.every((task) => task.status === "pass")).toBe(true);
  }, 120_000);
});
