import { Type, validateToolArguments } from "@earendil-works/pi-ai";
import { TabRouter, type TabQuestion, type TabReply } from "./tab-router";

export const AGENTS_PARAMETERS = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("send"), Type.Literal("read")]),
  target: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: "Destination tab ID from action=list. Used only with send." })),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 16000, description: "Instruction or question for the target AI to carry out, not your own answer. For a joke request, send '請講一個笑話', not a joke you wrote. Used only with send." })),
  requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: "ID returned by send. Read this same ID again if pending; do not send the task again." })),
  waitMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 }))
}, { additionalProperties: false });

export type AgentsArguments = { action: "list" | "send" | "read"; target?: string; text?: string; requestId?: string; waitMs?: number };
export type TabAgentInfo = { id: string; name: string; mode: string; provider: string; model: string; cwd: string; busy: boolean; connected: boolean };
type Request = { message: TabQuestion; reply?: TabReply; failure?: string };

/** Request data lives for this page's lifetime; only the originating tab can read it. */
export class TabAgents {
  private readonly requests = new Map<string, Request>();
  private readonly changed = new Set<() => void>();

  constructor(private readonly router: TabRouter, private readonly tabs: () => TabAgentInfo[]) {
    router.subscribe(event => {
      if (event.type === "route_accepted") {
        this.requests.set(event.message.messageId, { message: event.message });
      }
      if (event.type === "route_reply" || event.type === "route_failed") {
        const request = this.requests.get(event.message.messageId);
        if (request) {
          if (event.type === "route_reply") request.reply = event.reply;
          else request.failure = event.reason;
        }
      }
      // Manual routing can also add requests; never evict an active one.
      while (this.requests.size > 200) {
        const oldest = [...this.requests].find(([, entry]) => entry.reply || entry.failure);
        if (!oldest) break;
        this.requests.delete(oldest[0]);
      }
      for (const listener of this.changed) listener();
    });
  }

  async execute(sourceTabId: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const args = validateToolArguments({ name: "agents", description: "Cross-tab agents", parameters: AGENTS_PARAMETERS }, { type: "toolCall", id: "agents", name: "agents", arguments: input as Record<string, unknown> }) as AgentsArguments;
    if (signal.aborted) throw new Error("Tool cancelled");
    const tabs = this.tabs();
    if (!tabs.some(tab => tab.id === sourceTabId)) throw new Error("Source tab is closed or unavailable");
    if (args.action === "list") {
      if (args.target !== undefined || args.text !== undefined || args.requestId !== undefined || args.waitMs !== undefined) throw new Error("agents list takes no other arguments");
      return {
        self: sourceTabId,
        agents: tabs.map(tab => ({ ...tab, self: tab.id === sourceTabId, available: tab.id !== sourceTabId && tab.mode === "agent" && tab.connected && !tab.busy })),
        requests: [...this.requests.values()].filter(request => request.message.sourceTabId === sourceTabId).map(request => ({ requestId: request.message.messageId, target: request.message.targetTabId, status: request.failure ? "error" : request.reply?.status ?? "pending" }))
      };
    }
    if (args.action === "send") {
      if (!args.target || !args.text?.trim() || args.requestId !== undefined || args.waitMs !== undefined) throw new Error('agents send requires target and text only. No request was sent. Resend one complete object: {"action":"send","target":"<tab ID from list>","text":"<task>"}. Keep correct fields; arguments from earlier calls are not retained.');
      const target = tabs.find(tab => tab.id === args.target);
      if (!target) throw new Error("Target tab is closed or unavailable; use agents list");
      if (target.mode !== "agent" || !target.connected) throw new Error("Target is not a connected AI agent; run ai in that tab first");
      if ([...this.requests.values()].filter(request => !request.reply && !request.failure).length >= 200) throw new Error("Too many pending requests");
      const receipt = this.router.sendQuestion(sourceTabId, args.target, args.text);
      if (receipt.status === "rejected") return { status: "rejected", reason: receipt.reason };
      return { status: "pending", requestId: receipt.message.messageId, target: args.target };
    }
    if (!args.requestId || args.target !== undefined || args.text !== undefined) throw new Error('agents read requires requestId and optional waitMs. Resend one complete object: {"action":"read","requestId":"<ID returned by send>"}. Keep the same requestId when pending; do not send the task again.');
    const request = this.requests.get(args.requestId);
    if (!request || request.message.sourceTabId !== sourceTabId) throw new Error("Request not found for this tab; requests expire on page reload or after 200 completed requests");
    if (!request.reply && !request.failure && (args.waitMs ?? 5000) > 0) await this.wait(request, args.waitMs ?? 5000, signal);
    return {
      requestId: args.requestId, target: request.message.targetTabId,
      status: request.failure ? "error" : request.reply?.status ?? "pending",
      ...(request.reply ? { text: request.reply.text, ...(request.reply.error ? { error: request.reply.error } : {}) } : {}),
      ...(request.failure ? { error: request.failure } : {})
    };
  }

  private wait(request: Request, waitMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (cancelled = false) => {
        clearTimeout(timer);
        this.changed.delete(check);
        signal.removeEventListener("abort", abort);
        if (cancelled) reject(new Error("Tool cancelled; the accepted target request continues. Read its requestId instead of sending it again."));
        else resolve();
      };
      const check = () => { if (request.reply || request.failure) finish(); };
      const abort = () => finish(true);
      const timer = setTimeout(finish, waitMs);
      this.changed.add(check);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort(); else check();
    });
  }
}
