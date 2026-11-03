// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "./random";

afterEach(() => vi.unstubAllGlobals());

it("generates distinct v4 UUIDs with secure randomness when native randomUUID is missing", () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal("crypto", { getRandomValues });
  const ids = Array.from({ length: 100 }, () => randomUUID());
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it("reports missing secure randomness without substituting Math.random for CSP nonces", () => {
  vi.stubGlobal("crypto", undefined);
  const random = vi.spyOn(Math, "random");
  try {
    expect(() => randomUUID()).toThrow("Secure random number generation is unavailable");
    expect(random).not.toHaveBeenCalled();
  } finally { random.mockRestore(); }
});
