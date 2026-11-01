import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL, fetchProviderModels, normalizeBaseUrl, normalizeModel, normalizeGroqRateLimitResponse, createGroqRuntime } from "./provider";

afterEach(() => vi.unstubAllGlobals());

describe("Groq provider configuration", () => {
  it("has explicit browser-safe defaults", () => {
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_GROQ_BASE_URL);
    expect(normalizeModel(undefined)).toBe(DEFAULT_GROQ_MODEL);
  });

  it("rejects insecure non-local endpoints", () => {
    expect(() => normalizeBaseUrl("http://api.example.com/v1")).toThrow(/HTTPS/);
    expect(normalizeBaseUrl("http://localhost:8787/v1")).toBe("http://localhost:8787/v1");
  });

  it("loads model IDs and context lengths from the configured authenticated endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [
      { id: "groq-model", context_window: 131072 },
      { id: "local-model", context_length: 32768 },
      { id: "vllm-model", max_model_len: 8192 },
      { id: "unknown-limit", context_window: -1 },
      { id: "inactive", active: false },
      { id: "" }, null
    ] }));
    vi.stubGlobal("fetch", fetcher);
    const models = await fetchProviderModels({ apiKey: "test-secret", baseUrl: "https://api.example.com/v1/" });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/models", expect.objectContaining({ headers: { Authorization: "Bearer test-secret" } }));
    expect(models).toEqual([
      { id: "groq-model", contextWindow: 131072 }, { id: "local-model", contextWindow: 32768 },
      { id: "unknown-limit" }, { id: "vllm-model", contextWindow: 8192 }
    ]);
    const runtime = await createGroqRuntime({ apiKey: "test-secret", model: models[1].id, contextWindow: models[1].contextWindow });
    expect(runtime.model.contextWindow).toBe(32768);
    await expect(createGroqRuntime({ apiKey: "fixture", contextWindow: 0 })).rejects.toThrow(/Context length/);
    await expect(createGroqRuntime({ apiKey: "fixture", contextWindow: 1.5 })).rejects.toThrow(/Context length/);
  });

  it("reports unavailable or malformed model catalogs for manual fallback", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ models: [] })).mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const config = { apiKey: "fixture" };
    await expect(fetchProviderModels(config)).rejects.toThrow(/404/);
    await expect(fetchProviderModels(config)).rejects.toThrow(/Invalid models/);
    await expect(fetchProviderModels(config)).rejects.toThrow(/no available models/);
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
