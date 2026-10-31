import "./styles.css";
import { createGroqRuntime, DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL } from "./core/provider";
import { createScriptedSession } from "./core/scripted";
import { AgentSession, type SessionEvent } from "./core/session";

type TabStatus = "working" | "idle" | "done" | "blocked" | "error";
type TranscriptRole = "system" | "input" | "assistant";

type TranscriptLine = {
  id: string;
  role: TranscriptRole;
  text: string;
  streaming?: boolean;
};

type AgentTab = {
  id: string;
  name: string;
  branch: string;
  path: string;
  session: AgentSession;
  detach: () => void;
  transcript: TranscriptLine[];
  activeLineId?: string;
  status: TabStatus;
  unread: number;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const configuredBaseUrl = import.meta.env.VITE_GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
const configuredModel = import.meta.env.VITE_GROQ_MODEL || DEFAULT_GROQ_MODEL;
const STORAGE_KEYS = {
  apiKey: "agent-go-round.groq.api-key",
  baseUrl: "agent-go-round.groq.base-url",
  model: "agent-go-round.groq.model"
} as const;

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

const storedApiKey = readStored(STORAGE_KEYS.apiKey);
const storedBaseUrl = readStored(STORAGE_KEYS.baseUrl);
const storedModel = readStored(STORAGE_KEYS.model);

const state = {
  tabs: [] as AgentTab[],
  activeTabId: "main",
  provider: "scripted" as "scripted" | "groq",
  nextTabNumber: 3
};

app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar" aria-label="AgentGoRound navigation">
      <div class="brand-row">
        <div class="brand-mark" aria-hidden="true">⌁</div>
        <div class="brand-name">AgentGoRound</div>
        <span class="brand-version">0.1</span>
      </div>

      <div class="sidebar-body">
        <div class="sidebar-section-heading">
          <span>spaces</span>
          <button id="add-space" class="sidebar-action" type="button" aria-label="Add space">+</button>
        </div>
        <button class="space-row selected" type="button">
          <span class="space-glyph">⌂</span>
          <span class="space-copy"><strong>agent-go-round</strong><small>master</small></span>
        </button>

        <div class="sidebar-section-heading agents-heading">
          <span>agents</span>
          <span id="agent-count" class="section-count">0</span>
        </div>
        <div id="agent-list" class="agent-list"></div>
      </div>

      <div class="sidebar-footer">
        <button id="provider-toggle" class="footer-button" type="button">
          <span class="footer-icon">◌</span><span id="provider-label">scripted model</span><span class="footer-chevron">⌘,</span>
        </button>
        <div class="runtime-state"><span class="status-dot idle">○</span><span>local runtime</span><span class="runtime-version">Pi 0.84.4</span></div>
      </div>
    </aside>

    <main class="workspace">
      <header class="workspace-header">
        <div class="workspace-context"><span class="context-symbol">◆</span><strong>agent-go-round</strong><span class="branch-label">master</span></div>
        <div class="workspace-actions"><span class="connection-label"><span class="status-dot idle">○</span> connected</span><button id="command-hint" class="header-action" type="button">⌘K commands</button></div>
      </header>

      <nav class="tab-bar" aria-label="Agent tabs">
        <div id="tab-list" class="tab-list"></div>
        <button id="add-tab" class="add-tab" type="button" aria-label="New agent tab">+</button>
      </nav>

      <section class="pane" aria-label="Active agent pane">
        <header class="pane-header">
          <div class="pane-agent-title"><span id="pane-status-dot" class="status-dot idle">○</span><strong id="pane-title">main</strong><span class="agent-type">Pi agent</span></div>
          <div class="pane-meta"><span id="pane-model">scripted model</span><span id="pane-path">~/agent-go-round</span></div>
        </header>

        <div id="terminal" class="terminal" role="log" aria-live="polite"></div>

        <form id="terminal-form" class="terminal-form">
          <span class="terminal-prompt" aria-hidden="true">❯</span>
          <label class="sr-only" for="prompt">Message</label>
          <textarea id="prompt" rows="1" placeholder="Ask this agent to do something…" autocomplete="off" required></textarea>
          <div class="terminal-form-actions"><span id="run-status" class="run-status">idle</span><button id="stop" class="terminal-button stop-button" type="button" disabled>esc stop</button><button id="send" class="terminal-button send-button" type="submit">send</button></div>
        </form>
        <footer class="terminal-footer"><span>enter send · shift+enter newline</span><span id="footer-model">scripted model · ~/agent-go-round · master</span></footer>
      </section>

      <aside id="settings-drawer" class="settings-drawer" aria-label="Provider settings" aria-hidden="true" hidden>
        <div class="drawer-heading"><div><span class="drawer-kicker">RUNTIME</span><h2>Provider connection</h2></div><button id="close-settings" class="drawer-close" type="button" aria-label="Close settings">×</button></div>
        <p class="drawer-copy">The key is saved in this browser's local storage when enabled. It is never added to a transcript.</p>
        <form id="provider-form" class="provider-form">
          <label>Base URL<input id="base-url" type="url" autocomplete="url" /></label>
          <label>Model<input id="model" type="text" autocomplete="off" /></label>
          <label>API key<input id="api-key" type="password" placeholder="gsk_…" autocomplete="off" /></label>
          <div class="remember-row"><label class="remember-toggle"><input id="remember-key" type="checkbox" /> Remember this key in this browser</label><button id="clear-key" class="clear-key" type="button">clear saved key</button></div>
          <div class="drawer-actions"><button id="use-scripted" class="drawer-button muted-button" type="button">Use demo</button><button class="drawer-button" type="submit">Connect Groq</button></div>
        </form>
        <p id="settings-status" class="settings-status" role="status"></p>
      </aside>
    </main>
  </div>
`;

const get = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

get<HTMLInputElement>("base-url").value = storedBaseUrl || configuredBaseUrl;
get<HTMLInputElement>("model").value = storedModel || configuredModel;
get<HTMLInputElement>("api-key").value = storedApiKey;
get<HTMLInputElement>("remember-key").checked = true;

const terminal = get<HTMLDivElement>("terminal");
const promptElement = get<HTMLTextAreaElement>("prompt");
const sendButton = get<HTMLButtonElement>("send");
const stopButton = get<HTMLButtonElement>("stop");
const settingsDrawer = get<HTMLElement>("settings-drawer");
const settingsStatus = get<HTMLParagraphElement>("settings-status");

function persistProviderSettings(): void {
  const apiKey = get<HTMLInputElement>("api-key").value.trim();
  const baseUrl = get<HTMLInputElement>("base-url").value.trim();
  const model = get<HTMLInputElement>("model").value.trim();
  const remember = get<HTMLInputElement>("remember-key").checked;
  try {
    if (remember && apiKey) localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    else localStorage.removeItem(STORAGE_KEYS.apiKey);
    if (baseUrl) localStorage.setItem(STORAGE_KEYS.baseUrl, baseUrl);
    if (model) localStorage.setItem(STORAGE_KEYS.model, model);
  } catch {
    settingsStatus.textContent = "Browser storage is unavailable; the key will only live for this page.";
  }
}

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scriptedSession(tabId: string, responses: readonly string[]): AgentSession {
  return createScriptedSession(responses, { sessionId: `session-${tabId}`, delayMs: 10 });
}

function createTab(id: string, name: string, responses: readonly string[], branch = "master", path = "~/agent-go-round"): AgentTab {
  const tab: AgentTab = {
    id,
    name,
    branch,
    path,
    session: scriptedSession(id, responses),
    detach: () => undefined,
    transcript: [
      { id: makeId("boot"), role: "system", text: `session ${name} · ${branch} · ready` },
      { id: makeId("boot"), role: "system", text: "Pi agent core 0.84.4 · text stream · no persistence" }
    ],
    status: "idle",
    unread: 0
  };
  attachSession(tab, tab.session);
  return tab;
}

function attachSession(tab: AgentTab, session: AgentSession): void {
  tab.detach();
  tab.session = session;
  tab.detach = session.subscribe((event) => handleSessionEvent(tab, event));
}

function handleSessionEvent(tab: AgentTab, event: SessionEvent): void {
  if (event.type === "run_started") {
    tab.status = "working";
    const line: TranscriptLine = { id: makeId("assistant"), role: "assistant", text: "", streaming: true };
    tab.activeLineId = line.id;
    tab.transcript.push(line);
    if (tab.id !== state.activeTabId) tab.unread += 1;
  }
  if (event.type === "text_delta") {
    const line = tab.transcript.find((candidate) => candidate.id === tab.activeLineId);
    if (line) line.text += event.delta;
  }
  if (event.type === "run_finished") {
    const line = tab.transcript.find((candidate) => candidate.id === tab.activeLineId);
    if (line) {
      line.text = event.text || (event.status === "aborted" ? "Interrupted." : event.error || "No text response.");
      line.streaming = false;
    }
    tab.activeLineId = undefined;
    tab.status = event.status === "success" ? "done" : event.status === "aborted" ? "idle" : "error";
  }
  render();
}

function activeTab(): AgentTab {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
  if (!tab) throw new Error(`Missing active tab ${state.activeTabId}`);
  return tab;
}

function statusLabel(status: TabStatus): string {
  return status === "working" ? "working" : status === "done" ? "done" : status === "blocked" ? "needs you" : status;
}

function statusGlyph(status: TabStatus): string {
  return status === "working" ? "●" : status === "done" ? "✓" : status === "blocked" ? "!" : "○";
}

function statusClass(status: TabStatus): string {
  return status === "working" ? "working" : status === "done" ? "done" : status === "blocked" ? "blocked" : status === "error" ? "error" : "idle";
}

function renderSidebar(): void {
  const list = get<HTMLDivElement>("agent-list");
  list.replaceChildren();
  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `agent-row${tab.id === state.activeTabId ? " selected" : ""}`;
    button.addEventListener("click", () => selectTab(tab.id));

    const dot = document.createElement("span");
    dot.className = `status-dot ${statusClass(tab.status)}`;
    dot.textContent = statusGlyph(tab.status);
    const copy = document.createElement("span");
    copy.className = "agent-copy";
    const name = document.createElement("strong");
    name.textContent = tab.name;
    const detail = document.createElement("small");
    detail.textContent = `${statusLabel(tab.status)} · Pi`;
    copy.append(name, detail);
    button.append(dot, copy);
    if (tab.unread > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-count";
      unread.textContent = String(tab.unread);
      button.append(unread);
    }
    list.append(button);
  }
  get<HTMLSpanElement>("agent-count").textContent = String(state.tabs.length);
}

function renderTabs(): void {
  const list = get<HTMLDivElement>("tab-list");
  list.replaceChildren();
  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${tab.id === state.activeTabId ? " active" : ""}`;
    button.addEventListener("click", () => selectTab(tab.id));
    const dot = document.createElement("span");
    dot.className = `status-dot ${statusClass(tab.status)}`;
    dot.textContent = statusGlyph(tab.status);
    const name = document.createElement("span");
    name.textContent = tab.name;
    button.append(dot, name);
    if (tab.unread > 0) {
      const unread = document.createElement("span");
      unread.className = "tab-unread";
      unread.textContent = String(tab.unread);
      button.append(unread);
    }
    if (state.tabs.length > 1) {
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.setAttribute("aria-label", `Close ${tab.name}`);
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      button.append(close);
    }
    list.append(button);
  }
}

