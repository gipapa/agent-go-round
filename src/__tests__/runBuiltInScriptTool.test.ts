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
});
