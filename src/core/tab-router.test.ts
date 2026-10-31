import { describe, expect, it } from "vitest";
import { TabRouter, type TabQuestion, type TabRouteEvent } from "./tab-router";

function result(text: string, status: "success" | "aborted" | "error" = "success") {
  return { runId: `run-${text}`, status, text } as const;
}

function question(overrides: Partial<TabQuestion> = {}): TabQuestion {
  return {
    type: "question",
    messageId: "message-1",
    correlationId: "correlation-1",
    sourceTabId: "main",
    targetTabId: "review",
    text: "review this",
    createdAt: 1,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("TabRouter", () => {
  it("delivers an identified question and emits a correlated reply without invoking the source", async () => {
    const router = new TabRouter();
    const events: TabRouteEvent[] = [];
    const received: TabQuestion[] = [];
    const sourceRuns: string[] = [];
    router.subscribe((event) => events.push(event));
    router.register("main", {
      isBusy: () => false,
      receiveQuestion: async (message) => {
        sourceRuns.push(message.text);
        return result("source should not run");
      }
    });
    router.register("review", {
      isBusy: () => false,
      receiveQuestion: async (message) => {
        received.push(message);
        return result("done");
      }
    });

    const receipt = router.deliverQuestion(question());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receipt.status).toBe("accepted");
    expect(received).toHaveLength(1);
    expect(sourceRuns).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(["route_accepted", "route_reply"]);
    const reply = events[1];
    if (reply.type !== "route_reply") throw new Error("Expected a reply event");
    expect(reply.reply).toMatchObject({
      correlationId: "correlation-1",
      inReplyTo: "message-1",
      sourceTabId: "review",
      targetTabId: "main",
      status: "success",
      text: "done"
    });
  });

  it("rejects busy targets and does not create a hidden queue", () => {
    const router = new TabRouter();
    let received = 0;
    router.register("main", { isBusy: () => false, receiveQuestion: async () => result("unused") });
    router.register("review", {
      isBusy: () => true,
      receiveQuestion: async () => {
        received += 1;
        return result("unexpected");
      }
    });

    expect(router.deliverQuestion(question())).toMatchObject({ status: "rejected", reason: "busy" });
    expect(received).toBe(0);
  });

  it("deduplicates an in-flight message and reports a closed target", async () => {
    const router = new TabRouter();
    const events: TabRouteEvent[] = [];
    const pending = deferred<ReturnType<typeof result>>();
    let received = 0;
    router.subscribe((event) => events.push(event));
    router.register("main", { isBusy: () => false, receiveQuestion: async () => result("source") });
    const unregister = router.register("review", {
      isBusy: () => false,
      receiveQuestion: async () => {
        received += 1;
        return pending.promise;
      }
    });

    expect(router.deliverQuestion(question())).toMatchObject({ status: "accepted" });
    expect(router.deliverQuestion(question())).toMatchObject({ status: "rejected", reason: "duplicate" });
    expect(received).toBe(1);

    unregister();
    pending.resolve(result("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.at(-1)).toMatchObject({ type: "route_failed", reason: "target_closed" });
  });

  it("returns an aborted or failed run as a reply instead of retrying it", async () => {
    const router = new TabRouter();
    const events: TabRouteEvent[] = [];
    router.subscribe((event) => events.push(event));
    router.register("main", { isBusy: () => false, receiveQuestion: async () => result("source") });
    router.register("review", { isBusy: () => false, receiveQuestion: async () => result("partial", "aborted") });

    router.sendQuestion("main", "review", "stop after partial");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reply = events.find((event): event is Extract<TabRouteEvent, { type: "route_reply" }> => event.type === "route_reply");
    expect(reply?.reply.status).toBe("aborted");
    expect(events.filter((event) => event.type === "route_accepted")).toHaveLength(1);
  });
});
