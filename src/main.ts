import "./styles.css";
import { createGroqRuntime, DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL } from "./core/provider";
import { createScriptedSession } from "./core/scripted";
import { AgentSession, type SessionEvent } from "./core/session";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const configuredBaseUrl = import.meta.env.VITE_GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
const configuredModel = import.meta.env.VITE_GROQ_MODEL || DEFAULT_GROQ_MODEL;

const state = {
  messages: [] as ChatMessage[],
  session: createScriptedSession(["這是 scripted demo。輸入 Groq API key 後即可切換到真實串流。", "收到，這是同一個 session 的第二回合。"], { delayMs: 8 }),
  activeAssistant: undefined as { runId: string; element: HTMLElement } | undefined,
  provider: "scripted" as "scripted" | "groq"
};

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">M0-A · browser harness</p>
        <h1>AgentGoRound</h1>
      </div>
      <span id="runtime-badge" class="badge">scripted demo</span>
    </header>

    <section class="settings" aria-label="Provider settings">
      <div class="settings-heading">
        <div>
          <h2>Provider</h2>
          <p>API key 只在這個瀏覽器記憶體中使用，不會寫入 session。</p>
        </div>
        <button id="use-scripted" class="button secondary" type="button">使用 demo</button>
      </div>
      <form id="provider-form" class="provider-form">
        <label>Groq base URL<input id="base-url" type="url" value="${configuredBaseUrl}" autocomplete="url" /></label>
        <label>Model<input id="model" type="text" value="${configuredModel}" autocomplete="off" /></label>
        <label>API key<input id="api-key" type="password" placeholder="gsk_…" autocomplete="off" /></label>
        <button class="button" type="submit">連線 Groq</button>
      </form>
      <p id="settings-status" class="settings-status" role="status"></p>
    </section>

    <section class="chat-card" aria-label="Chat">
      <div id="messages" class="messages" aria-live="polite"></div>
      <form id="chat-form" class="composer">
        <label class="sr-only" for="prompt">訊息</label>
        <textarea id="prompt" rows="2" placeholder="輸入訊息…" required></textarea>
        <div class="composer-actions">
          <span id="run-status" class="run-status">idle</span>
          <button id="stop" class="button secondary" type="button" disabled>停止</button>
          <button id="send" class="button" type="submit">送出</button>
        </div>
      </form>
    </section>
    <p class="footnote">Pi agent core 0.84.4 · single session · no persistence yet</p>
  </div>
`;

const messagesElement = getElement<HTMLDivElement>("messages");
const promptElement = getElement<HTMLTextAreaElement>("prompt");
const sendButton = getElement<HTMLButtonElement>("send");
const stopButton = getElement<HTMLButtonElement>("stop");
const runStatus = getElement<HTMLSpanElement>("run-status");
const settingsStatus = getElement<HTMLParagraphElement>("settings-status");
const runtimeBadge = getElement<HTMLSpanElement>("runtime-badge");

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function renderMessage(message: ChatMessage, extraClass = ""): HTMLElement {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${message.role} ${extraClass}`.trim();
  wrapper.innerHTML = `<span class="message-role">${message.role === "user" ? "你" : message.role === "assistant" ? "agent" : "system"}</span><div class="message-content"></div>`;
  wrapper.querySelector<HTMLDivElement>(".message-content")!.textContent = message.content;
  messagesElement.append(wrapper);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return wrapper;
}

function appendAssistant(): HTMLElement {
  return renderMessage({ role: "assistant", content: "" }, "streaming");
}

function setRunning(running: boolean): void {
  sendButton.disabled = running;
  stopButton.disabled = !running;
  promptElement.disabled = running;
  runStatus.textContent = running ? "working" : "idle";
}

function onSessionEvent(event: SessionEvent): void {
  if (event.type === "run_started") {
    state.activeAssistant = { runId: event.runId, element: appendAssistant() };
    setRunning(true);
    return;
  }
  if (event.type === "text_delta" && state.activeAssistant?.runId === event.runId) {
    const content = state.activeAssistant.element.querySelector<HTMLDivElement>(".message-content")!;
    content.textContent += event.delta;
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return;
  }
  if (event.type === "run_finished" && state.activeAssistant?.runId === event.runId) {
    const content = state.activeAssistant.element.querySelector<HTMLDivElement>(".message-content")!;
    content.textContent = event.text || (event.status === "aborted" ? "已停止" : event.error || "沒有收到文字回覆");
    state.activeAssistant.element.classList.remove("streaming");
    if (event.status === "error") state.activeAssistant.element.classList.add("error");
    state.activeAssistant = undefined;
    setRunning(false);
  }
}

state.session.subscribe(onSessionEvent);
renderMessage({ role: "system", content: "Demo 已就緒。你可以直接測試多輪串流，或在上方輸入 Groq API key。" });

getElement<HTMLFormElement>("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = promptElement.value.trim();
  if (!input || state.session.isRunning) return;
  promptElement.value = "";
  renderMessage({ role: "user", content: input });
  await state.session.prompt(input);
  promptElement.focus();
});

stopButton.addEventListener("click", () => {
  state.session.stop();
});

getElement<HTMLButtonElement>("use-scripted").addEventListener("click", () => {
  if (state.session.isRunning) return;
  state.session = createScriptedSession(["這是 scripted demo。輸入 Groq API key 後即可切換到真實串流。", "收到，這是同一個 session 的第二回合。"], { delayMs: 8 });
  state.session.subscribe(onSessionEvent);
  state.provider = "scripted";
  runtimeBadge.textContent = "scripted demo";
  settingsStatus.textContent = "已切換到不消耗額度的 scripted model。";
});

getElement<HTMLFormElement>("provider-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.session.isRunning) {
    settingsStatus.textContent = "請先等待目前 run 結束。";
    return;
  }
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  button.disabled = true;
  settingsStatus.textContent = "建立 Groq runtime…";
  try {
    const runtime = await createGroqRuntime({
      baseUrl: getElement<HTMLInputElement>("base-url").value,
      model: getElement<HTMLInputElement>("model").value,
      apiKey: getElement<HTMLInputElement>("api-key").value
    });
    state.session = new AgentSession({ sessionId: "groq-session", model: runtime.model, streamFn: runtime.streamFn });
    state.session.subscribe(onSessionEvent);
    state.provider = "groq";
    runtimeBadge.textContent = "groq · live";
    settingsStatus.textContent = "Groq 已連線設定完成；送出下一則訊息以測試。";
  } catch (error) {
    settingsStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
});
