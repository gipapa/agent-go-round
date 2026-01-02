import { AgentAdapter, ChatEvent, ChatRequest } from "./base";

declare global {
  interface Window {
    ai?: any; // Chrome built-in AI (Prompt API)
  }
}

function renderHistory(history: { role: string; content: string }[]) {
  // MVP: flatten history into a text context.
  return history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
}

export const ChromePromptAdapter: AgentAdapter = {
  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    if (!window.ai?.languageModel) {
      yield { type: "done", text: "Chrome Prompt API not available in this browser/profile." };
      return;
    }

    const context = renderHistory(req.history.map((h) => ({ role: h.role, content: h.content })));
    const system = req.system?.trim() ? `SYSTEM:\n${req.system.trim()}\n\n` : "";
    const prompt = `${system}${context ? `HISTORY:\n${context}\n\n` : ""}USER:\n${req.input}`;

    const session = await window.ai.languageModel.create({
      temperature: 0.7,
      topK: 40
    });

    const stream = await session.promptStreaming(prompt);
    let full = "";
    for await (const chunk of stream) {
      full += chunk;
      yield { type: "delta", text: chunk };
    }
    yield { type: "done", text: full };
  }
};
