import {
  createModels,
  createProvider,
  InMemoryCredentialStore,
  type AuthContext,
  type Model,
  type MutableModels,
  type ProviderAuth
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";

export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const GROQ_PROVIDER_ID = "agent-go-round-groq";

export type GroqConfig = {
  baseUrl?: string;
  model?: string;
  apiKey: string;
  headers?: Record<string, string>;
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
};

export type ProviderRuntime = {
  model: Model<"openai-completions">;
  models: MutableModels;
  streamFn: StreamFn;
};

const browserAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false
};

const inMemoryApiKeyAuth: ProviderAuth = {
  apiKey: {
    name: "AgentGoRound browser API key",
    resolve: async ({ credential }) => {
      const key = credential?.key?.trim();
      return key ? { auth: { apiKey: key }, source: "AgentGoRound in-memory runtime" } : undefined;
    }
  }
};

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value || DEFAULT_GROQ_BASE_URL).trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new Error("Groq base URL 必須是有效網址", { cause: error });
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("Groq base URL 必須使用 HTTPS；本機 relay 可使用 localhost");
  }
  return baseUrl;
}

function normalizeModel(model: string | undefined): string {
  const value = (model || DEFAULT_GROQ_MODEL).trim();
  if (!value) throw new Error("請提供 Groq model ID");
  return value;
}

/** Groq's CORS response may hide Retry-After. Preserve the server delay for Pi's bounded retry. */
export async function normalizeGroqRateLimitResponse(response: Response): Promise<Response> {
  if (response.status !== 429 || response.headers.get("retry-after") || response.headers.get("retry-after-ms")) return response;
  try {
    const body = await response.clone().json() as { error?: { message?: string }; message?: string };
    const message = body.error?.message ?? body.message ?? "";
    const match = message.match(/try again in\s+([\d.]+)\s*(ms|s|m|h)\b/i);
    if (!match) return response;
    const seconds = Number(match[1]) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[match[2].toLowerCase()] ?? 1);
    if (!Number.isFinite(seconds) || seconds < 0) return response;
    const headers = new Headers(response.headers);
    headers.set("retry-after", String(seconds + 0.25));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch { return response; }
}

function createModel(baseUrl: string, modelId: string, effort?: "none" | "low" | "medium" | "high"): Model<"openai-completions"> {
  const isGptOss = /^openai\/gpt-oss-(?:20b|120b)$/.test(modelId);
  const isQwen = modelId === "qwen/qwen3.8-27b";
  if (isGptOss && effort === "none") throw new Error("GPT-OSS requires low, medium or high reasoning effort");
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: GROQ_PROVIDER_ID,
    baseUrl,
    reasoning: isGptOss || isQwen,
    ...(isGptOss || isQwen
      ? {
          thinkingLevelMap: { off: isQwen ? "none" : null, minimal: isQwen ? "none" : null, low: "low", medium: "medium", high: "high", xhigh: null, max: null },
          samplingParams: { reasoning_effort: effort ?? (isQwen ? "none" : "medium"), include_reasoning: false },
          ...(isQwen ? { compat: { supportsDeveloperRole: false } } : {})
        }
      : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
}

/**
 * Creates the first real provider boundary. The API key is placed only in
 * Pi's in-memory credential store and never becomes part of session state.
 */
export async function createGroqRuntime(config: GroqConfig): Promise<ProviderRuntime> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error("請先輸入 Groq API key");
  if (config.temperature !== undefined && (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2)) throw new Error("temperature must be between 0 and 2");
  if (config.reasoningEffort !== undefined && !["none", "low", "medium", "high"].includes(config.reasoningEffort)) throw new Error("Invalid reasoning effort");

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const model = createModel(baseUrl, normalizeModel(config.model), config.reasoningEffort);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(GROQ_PROVIDER_ID, async () => ({ type: "api_key", key: apiKey }));

  const provider = createProvider<"openai-completions">({
    id: GROQ_PROVIDER_ID,
    name: "AgentGoRound Groq provider",
    baseUrl,
    headers: config.headers,
    auth: inMemoryApiKeyAuth,
    models: [model],
    api: openAICompletionsApi()
  });
  const models = createModels({ credentials, authContext: browserAuthContext });
  models.setProvider(provider);

  return {
    model,
    models,
    streamFn: (requestModel, context, options) => {
      const transport = options?.fetch ?? globalThis.fetch.bind(globalThis);
      return models.streamSimple(requestModel, context, {
        ...options,
        fetch: async (...args) => normalizeGroqRateLimitResponse(await transport(...args)),
        temperature: options?.temperature ?? config.temperature ?? 0.6,
        maxRetries: options?.maxRetries ?? 2,
        ...(config.headers ? { headers: config.headers } : {})
      });
    }
  };
}

export { normalizeBaseUrl, normalizeModel };
