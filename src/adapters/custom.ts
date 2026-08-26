import { AgentAdapter, ChatEvent, ChatRequest, normalizeRetryConfig } from "./base";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  getAbortSignalMessage,
  getErrorMessage,
  getRetryAfterDelayMs,
  readResponseTextWithLimit,
  sleepWithAbort
} from "../utils/fetchWithTimeout";

const DEFAULT_MAX_RESPONSE_CHARS = 64_000;

function normalizeMaxResponseChars(value: number | undefined) {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.min(1_000_000, Math.floor(value as number))
    : DEFAULT_MAX_RESPONSE_CHARS;
}

function mustache(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}

function renderCustomBody(template: string, vars: Record<string, string>) {
  const raw = mustache(template, vars);
  try {
    JSON.parse(raw) as unknown;
    return raw;
  } catch {
    // Keep legacy plain-text templates unchanged. For JSON templates, retry
    // with JSON-safe placeholder values so the protocol system/transcript can
    // contain quotes and newlines without corrupting the request body.
    const looksLikeJson = /^[\s\n\r]*[\[{]/.test(template);
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string, offset: number) => {
      const value = vars[key] ?? "";
      const before = template[offset - 1];
      const after = template[offset + match.length];
      if (before === '"' && after === '"') {
        return JSON.stringify(value).slice(1, -1);
      }
      return looksLikeJson ? JSON.stringify(value) : value;
    });
  }
}

export function supportsCustomTextProtocol(agent: { custom?: { bodyTemplate: string } }) {
  const template = agent.custom?.bodyTemplate ?? "";
  return /\{\{\s*input\s*\}\}/.test(template) && /\{\{\s*system\s*\}\}/.test(template);
}

// Minimal JSONPath-like getter: supports $.a.b[0].c
function getByPath(obj: unknown, path: string) {
  const p = path.replace(/^\$\./, "");
  const parts: Array<string | number> = p.split(".").flatMap((seg): Array<string | number> => {
    const m = seg.match(/^(\w+)\[(\d+)\]$/);
    if (m) return [m[1], Number(m[2])];
    return [seg];
  });

  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof part === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[part];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function httpError(status: number, text: string): ChatEvent {
  const kind = status === 429 ? "rate_limit" : status === 401 || status === 403 ? "auth" : "http";
  const retryable = status === 429 || status >= 500;
  return { type: "error", kind, retryable, message: `HTTP ${status}${text ? `\n${text}` : ""}` };
}

export const CustomAdapter: AgentAdapter = {
  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const c = req.agent.custom;
    if (!c) {
      yield { type: "error", kind: "provider", retryable: false, message: "Custom adapter missing config." };
      return;
    }

    const history = req.history
      .filter((m) => m.role !== "tool")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const body = renderCustomBody(c.bodyTemplate, {
      input: req.input,
      history,
      model: req.agent.model ?? "",
      system: req.system ?? ""
    });
    const retry = normalizeRetryConfig(req.retry);
    const retryDelaySec = retry?.delaySec ?? 0;
    const retryMax = retry?.max ?? 0;
    const timeoutMs = req.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxResponseChars = normalizeMaxResponseChars(req.maxModelResponseChars);
    const maxResponseBodyChars = maxResponseChars + 65_536;

    let text = "";
    let responseTooLarge = false;
    let res: Response | null = null;
    for (let attempt = 0; attempt <= retryMax; attempt++) {
      try {
        res = await fetchWithTimeout(
          c.url,
          {
            method: c.method,
            headers: {
              "Content-Type": "application/json",
              ...(req.agent.apiKey ? { Authorization: `Bearer ${req.agent.apiKey}` } : {}),
              ...(req.agent.headers ?? {})
            },
            body
          },
          { signal: req.signal, timeoutMs }
        );
      } catch (error) {
        if (req.signal?.aborted) {
          yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
          return;
        }
        if (attempt < retryMax) {
          req.onLog?.(`[retry] network error, attempt ${attempt + 1}/${retryMax}, waiting ${retryDelaySec}s`);
          try {
            await sleepWithAbort(retryDelaySec * 1000, req.signal);
          } catch (waitError) {
            if (req.signal?.aborted) yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
            else yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(waitError) };
            return;
          }
          continue;
        }
        yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(error) };
        return;
      }

      const bounded = await readResponseTextWithLimit(res, maxResponseBodyChars);
      text = bounded.text;
      responseTooLarge = bounded.exceeded;
      if (res.status === 429 && attempt < retryMax) {
        const delayMs = getRetryAfterDelayMs(res.headers, retryDelaySec * 1000);
        req.onLog?.(`[retry] HTTP 429, attempt ${attempt + 1}/${retryMax}, waiting ${Math.round(delayMs / 1000)}s`);
        try {
          await sleepWithAbort(delayMs, req.signal);
        } catch (waitError) {
          if (req.signal?.aborted) yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
          else yield { type: "error", kind: "rate_limit", retryable: true, message: getErrorMessage(waitError) };
          return;
        }
        continue;
      }
      break;
    }

    if (!res) {
      yield { type: "error", kind: "network", retryable: true, message: "No response" };
      return;
    }

    if (!res.ok) {
      yield httpError(res.status, text);
      return;
    }
    if (responseTooLarge || text.length > maxResponseChars) {
      yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
      return;
    }

    let out = text;
    try {
      const j = JSON.parse(text) as unknown;
      const v = getByPath(j, c.responseJsonPath);
      if (typeof v === "string") out = v;
      else out = JSON.stringify(v, null, 2) ?? "";
    } catch {
      // treat as plain text
    }

    if (out.length > maxResponseChars) {
      yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
      return;
    }

    yield { type: "done", text: out };
  }
};
