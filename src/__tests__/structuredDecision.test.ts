import { describe, expect, it, vi } from "vitest";
import { runStructuredDecision } from "../runtime/structuredDecision";

describe("structured decision runner", () => {
  it("retries invalid output and returns the first parsed decision", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce("invalid")
      .mockResolvedValueOnce('{"type":"done"}');
    const wait = vi.fn(async () => undefined);
    const onInvalid = vi.fn();
    const onSuccess = vi.fn();

    await expect(runStructuredDecision({
      retry: { max: 2, delaySec: 1.5 },
      invoke,
      parse: (raw) => raw.startsWith("{") ? JSON.parse(raw) as { type: string } : null,
      onInvalid,
      onSuccess,
      wait
    })).resolves.toEqual({ type: "done" });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(onInvalid).toHaveBeenCalledWith("invalid", 0, 3);
    expect(wait).toHaveBeenCalledWith(1500);
    expect(onSuccess).toHaveBeenCalledWith({ type: "done" }, '{"type":"done"}', 1);
  });

  it("stops immediately on terminal agent failures", async () => {
    const invoke = vi.fn(async () => "Request failed: HTTP 400 bad request");
    const parse = vi.fn(() => ({ type: "unexpected" }));
    const onTerminal = vi.fn();

    await expect(runStructuredDecision({
      retry: { max: 3, delaySec: 0 },
      invoke,
      parse,
      onTerminal
    })).resolves.toBeNull();

    expect(invoke).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
    expect(onTerminal).toHaveBeenCalledWith(
      "Request failed: HTTP 400 bad request",
      "Request failed: HTTP 400 bad request",
      0
    );
  });

  it("returns null after exhausting the normalized attempt count", async () => {
    const invoke = vi.fn(async () => "invalid");
    const onInvalid = vi.fn();
    const wait = vi.fn(async () => undefined);

    await expect(runStructuredDecision({
      retry: { max: 1.2, delaySec: -1 },
      invoke,
      parse: () => null,
      onInvalid,
      wait
    })).resolves.toBeNull();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(onInvalid).toHaveBeenLastCalledWith("invalid", 1, 2);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(0);
  });

  it("propagates invocation errors instead of misclassifying them as schema failures", async () => {
    await expect(runStructuredDecision({
      retry: { max: 2, delaySec: 0 },
      invoke: async () => { throw new Error("transport failed"); },
      parse: () => null
    })).rejects.toThrow("transport failed");
  });
});