function appendTerminalLine(line: TranscriptLine): void {
  const row = document.createElement("div");
  row.className = `terminal-line ${line.role}${line.streaming ? " streaming" : ""}`;
  const marker = document.createElement("span");
  marker.className = "line-marker";
  marker.textContent = line.role === "input" ? "❯" : line.role === "assistant" ? (line.streaming ? "⠇" : "●") : "·";
  const content = document.createElement("span");
  content.className = "line-content";
  content.textContent = line.text;
  row.append(marker, content);
  terminal.append(row);
}

function renderTerminal(tab: AgentTab): void {
  terminal.replaceChildren();
  const intro = document.createElement("div");
  intro.className = "terminal-intro";
  const logo = document.createElement("span");
  logo.className = "terminal-logo";
  logo.textContent = "▐▛███▜▌";
  const label = document.createElement("span");
  label.textContent = "AgentGoRound · Pi runtime";
  intro.append(logo, label);
  terminal.append(intro);
  for (const line of tab.transcript) appendTerminalLine(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function renderPane(tab: AgentTab): void {
  get<HTMLSpanElement>("pane-title").textContent = tab.name;
  get<HTMLSpanElement>("pane-path").textContent = tab.path;
  get<HTMLSpanElement>("pane-model").textContent = state.provider === "groq" ? configuredModel : "scripted model";
  get<HTMLSpanElement>("footer-model").textContent = `${state.provider === "groq" ? configuredModel : "scripted model"} · ${tab.path} · ${tab.branch}`;
  const statusDot = get<HTMLSpanElement>("pane-status-dot");
  statusDot.className = `status-dot ${statusClass(tab.status)}`;
  statusDot.textContent = statusGlyph(tab.status);
  get<HTMLSpanElement>("run-status").textContent = statusLabel(tab.status);
  const running = tab.session.isRunning;
  sendButton.disabled = running;
  stopButton.disabled = !running;
  promptElement.disabled = running;
  renderTerminal(tab);
}

function render(): void {
  const tab = activeTab();
  renderSidebar();
  renderTabs();
  renderPane(tab);
  get<HTMLSpanElement>("provider-label").textContent = state.provider === "groq" ? "groq · live" : "scripted model";
}

function selectTab(id: string): void {
  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab) return;
  state.activeTabId = id;
  tab.unread = 0;
  render();
  promptElement.focus();
}

function closeTab(id: string): void {
  if (state.tabs.length === 1) return;
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [removed] = state.tabs.splice(index, 1);
  removed.session.stop();
  removed.detach();
  if (state.activeTabId === id) state.activeTabId = state.tabs[Math.max(0, index - 1)].id;
  render();
}

function addTab(): void {
  const number = state.nextTabNumber++;
  const id = `agent-${number}`;
  const tab = createTab(id, `agent-${number}`, ["New pane ready. Ask me for a task and I will stream the response.", "This tab has its own independent session."]);
  state.tabs.push(tab);
  state.activeTabId = id;
  render();
  promptElement.focus();
}

state.tabs.push(createTab("main", "main", ["The pane is ready. This is a Pi-backed scripted stream.", "The main session keeps its own transcript."]));
state.tabs.push(createTab("review", "review", ["Review pane ready. It is isolated from main."]));
render();

get<HTMLFormElement>("terminal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const tab = activeTab();
  const input = promptElement.value.trim();
  if (!input || tab.session.isRunning) return;
  promptElement.value = "";
  tab.status = "working";
  tab.transcript.push({ id: makeId("input"), role: "input", text: input });
  render();
  await tab.session.prompt(input);
  render();
  promptElement.focus();
});

promptElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    get<HTMLFormElement>("terminal-form").requestSubmit();
  }
});

stopButton.addEventListener("click", () => activeTab().session.stop());
get<HTMLButtonElement>("add-tab").addEventListener("click", addTab);
get<HTMLButtonElement>("add-space").addEventListener("click", () => openSettings("Spaces are visual for now; session routing comes with the workspace store."));
get<HTMLButtonElement>("command-hint").addEventListener("click", () => openSettings());
get<HTMLButtonElement>("provider-toggle").addEventListener("click", () => openSettings());
get<HTMLButtonElement>("close-settings").addEventListener("click", closeSettings);
get<HTMLButtonElement>("clear-key").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.apiKey);
  } catch {
    // Private browsing may deny storage access; clearing the field still helps.
  }
  get<HTMLInputElement>("api-key").value = "";
  get<HTMLInputElement>("remember-key").checked = false;
  settingsStatus.textContent = "Saved API key cleared from this browser.";
});

function openSettings(message = ""): void {
  settingsDrawer.hidden = false;
  settingsDrawer.setAttribute("aria-hidden", "false");
  settingsStatus.textContent = message;
  get<HTMLInputElement>("api-key").focus();
}

function closeSettings(): void {
  settingsDrawer.hidden = true;
  settingsDrawer.setAttribute("aria-hidden", "true");
}

