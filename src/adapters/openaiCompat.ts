import { AgentAdapter, ChatEvent, ChatRequest } from "./base";
import { DetectResult, ChatMessage } from "../types";

function toOpenAIMessage(m: ChatMessage) {
  if (m.role === "tool") {
    // MVP: tool messages are flattened into assistant text.
    return { role: "assistant", content: `[tool:${m.name ?? "tool"}]\n${m.content}` };
  }
  return { role: m.role, content: m.content };
}

export const OpenAICompatAdapter: AgentAdapter = {
  async detect(agent): Promise<DetectResult> {
    if (!agent.endpoint) return { ok: false, detectedType: "unknown", notes: "No endpoint" };
    try {
      const url = agent.endpoint.replace(/\/$/, "") + "/models";
      const res = await fetch(url, {
        headers: {
          ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
          ...(agent.headers ?? {})
        }
      });
      if (!res.ok) return { ok: false, detectedType: "unknown", notes: `HTTP ${res.status}` };
      const json = await res.json();
      if (json?.data && Array.isArray(json.data)) return { ok: true, detectedType: "openai_compat" };
      return { ok: false, detectedType: "unknown", notes: "Unexpected /models response" };
    } catch (e: any) {
      return { ok: false, detectedType: "unknown", notes: e?.message ?? "detect failed" };
    }
  },

  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const endpoint = (req.agent.endpoint ?? "").replace(/\/$/, "");
    const url = endpoint + "/chat/completions";

    const messages: any[] = [];
    if (req.system?.trim()) messages.push({ role: "system", content: req.system.trim() });
    for (const m of req.history) messages.push(toOpenAIMessage(m));
    messages.push({ role: "user", content: req.input });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.agent.apiKey ? { Authorization: `Bearer ${req.agent.apiKey}` } : {}),
        ...(req.agent.headers ?? {})
      },
      body: JSON.stringify({
        model: req.agent.model ?? "gpt-4o-mini",
        stream: true,
        messages
      })
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield { type: "done", text: `Request failed: HTTP ${res.status}\n${text}` };
      return;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      try {
        const json = await res.json();
        const text = json?.choices?.[0]?.message?.content ?? "";
        yield { type: "done", text };
        return;
      } catch {
        const text = await res.text().catch(() => "");
        yield { type: "done", text };
        return;
      }
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          yield { type: "done", text: full };
          return;
        }
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content ?? "";
          const msgContent = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? "";
          if (delta) {
            full += delta;
            yield { type: "delta", text: delta };
            continue;
          }
          if (msgContent) {
            const nextText = msgContent.startsWith(full) ? msgContent.slice(full.length) : msgContent;
            full = msgContent;
            if (nextText) yield { type: "delta", text: nextText };
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    yield { type: "done", text: full };
  }
};
