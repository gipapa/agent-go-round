import { afterEach, describe, expect, it, vi } from "vitest";
import { runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";

describe("runBuiltInScriptTool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs simple scripts and returns their value", async () => {
    const result = await runBuiltInScriptTool(
      { code: "return { value: input.count + 1 };" },
      { count: 1 },
      {},
      { sandbox: "inline" }
    );

    expect(result).toEqual({ value: 2 });
  });

  it("times out async scripts", async () => {
    vi.useFakeTimers();
    const promise = runBuiltInScriptTool(
      { code: "await new Promise(() => {}); return 1;" },
      {},
      {},
      { timeoutMs: 25, sandbox: "inline" }
    );
    const expectation = expect(promise).rejects.toThrow("Built-in tool execution timed out");

    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("honors external abort", async () => {
    const controller = new AbortController();
    const promise = runBuiltInScriptTool(
      { code: "await new Promise(() => {}); return 1;" },
      {},
      {},
      { timeoutMs: 1000, signal: controller.signal, sandbox: "inline" }
    );
    const expectation = expect(promise).rejects.toThrow("manual cancel");

    controller.abort(new Error("manual cancel"));

    await expectation;
  });

  it("exposes only allowed system helpers", async () => {
    const result = await runBuiltInScriptTool(
      { code: "return await system.get_user_profile();" },
      {},
      {
        system: {
          get_user_profile: () => ({ name: "Alice" })
        }
      },
      { sandbox: "inline" }
    );

    expect(result).toEqual({ name: "Alice" });
  });

  it("fails promptly when a worker returns a malformed message", async () => {
    const originalUrl = globalThis.URL;
    class MalformedWorker {
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

      constructor(_url: string | URL) {}

      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: null } as MessageEvent<unknown>));
      }

      terminate() {}
    }
    vi.stubGlobal("Worker", MalformedWorker);
    vi.stubGlobal("URL", { ...originalUrl, createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    try {
      await expect(runBuiltInScriptTool(
        { code: "return 1;" },
        {},
        {},
        { sandbox: "worker", fallbackToInline: false }
      )).rejects.toThrow("invalid message");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports a worker postMessage failure before dispatch", async () => {
    const originalUrl = globalThis.URL;
    class ThrowingPostMessageWorker {
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

      constructor(_url: string | URL) {}

      postMessage() {
        throw new Error("postMessage blocked");
      }

      terminate() {}
    }
    vi.stubGlobal("Worker", ThrowingPostMessageWorker);
    vi.stubGlobal("URL", { ...originalUrl, createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    try {
      const onDispatch = vi.fn();
      await expect(runBuiltInScriptTool(
        { code: "return 1;" },
        {},
        {},
        { sandbox: "worker", fallbackToInline: false, onDispatch }
      )).rejects.toMatchObject({ name: "BuiltInToolExecutionError", effectDispatched: false, errorCode: "worker_unavailable" });
      expect(onDispatch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not classify an abort during worker dispatch as an unknown effect", async () => {
    const originalUrl = globalThis.URL;
    const controller = new AbortController();
    class AbortDuringPostMessageWorker {
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

      constructor(_url: string | URL) {}

      postMessage() {
        controller.abort(new Error("cancelled before dispatch"));
      }

      terminate() {}
    }
    vi.stubGlobal("Worker", AbortDuringPostMessageWorker);
    vi.stubGlobal("URL", { ...originalUrl, createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    try {
      const onDispatch = vi.fn();
      await expect(runBuiltInScriptTool(
        { code: "return 1;" },
        {},
        {},
        { sandbox: "worker", fallbackToInline: false, signal: controller.signal, onDispatch }
      )).rejects.toMatchObject({ name: "BuiltInToolExecutionError", effectDispatched: false });
      expect(onDispatch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
