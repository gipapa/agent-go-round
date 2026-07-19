import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelCredentialEntry, ModelCredentialPreset } from "../storage/settingsStore";
import { fetchCredentialModels, testCredentialConnection } from "../credentials/runtime";

function credential(preset: ModelCredentialPreset, endpoint = "https://example.com/v1"): ModelCredentialEntry {
  return {
    id: `${preset}-credential`,
    preset,
    label: preset,
    endpoint,
    keys: [],
    createdAt: 1,
    updatedAt: 1
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("credential runtime", () => {
  it("lists OpenAI-compatible models with bearer authentication", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-a" }, { id: "gpt-b" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCredentialModels(credential("openai"), " secret ")).resolves.toEqual(["gpt-a", "gpt-b"]);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/models", {
      headers: { Authorization: "Bearer secret" }
    });
  });

  it("normalizes Gemini model names and uses the Gemini API key header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "models/gemini-a" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCredentialModels(credential("gemini"), "gem-key")).resolves.toEqual(["gemini-a"]);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/models", {
      headers: { "x-goog-api-key": "gem-key" }
    });
  });

  it("handles Chrome Prompt locally without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCredentialModels(credential("chrome_prompt", ""), "")).resolves.toEqual(["chrome_prompt"]);
    await expect(testCredentialConnection(credential("chrome_prompt", ""), "")).resolves.toEqual({
      ok: true,
      message: "Chrome Prompt provider 不需要遠端連線測試。"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns provider-specific authentication errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));

    await expect(testCredentialConnection(credential("openai"), "bad")).rejects.toThrow("API key 無效或沒有權限");
    await expect(testCredentialConnection(credential("gemini"), "bad")).rejects.toThrow("Gemini provider");
  });

  it("rejects empty model catalogs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    await expect(fetchCredentialModels(credential("custom"), "")).rejects.toThrow("沒有回傳可用模型");
  });
});
