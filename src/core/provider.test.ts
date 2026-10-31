import { describe, expect, it } from "vitest";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL, normalizeBaseUrl, normalizeModel, normalizeGroqRateLimitResponse, createGroqRuntime } from "./provider";

describe("Groq provider configuration", () => {
  it("has explicit browser-safe defaults", () => {
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_GROQ_BASE_URL);
    expect(normalizeModel(undefined)).toBe(DEFAULT_GROQ_MODEL);
  });

  it("rejects insecure non-local endpoints", () => {
    expect(() => normalizeBaseUrl("http://api.example.com/v1")).toThrow(/HTTPS/);
    expect(normalizeBaseUrl("http://localhost:8787/v1")).toBe("http://localhost:8787/v1");
  });

  it("uses model-supported reasoning defaults and rejects incompatible GPT-OSS settings", async () => {
    const gpt = await createGroqRuntime({ apiKey: "fixture" });
    expect(gpt.model.samplingParams).toMatchObject({ reasoning_effort: "medium", include_reasoning: false });
    const qwen = await createGroqRuntime({ apiKey: "fixture", model: "qwen/qwen3.8-27b" });
    expect(qwen.model.samplingParams).toMatchObject({ reasoning_effort: "none" });
    expect(qwen.model.compat).toMatchObject({ supportsDeveloperRole: false });
    await expect(createGroqRuntime({ apiKey: "fixture", reasoningEffort: "none" })).rejects.toThrow("GPT-OSS requires");
  });

  it("restores a missing CORS Retry-After without consuming or rewriting the error body", async () => {
    const text = JSON.stringify({ error: { message: "Rate limit reached. Please try again in 15.5325s." } });
    const response = await normalizeGroqRateLimitResponse(new Response(text, { status: 429 }));
    expect(Number(response.headers.get("retry-after"))).toBeCloseTo(15.7825);
    expect(await response.text()).toBe(text);
    const known = new Response(text, { status: 429, headers: { "Retry-After": "20" } });
    expect(await normalizeGroqRateLimitResponse(known)).toBe(known);
    const unknown = new Response("not JSON", { status: 429 });
    expect(await normalizeGroqRateLimitResponse(unknown)).toBe(unknown);
  });
});
