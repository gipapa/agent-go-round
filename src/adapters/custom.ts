import { AgentAdapter, ChatEvent, ChatRequest } from "./base";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  getAbortSignalMessage,
  getErrorMessage,
  getRetryAfterDelayMs,
  sleepWithAbort
} from "../utils/fetchWithTimeout";

function mustache(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

// Minimal JSONPath-like getter: supports $.a.b[0].c
function getByPath(obj: any, path: string) {
  const p = path.replace(/^\$\./, "");
  const parts = p.split(".").flatMap((seg) => {
    const m = seg.match(/^(\w+)\[(\d+)\]$/);
    if (m) return [m[1], Number(m[2]) as any];
    return [seg];
  });

  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part as any];
  }
  return cur;
}

export const CustomAdapter: AgentAdapter = {
  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const c = req.agent.custom;
    if (!c) {
      yield { type: "done", text: "Custom adapter missing config." };
      return;
    }

    const history = req.history
      .filter((m) => m.role !== "tool")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const body = mustache(c.bodyTemplate, {
      input: req.input,
      history,
      model: req.agent.model ?? ""
    });
    const retryDelaySec = Math.max(0, req.retry?.delaySec ?? 0);
    const retryMax = Math.max(0, req.retry?.max ?? 0);
    const timeoutMs = req.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

    let text = "";
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
          yield { type: "done", text: `Request failed: ${getAbortSignalMessage(req.signal)}` };
          return;
        }
        if (attempt < retryMax) {
          req.onLog?.(`[retry] network error, attempt ${attempt + 1}/${retryMax}, waiting ${retryDelaySec}s`);
          try {
            await sleepWithAbort(retryDelaySec * 1000, req.signal);
          } catch (waitError) {
            yield { type: "done", text: `Request failed: ${getErrorMessage(waitError)}` };
            return;
          }
          continue;
        }
        yield { type: "done", text: `Request failed: ${getErrorMessage(error)}` };
        return;
      }

      text = await res.text();
      if (res.status === 429 && attempt < retryMax) {
        const delayMs = getRetryAfterDelayMs(res.headers, retryDelaySec * 1000);
        req.onLog?.(`[retry] HTTP 429, attempt ${attempt + 1}/${retryMax}, waiting ${Math.round(delayMs / 1000)}s`);
        try {
          await sleepWithAbort(delayMs, req.signal);
        } catch (waitError) {
          yield { type: "done", text: `Request failed: ${getErrorMessage(waitError)}` };
          return;
        }
        continue;
      }
      break;
    }

    if (!res) {
      yield { type: "done", text: "Request failed: No response" };
      return;
    }

    if (!res.ok) {
      yield { type: "done", text: `Request failed: HTTP ${res.status}\n${text}` };
      return;
    }

    let out = text;
    try {
      const j = JSON.parse(text);
      const v = getByPath(j, c.responseJsonPath);
      if (typeof v === "string") out = v;
      else out = JSON.stringify(v, null, 2);
    } catch {
      // treat as plain text
    }

    yield { type: "done", text: out };
  }
};
