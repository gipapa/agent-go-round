import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, getRetryAfterDelayMs } from "../utils/fetchWithTimeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns successful fetch responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));

    const response = await fetchWithTimeout("https://example.com", {}, { timeoutMs: 1000 });

    await expect(response.text()).resolves.toBe("ok");
  });

  it("aborts requests when timeout expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithTimeout("https://example.com/hang", {}, { timeoutMs: 25 });
    const expectation = expect(promise).rejects.toThrow("fetch timeout after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("honors external abort signals", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithTimeout("https://example.com/hang", {}, { signal: controller.signal, timeoutMs: 0 });
    const expectation = expect(promise).rejects.toThrow("manual stop");
    controller.abort(new Error("manual stop"));

    await expectation;
  });

  it("parses Retry-After as seconds or HTTP date", () => {
    expect(getRetryAfterDelayMs(new Headers({ "Retry-After": "3" }), 100)).toBe(3000);

    const date = new Date(Date.now() + 5000).toUTCString();
    expect(getRetryAfterDelayMs(new Headers({ "Retry-After": date }), 100)).toBeGreaterThan(0);
    expect(getRetryAfterDelayMs(new Headers({ "Retry-After": "not-a-date" }), 100)).toBe(100);
  });
});
