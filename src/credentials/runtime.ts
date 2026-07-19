import { ModelCredentialEntry } from "../storage/settingsStore";
import { normalizeCredentialUrl } from "../utils/credential";

export type CredentialTestState = {
  ok: boolean;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function fetchModelsResponse(slot: ModelCredentialEntry, apiKey: string) {
  const endpoint = normalizeCredentialUrl(slot.endpoint);
  if (!endpoint) throw new Error("請先設定 endpoint。");

  const headers: HeadersInit | undefined = slot.preset === "gemini"
    ? apiKey.trim() ? { "x-goog-api-key": apiKey.trim() } : undefined
    : apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined;

  return await fetch(`${endpoint}/models`, { headers });
}

export async function testCredentialConnection(
  slot: ModelCredentialEntry,
  apiKey: string
): Promise<CredentialTestState> {
  if (slot.preset === "chrome_prompt") {
    return { ok: true, message: "Chrome Prompt provider 不需要遠端連線測試。" };
  }

  const res = await fetchModelsResponse(slot, apiKey);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        slot.preset === "gemini"
          ? "已連到 Gemini provider，但 API key 無效或沒有權限。"
          : "已連到 provider，但 API key 無效或沒有權限。"
      );
    }
    if (res.status === 404) {
      throw new Error(
        slot.preset === "gemini"
          ? "已連到 endpoint，但找不到 /models。請確認這是不是 Gemini API endpoint。"
          : "已連到 endpoint，但找不到 /models。請確認這是不是 OpenAI-compatible endpoint。"
      );
    }
    throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
  }

  const json = asRecord(await res.json().catch(() => null));
  const count = slot.preset === "gemini"
    ? Array.isArray(json?.models) ? json.models.length : undefined
    : Array.isArray(json?.data) ? json.data.filter((item) => asRecord(item)?.active !== false).length : undefined;

  return {
    ok: true,
    message: count === undefined ? "測試成功：provider 有回應。" : `測試成功：可用模型 ${count} 個。`
  };
}

export async function fetchCredentialModels(slot: ModelCredentialEntry, apiKey: string): Promise<string[]> {
  if (slot.preset === "chrome_prompt") return ["chrome_prompt"];

  const res = await fetchModelsResponse(slot, apiKey);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
  }

  const json = asRecord(await res.json().catch(() => null));
  const models = slot.preset === "gemini"
    ? Array.isArray(json?.models)
      ? json.models
          .map((item) => String(asRecord(item)?.name ?? "").trim())
          .map((name) => name.replace(/^models\//, ""))
          .filter(Boolean)
      : []
    : Array.isArray(json?.data)
      ? json.data.map((item) => String(asRecord(item)?.id ?? "").trim()).filter(Boolean)
      : [];

  if (!models.length) throw new Error("這個 endpoint 沒有回傳可用模型。");
  return models;
}
