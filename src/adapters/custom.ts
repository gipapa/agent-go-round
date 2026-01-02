import { AgentAdapter, ChatEvent, ChatRequest } from "./base";

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

    const history = req.history.map((m) => `${m.role}: ${m.content}`).join("\n");
    const body = mustache(c.bodyTemplate, {
      input: req.input,
      history,
      model: req.agent.model ?? ""
    });

    const res = await fetch(c.url, {
      method: c.method,
      headers: {
        "Content-Type": "application/json",
        ...(req.agent.apiKey ? { Authorization: `Bearer ${req.agent.apiKey}` } : {}),
        ...(req.agent.headers ?? {})
      },
      body
    });

    const text = await res.text();
    if (!res.ok) {
      yield { type: "done", text: `HTTP ${res.status}\n${text}` };
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
