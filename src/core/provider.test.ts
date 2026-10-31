import { describe, expect, it } from "vitest";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL, normalizeBaseUrl, normalizeModel } from "./provider";

describe("Groq provider configuration", () => {
  it("has explicit browser-safe defaults", () => {
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_GROQ_BASE_URL);
    expect(normalizeModel(undefined)).toBe(DEFAULT_GROQ_MODEL);
  });

  it("rejects insecure non-local endpoints", () => {
    expect(() => normalizeBaseUrl("http://api.example.com/v1")).toThrow(/HTTPS/);
    expect(normalizeBaseUrl("http://localhost:8787/v1")).toBe("http://localhost:8787/v1");
  });
});
