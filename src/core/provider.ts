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

function createModel(baseUrl: string, modelId: string): Model<"openai-completions"> {
  const isGptOss = /^openai\/gpt-oss-(?:20b|120b)$/.test(modelId);
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: GROQ_PROVIDER_ID,
    baseUrl,
    reasoning: isGptOss,
    ...(isGptOss
      ? {
          thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null },
          samplingParams: { reasoning_effort: "low", include_reasoning: false }
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

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const model = createModel(baseUrl, normalizeModel(config.model));
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
    streamFn: (requestModel, context, options) =>
      models.streamSimple(requestModel, context, {
        ...options,
        ...(config.headers ? { headers: config.headers } : {})
      })
  };
}

export { normalizeBaseUrl, normalizeModel };
