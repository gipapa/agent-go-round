import type { RunResult } from "./session";

export type TabQuestion = {
  type: "question";
  messageId: string;
  correlationId: string;
  sourceTabId: string;
  targetTabId: string;
  text: string;
  createdAt: number;
};

export type TabReply = {
  type: "reply";
  messageId: string;
  correlationId: string;
  sourceTabId: string;
  targetTabId: string;
  inReplyTo: string;
  status: RunResult["status"];
  text: string;
  error?: string;
  createdAt: number;
};

export type TabRouteRejectReason = "invalid" | "source_closed" | "target_closed" | "busy" | "duplicate";

export type TabRouteReceipt =
  | { status: "accepted"; message: TabQuestion }
  | { status: "rejected"; reason: TabRouteRejectReason; message?: TabQuestion };

export type TabRouteEvent =
  | { type: "route_accepted"; message: TabQuestion }
  | { type: "route_rejected"; reason: TabRouteRejectReason; message?: TabQuestion }
  | { type: "route_reply"; message: TabQuestion; reply: TabReply }
  | { type: "route_failed"; reason: "target_closed"; message: TabQuestion };

export type TabRouteEndpoint = {
  isBusy: () => boolean;
  receiveQuestion: (message: TabQuestion) => Promise<RunResult>;
};

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Explicit, in-process routing for questions between tabs, including bin tools.
 *
 * The router owns message identity, deduplication and delivery state. It does
 * not ask the source tab's model to do anything when a reply arrives.
 */
export class TabRouter {
  private readonly endpoints = new Map<string, TabRouteEndpoint>();
  private readonly pending = new Map<string, TabQuestion>();
  private readonly deliveredMessageIds = new Set<string>();
  private readonly listeners = new Set<(event: TabRouteEvent) => void>();

  register(tabId: string, endpoint: TabRouteEndpoint): () => void {
    if (!tabId.trim()) throw new Error("tabId is required");
    if (this.endpoints.has(tabId)) throw new Error(`Tab ${tabId} is already registered`);
    this.endpoints.set(tabId, endpoint);
    return () => {
      if (this.endpoints.get(tabId) !== endpoint) return;
      this.endpoints.delete(tabId);
      for (const [id, message] of this.pending) {
        if (message.targetTabId !== tabId) continue;
        this.pending.delete(id);
        this.emit({ type: "route_failed", reason: "target_closed", message });
      }
    };
  }

  subscribe(listener: (event: TabRouteEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendQuestion(sourceTabId: string, targetTabId: string, text: string): TabRouteReceipt {
    const message: TabQuestion = {
      type: "question",
      messageId: makeId("message"),
      correlationId: makeId("correlation"),
      sourceTabId,
      targetTabId,
      text: text.trim(),
      createdAt: Date.now()
    };
    return this.deliverQuestion(message);
  }

  /** Delivers an already identified message, useful for host bridges and regression fixtures. */
  deliverQuestion(message: TabQuestion): TabRouteReceipt {
    if (!message.messageId || !message.correlationId || !message.sourceTabId || !message.targetTabId || !message.text.trim() || message.sourceTabId === message.targetTabId) {
      const receipt: TabRouteReceipt = { status: "rejected", reason: "invalid", message };
      this.emit({ type: "route_rejected", reason: receipt.reason, message });
      return receipt;
    }
    if (this.deliveredMessageIds.has(message.messageId)) {
      const receipt: TabRouteReceipt = { status: "rejected", reason: "duplicate", message };
      this.emit({ type: "route_rejected", reason: receipt.reason, message });
      return receipt;
    }
    if (!this.endpoints.has(message.sourceTabId)) {
      const receipt: TabRouteReceipt = { status: "rejected", reason: "source_closed", message };
      this.emit({ type: "route_rejected", reason: receipt.reason, message });
      return receipt;
    }
    const target = this.endpoints.get(message.targetTabId);
    if (!target) {
      const receipt: TabRouteReceipt = { status: "rejected", reason: "target_closed", message };
      this.emit({ type: "route_rejected", reason: receipt.reason, message });
      return receipt;
    }
    if (target.isBusy() || [...this.pending.values()].some(pending => pending.targetTabId === message.targetTabId)) {
      const receipt: TabRouteReceipt = { status: "rejected", reason: "busy", message };
      this.emit({ type: "route_rejected", reason: receipt.reason, message });
      return receipt;
    }

    this.deliveredMessageIds.add(message.messageId);
    this.pending.set(message.messageId, message);
    this.emit({ type: "route_accepted", message });
    void this.execute(message, target);
    return { status: "accepted", message };
  }

  private async execute(message: TabQuestion, endpoint: TabRouteEndpoint): Promise<void> {
    try {
      const result = await endpoint.receiveQuestion(message);
      if (!this.pending.delete(message.messageId)) return;
      if (this.endpoints.get(message.targetTabId) !== endpoint) {
        this.emit({ type: "route_failed", reason: "target_closed", message });
        return;
      }
      const reply: TabReply = {
        type: "reply",
        messageId: makeId("reply"),
        correlationId: message.correlationId,
        sourceTabId: message.targetTabId,
        targetTabId: message.sourceTabId,
        inReplyTo: message.messageId,
        status: result.status,
        text: result.text,
        ...(result.error ? { error: result.error } : {}),
        createdAt: Date.now()
      };
      this.emit({ type: "route_reply", message, reply });
    } catch (error) {
      if (!this.pending.delete(message.messageId)) return;
      if (this.endpoints.get(message.targetTabId) !== endpoint) {
        this.emit({ type: "route_failed", reason: "target_closed", message });
        return;
      }
      const reply: TabReply = {
        type: "reply",
        messageId: makeId("reply"),
        correlationId: message.correlationId,
        sourceTabId: message.targetTabId,
        targetTabId: message.sourceTabId,
        inReplyTo: message.messageId,
        status: "error",
        text: "",
        error: errorText(error),
        createdAt: Date.now()
      };
      this.emit({ type: "route_reply", message, reply });
    }
  }

  private emit(event: TabRouteEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
