// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TabAgents, type TabAgentInfo } from "./tab-agents";
import { TabRouter } from "./tab-router";
import type { RunResult } from "./session";

function setup() {
  const router = new TabRouter();
  const tabs: TabAgentInfo[] = ["main", "other", "third"].map(id => ({ id, name: id, mode: "agent", provider: "scripted", model: "test", cwd: "/home/user", busy: false, connected: true }));
  const agents = new TabAgents(router, () => tabs);
  let resolve!: (value: RunResult) => void;
  let calls = 0;
  const pending = new Promise<RunResult>(done => { resolve = done; });
  router.register("main", { isBusy: () => false, receiveQuestion: async () => ({ runId: "source", status: "success", text: "source" }) });
  router.register("third", { isBusy: () => false, receiveQuestion: async () => ({ runId: "third", status: "success", text: "third" }) });
  const close = router.register("other", { isBusy: () => tabs[1].busy, receiveQuestion: () => { calls++; return pending; } });
  const execute = (input: unknown, source = "main", signal = new AbortController().signal) => agents.execute(source, input, signal);
  return { router, tabs, execute, close, calls: () => calls, finish: (status: RunResult["status"] = "success") => resolve({ runId: "target", status, text: "為什麼工程師怕冷？因為 Windows 一直開著！" }) };
}

describe("cross-tab agent commands", () => {
  it("discovers tabs and reads one correlated result without rerunning the target", async () => {
    const { execute, finish, calls } = setup();
    expect(await execute({ action: "list" })).toMatchObject({ self: "main", agents: [{ id: "main", self: true, available: false }, { id: "other", available: true }, { id: "third" }] });
    const sent = await execute({ action: "send", target: "other", text: "講一個笑話" }) as { requestId: string };
    expect(await execute({ action: "read", requestId: sent.requestId, waitMs: 0 })).toMatchObject({ status: "pending" });
    expect(await execute({ action: "send", target: "other", text: "another" })).toMatchObject({ status: "rejected", reason: "busy" });
    const read = execute({ action: "read", requestId: sent.requestId });
    finish();
    expect(await read).toMatchObject({ status: "success", text: expect.stringContaining("Windows") });
    expect(await execute({ action: "read", requestId: sent.requestId })).toMatchObject({ status: "success" });
    expect(calls()).toBe(1);
  });

  it("rejects inaccessible requests, spoofed identity, wrong modes and invalid arguments", async () => {
    const { execute, tabs } = setup();
    const sent = await execute({ action: "send", target: "other", text: "hi" }) as { requestId: string };
    await expect(execute({ action: "read", requestId: sent.requestId, waitMs: 0 }, "third")).rejects.toThrow("not found for this tab");
    await expect(execute({ action: "list" }, "closed")).rejects.toThrow("Source tab");
    await expect(execute({ action: "send", target: "closed", text: "hi" })).rejects.toThrow("Target tab");
    await expect(execute({ action: "send", target: "other", text: " " })).rejects.toThrow("requires");
    await expect(execute({ action: "read", requestId: sent.requestId, waitMs: 5001 })).rejects.toThrow();
    await expect(execute({ action: "list", sourceTabId: "third" })).rejects.toThrow();
    tabs[1].mode = "shell";
    await expect(execute({ action: "send", target: "other", text: "hi" })).rejects.toThrow("run ai");
    tabs[1].mode = "agent"; tabs[1].connected = false;
    await expect(execute({ action: "send", target: "other", text: "hi" })).rejects.toThrow("connected AI");
    expect(await execute({ action: "send", target: "main", text: "hi" })).toMatchObject({ status: "rejected", reason: "invalid" });
  });

  it("wakes readers immediately when a target closes and ignores its late result", async () => {
    const { execute, close, finish } = setup();
    const sent = await execute({ action: "send", target: "other", text: "hi" }) as { requestId: string };
    const read = execute({ action: "read", requestId: sent.requestId });
    close();
    expect(await read).toMatchObject({ status: "error", error: "target_closed" });
    finish(); await Promise.resolve();
    expect(await execute({ action: "read", requestId: sent.requestId })).toMatchObject({ status: "error", error: "target_closed" });
  });

  it("explains complete send/read arguments without dispatching incomplete requests", async () => {
    const { execute, calls, finish } = setup();
    for (const input of [{ action: "send", target: "other" }, { action: "send", text: "hi" }]) {
      await expect(execute(input)).rejects.toThrow('Resend one complete object: {"action":"send","target":"<tab ID from list>","text":"<task>"}');
    }
    expect(calls()).toBe(0);
    const sent = await execute({ action: "send", target: "other", text: "hi" }) as { requestId: string };
    await expect(execute({ action: "read" })).rejects.toThrow('Resend one complete object: {"action":"read","requestId":"<ID returned by send>"}');
    expect(await execute({ action: "read", requestId: sent.requestId, waitMs: 0 })).toMatchObject({ status: "pending" });
    finish();
    expect(await execute({ action: "read", requestId: sent.requestId })).toMatchObject({ status: "success" });
    expect(calls()).toBe(1);
  });

  it("cancels only the read wait and lets the caller recover the same accepted request", async () => {
    const { execute, finish, calls } = setup();
    const sent = await execute({ action: "send", target: "other", text: "hi" }) as { requestId: string };
    const controller = new AbortController();
    const read = execute({ action: "read", requestId: sent.requestId }, "main", controller.signal);
    controller.abort();
    await expect(read).rejects.toThrow("accepted target request continues");
    expect(await execute({ action: "list" })).toMatchObject({ requests: [{ requestId: sent.requestId, status: "pending" }] });
    finish("aborted");
    expect(await execute({ action: "read", requestId: sent.requestId })).toMatchObject({ status: "aborted" });
    expect(calls()).toBe(1);
  });
});
