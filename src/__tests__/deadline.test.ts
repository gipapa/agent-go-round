import { describe, expect, it, vi, afterEach } from "vitest";
import { combineSignals, createDeadline, timeoutAfter, withTimeout } from "../utils/deadline";

describe("deadline helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts when the deadline expires", async () => {
    vi.useFakeTimers();
    const deadline = createDeadline({ totalMs: 50, label: "chat" });

    expect(deadline.alive()).toBe(true);
    await vi.advanceTimersByTimeAsync(50);

    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.throwIfExpired()).toThrow("chat timed out after 50ms");
    deadline.dispose();
  });

  it("links external abort signals", () => {
    const controller = new AbortController();
    const deadline = createDeadline({ totalMs: 1000, externalSignal: controller.signal, label: "skill" });

    controller.abort(new Error("manual stop"));

    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.throwIfExpired()).toThrow("manual stop");
    deadline.dispose();
  });

  it("races promises with timeout", async () => {
    vi.useFakeTimers();
    const promise = withTimeout(new Promise<string>(() => {}), 25, "unit");
    const expectation = expect(promise).rejects.toThrow("unit timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("combines abort signals", () => {
    const left = new AbortController();
    const right = new AbortController();
    const combined = combineSignals(left.signal, right.signal);

    right.abort(new Error("right stopped"));

    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBeInstanceOf(Error);
    expect((combined.reason as Error).message).toContain("right stopped");
  });

  it("timeoutAfter honors external abort", async () => {
    const controller = new AbortController();
    const promise = timeoutAfter(1000, "sleep", controller.signal);
    const expectation = expect(promise).rejects.toThrow("cancel sleep");

    controller.abort(new Error("cancel sleep"));

    await expectation;
  });
});