get<HTMLButtonElement>("use-scripted").addEventListener("click", () => {
  const tab = activeTab();
  if (tab.session.isRunning) return;
  tab.session.stop();
  attachSession(tab, scriptedSession(tab.id, ["Demo runtime is active again.", "This session continues independently."]));
  state.provider = "scripted";
  settingsStatus.textContent = "Using the deterministic scripted runtime.";
  render();
});

get<HTMLFormElement>("provider-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const tab = activeTab();
  if (tab.session.isRunning) {
    settingsStatus.textContent = "Stop the active run before changing providers.";
    return;
  }
  const form = event.currentTarget as HTMLFormElement;
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (submit) submit.disabled = true;
  persistProviderSettings();
  settingsStatus.textContent = "Creating Groq runtime…";
  try {
    const runtime = await createGroqRuntime({
      baseUrl: get<HTMLInputElement>("base-url").value,
      model: get<HTMLInputElement>("model").value,
      apiKey: get<HTMLInputElement>("api-key").value
    });
    attachSession(tab, new AgentSession({ sessionId: `groq-${tab.id}`, model: runtime.model, streamFn: runtime.streamFn }));
    state.provider = "groq";
    settingsStatus.textContent = "Groq runtime connected.";
    render();
    closeSettings();
  } catch (error) {
    settingsStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (submit) submit.disabled = false;
  }
});
