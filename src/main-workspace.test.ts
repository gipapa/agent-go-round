import { DEFAULT_AGENT_RULES } from "./core/workspace-bootstrap";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbFileSystem } from "./core/fs";
import { IndexedDbConversationStore, IndexedWorkspaceRecords } from "./core/conversations";

vi.mock("./core/bin-sandbox", async () => {
  const { runInNewContext } = await import("node:vm");
  const { FILE_METHODS } = await import("./core/file-capabilities");
  return { SandboxedBinExecutor: class {
    async execute(source: string, args: unknown, rpc: import("./core/bin-sandbox").FileRpc) {
      return structuredClone(await runInNewContext(`(${source})`, {}, { timeout: 1000 })(args, {
        fs: Object.fromEntries(FILE_METHODS.map(method => [method, (...values: unknown[]) => rpc(method, values)])),
        workspace: { home: () => rpc("home", []) },
        tools: { help: (command?: string) => rpc("commandHelp", [command]), reload: () => rpc("reloadTools", []) }
      }));
    }
  } };
});
let nextTool: { name: string; arguments: string } | undefined;
let requests: Array<{ messages: Array<{ role: string; content: string }> }>;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  requests = []; nextTool = undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input, init: RequestInit) => {
    if (!init.body) return new Response("", { status: 404 });
    const body = JSON.parse(init.body as string);
    requests.push({ ...body, messages: body.messages.map((message: { role: string; content: unknown }) => ({ ...message, content: Array.isArray(message.content) ? message.content.map((block) => block.text ?? "").join("") : message.content })) });
    if (nextTool) {
      const call = nextTool; nextTool = undefined;
      return new Response(`data: ${JSON.stringify({ id: "tool-fixture", model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `bin-call-${requests.length}`, type: "function", function: call }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    const chunks = [
      { choices: [{ index: 0, delta: { role: "assistant", content: "好，已記住。" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
    ].map((chunk) => `data: ${JSON.stringify({ id: "history-fixture", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", ...chunk })}\n\n`).join("");
    return new Response(chunks + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  }));
});
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

async function loadApp(): Promise<void> {
  vi.resetModules(); document.body.innerHTML = '<main id="app"></main>';
  await import("./main");
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#send")?.disabled).toBe(false));
}
async function send(text: string): Promise<void> {
  document.querySelector<HTMLTextAreaElement>("#prompt")!.value = text;
  document.querySelector<HTMLFormElement>("#terminal-form")!.requestSubmit();
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#send")?.disabled).toBe(false));
  await vi.waitFor(() => expect(document.querySelector("#tab-list .status-dot.working")).toBeNull());
}
async function enterAgent() {
  if (document.querySelector("#mode-toggle")!.getAttribute("aria-checked") !== "true") document.querySelector<HTMLButtonElement>("#mode-toggle")!.click();
  await vi.waitFor(() => expect(document.querySelector("#pane-type")!.textContent).toBe("AI agent"));
}
async function callTool(name: string, args: unknown = {}) {
  await enterAgent(); await connect();
  nextTool = { name, arguments: JSON.stringify(args) };
  await send(`Call ${name}`);

}
async function openPreviewFixture(path: string) {
  document.querySelector<HTMLButtonElement>("#human-preview")!.click();
  document.querySelector<HTMLInputElement>("#human-preview-path")!.value = path;
  document.querySelector<HTMLFormElement>("#human-preview-form")!.requestSubmit();
  await vi.waitFor(() => expect(document.querySelector("#pane-type")!.textContent).toBe("頁面預覽"));
}
async function installDemo() { await callTool("install_joke_demo"); }
async function connect(): Promise<void> {
  document.querySelector<HTMLButtonElement>("#provider-toggle")!.click();
  document.querySelector<HTMLInputElement>("#api-key")!.value = "fixture-secret-never-in-snapshot";
  document.querySelector<HTMLFormElement>("#provider-form")!.requestSubmit();
  await vi.waitFor(() => expect(document.querySelector("#provider-label")?.textContent).toBe("groq · live"));
}
async function saved() {
  await new Promise((resolve) => setTimeout(resolve, 260));
  return new IndexedDbConversationStore(new IndexedWorkspaceRecords(window.indexedDB)).load();
}

describe("Tab sessions at the real provider request boundary", () => {
  it("shows native model events while waiting and streaming, then clears them when finished", async () => {
    let respond!: (response: Response) => void;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => encoder.encode(`data: ${JSON.stringify({ id: "status-fixture", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => init?.body
      ? new Promise<Response>(resolve => { respond = resolve; }) : Promise.resolve(new Response("", { status: 404 }))));
    await loadApp(); await connect(); await enterAgent();
    document.querySelector<HTMLTextAreaElement>("#prompt")!.value = "Show native status";
    document.querySelector<HTMLFormElement>("#terminal-form")!.requestSubmit();
    await vi.waitFor(() => expect(respond).toBeTypeOf("function"));
    expect(document.querySelector("#footer-run-status")!.textContent).toBe("working");
    expect(document.querySelector("#pi-status")!.textContent).toBe("Pi · message_end · user");
    expect(document.querySelector(".terminal-form-actions")!.firstElementChild?.id).toBe("execution-status");
    expect(document.querySelector("#execution-status")!.nextElementSibling?.id).toBe("run-status");
    respond(new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { "Content-Type": "text/event-stream" } }));
    controller.enqueue(chunk({ role: "assistant", content: "正在回覆" }));
    await vi.waitFor(() => expect(document.querySelector("#pi-status")!.textContent).toBe("Pi · text_delta"));
    expect(document.querySelector("#run-status")!.textContent).toBe("working");
    controller.enqueue(chunk({}, "stop"));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
    await vi.waitFor(() => expect(document.querySelector("#footer-run-status")!.textContent).toBe("done"));
    expect(document.querySelector("#run-status")!.textContent).toBe("done");
    expect(document.querySelector<HTMLElement>("#execution-status")!.hidden).toBe(true);
    expect(document.querySelector("#pi-status")!.textContent).toBe("");
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#send")!.disabled).toBe(false));
  });

  it("initializes files, saves history and opens previews without crypto.randomUUID", async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    expect((await fs.readFile("~/agents.md")).content).toBe(DEFAULT_AGENT_RULES);
    expect(document.querySelector("#workspace-status")!.textContent).not.toContain("failed");
    await fs.writeFile("~/main.html", "<h1>Embedded files</h1>");
    await openPreviewFixture("main.html");
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>(".preview-surface > iframe")?.srcdoc).toContain("Embedded files"));
    const before = await saved();
    expect(before!.tabs.find(tab => tab.mode === "preview")!.preview!.surfaceId).toMatch(/^popup-/);
    await loadApp();
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>(".preview-surface > iframe")?.srcdoc).toContain("Embedded files"));
  });

  it("starts with default VFS rules and an empty skills folder, then discovers demo skills at home", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    expect(await fs.readFile("~/agents.md")).toMatchObject({ content: DEFAULT_AGENT_RULES, revision: 1 });
    expect(await fs.listDirectory("~/skills")).toEqual([]);
    await connect(); await enterAgent(); await send("Hello");
    expect(requests[0].messages[0].content).toContain("請回覆繁體中文");
    await send("/exit"); await installDemo();
    expect((await fs.readFile("~/skills/joke-master/SKILL.md")).content).toContain("name: joke-master");
    await expect(fs.stat("~/.pi")).rejects.toMatchObject({ code: "not_found" });
    await expect(fs.stat("~/AGENTS.md")).rejects.toMatchObject({ code: "not_found" });
    await enterAgent(); await send("Use joke-master");
    expect(requests.at(-1)!.messages[0].content).toContain("/home/user/skills/joke-master/SKILL.md");
    await loadApp();
    expect((await fs.readFile("~/agents.md")).revision).toBe(1);
  });

  it("opens human tools above settings without model calls and restores an unsaved editor draft", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/main.html", "Original");
    const footer = document.querySelector(".sidebar-footer")!;
    expect([...footer.querySelectorAll("button")].map(button => button.id)).toEqual(["human-preview", "human-edit", "sidebar-provider-toggle"]);
    document.querySelector<HTMLButtonElement>("#human-edit")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("Original"));
    const content = document.querySelector<HTMLTextAreaElement>("#editor-content")!;
    content.value = "Saved by human"; content.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#editor-save")!.click();
    await vi.waitFor(async () => expect((await fs.readFile("~/main.html")).content).toBe("Saved by human"));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#editor-save")!.disabled).toBe(true));
    content.value = "Unsaved draft"; content.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#editor-close")!.click();
    await vi.waitFor(async () => expect(await new IndexedWorkspaceRecords(window.indexedDB).transaction(false, tx => tx.get<{content:string}>("human-editor:workspace"))).toMatchObject({ content: "Unsaved draft" }));
    await loadApp(); document.querySelector<HTMLButtonElement>("#human-edit")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("Unsaved draft"));
    expect((await fs.readFile("~/main.html")).content).toBe("Saved by human");
    expect(requests).toHaveLength(0);
  });

  it("moves between Preview and Edit on the same file and marks an unsaved draft on the Edit button", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/main.html", "<h1>Original</h1>");
    await fs.mkdir("~/docs", { recursive: true });
    await fs.writeFile("~/docs/other.html", "<h1>Other</h1>");
    const frame = () => document.querySelector<HTMLIFrameElement>(".preview-surface:not([hidden]) > iframe")!;
    const editButton = document.querySelector<HTMLButtonElement>("#human-edit")!;

    document.querySelector<HTMLButtonElement>("#human-preview")!.click();
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".human-preview-option")];
    await vi.waitFor(() => expect(rows().map(row => row.title).sort()).toEqual(["~/docs/other.html", "~/main.html"]));
    rows().find(row => row.title === "~/main.html")!.click();
    await vi.waitFor(() => expect(frame()?.srcdoc).toContain("Original"));
    expect(document.querySelector("#human-preview-dialog")!.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".pane")!.classList.contains("previewing")).toBe(true);

    [...document.querySelectorAll<HTMLButtonElement>(".preview-surface:not([hidden]) .preview-toolbar button")].find(button => button.textContent === "編輯")!.click();
    const content = document.querySelector<HTMLTextAreaElement>("#editor-content")!;
    await vi.waitFor(() => expect(content.value).toBe("<h1>Original</h1>"));
    expect(document.querySelector(".file-editor")!.hasAttribute("hidden")).toBe(false);

    content.value = "<h1>Saved from editor</h1>"; content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editButton.classList.contains("has-draft")).toBe(true);
    expect(editButton.getAttribute("aria-label")).toContain("未儲存草稿");

    document.querySelector<HTMLButtonElement>("#editor-preview")!.click();
    await vi.waitFor(() => expect(frame()?.srcdoc).toContain("Saved from editor"));
    expect(document.querySelector(".file-editor")!.hasAttribute("hidden")).toBe(true);
    expect((await fs.readFile("~/main.html")).content).toBe("<h1>Saved from editor</h1>");
    expect(editButton.classList.contains("has-draft")).toBe(false);
    expect(document.querySelectorAll(".preview-surface")).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it("marks a draft restored from the last visit before the editor is opened", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/main.html", "Original");
    document.querySelector<HTMLButtonElement>("#human-edit")!.click();
    const content = document.querySelector<HTMLTextAreaElement>("#editor-content")!;
    await vi.waitFor(() => expect(content.value).toBe("Original"));
    content.value = "Unsaved"; content.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#editor-close")!.click();
    await vi.waitFor(async () => expect(await new IndexedWorkspaceRecords(window.indexedDB).transaction(false, tx => tx.get<{content:string}>("human-editor:workspace"))).toMatchObject({ content: "Unsaved" }));
    await loadApp();
    await vi.waitFor(() => expect(document.querySelector("#human-edit")!.classList.contains("has-draft")).toBe(true));
  });

  it("defaults new tabs to AI and switches modes without replacing the conversation", async () => {
    await loadApp();
    const toggle = document.querySelector<HTMLButtonElement>("#mode-toggle")!;
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    for (const selector of ["#new-conversation", "#history-toggle", "#conversation-history", ".workspace-menu", "#route-tab", "#route-dialog", ".pane-tools"]) expect(document.querySelector(selector)).toBeNull();
    expect(document.querySelector(".pane-header-actions > #mode-toggle")).toBe(toggle);
    const before = (await saved())!.tabs[0].session.sessionId;
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(document.querySelector(".shell-notice")!.textContent).toContain("僅保存 cwd");
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect((await saved())!.tabs[0].session.sessionId).toBe(before);
    document.querySelector<HTMLButtonElement>("#add-tab")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll("#tab-list .tab")).toHaveLength(2));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    const tabs = (await saved())!.tabs;
    expect(tabs[1].mode).toBe("agent");
    expect(tabs[1].session.sessionId).not.toBe(before);
    await send("/EXIT");
    expect(document.querySelector("#pane-type")!.textContent).toBe("just-bash");
  });
  it("preserves preview path case when opening with the human button", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/Mixed.html", "<h1>MiXeD Content</h1>");
    await openPreviewFixture("Mixed.html");
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>(".preview-surface > iframe")?.srcdoc).toContain("MiXeD Content"));
  });
  it("restores the preview entry and popup surface without changing workspace conversations", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/main.html", "<h1>Preview entry</h1>");
    await openPreviewFixture("main.html");
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>(".preview-surface > iframe")?.srcdoc).toContain("Preview entry"));
    const before = await saved();
    const preview = before!.tabs.find(tab => tab.mode === "preview")!.preview!;
    await loadApp();
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>(".preview-surface > iframe")?.srcdoc).toContain("Preview entry"));
    const popup = document.querySelector(".preview-surface > div:last-child")!.shadowRoot!.querySelector("iframe")!;
    expect(new URL(popup.src).searchParams.get("surface")).toBe(preview.surfaceId);
    expect((await saved())!.tabs.find(tab => tab.mode === "preview")!.preview).toEqual(preview);
  });
  it("preserves the tab session across reload and reconnect, and gives a new tab its own session", async () => {
    await loadApp(); await connect(); await enterAgent(); await send("Remember pineapple-42");
    expect(requests).toHaveLength(1);
    const initial = await saved();
    const id = initial!.tabs[0].session.sessionId;
    expect(JSON.stringify(initial)).not.toContain("fixture-secret");
    await loadApp();
    expect(document.querySelector("#provider-label")?.textContent).toBe("groq · live");
    expect(requests).toHaveLength(1);
    await send("What did I ask you to remember?");
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: "Remember pineapple-42" }), expect.objectContaining({ role: "assistant", content: "好，已記住。" })]));
    await connect(); await send("Again, what was the code?");
    expect(requests[2].messages.filter((message) => message.content === "Remember pineapple-42")).toHaveLength(1);
    expect(requests[2].messages.some((message) => message.content === "ai")).toBe(false);
    await saved();
    document.querySelector<HTMLButtonElement>("#add-tab")!.click();
    document.querySelector<HTMLElement>('[aria-label="Close main"]')!.click();
    await vi.waitFor(() => expect(document.querySelectorAll("#tab-list .tab")).toHaveLength(1));
    const remaining = (await saved())!.tabs[0];
    expect(remaining.session.sessionId).not.toBe(id);
    await send("A new task after closing the original tab");
    expect(requests.at(-1)!.messages.some(message => message.content === "Remember pineapple-42")).toBe(false);
    await loadApp();
    expect((await saved())!.tabs).toHaveLength(1);
    expect((await saved())!.tabs[0].session.sessionId).toBe(remaining.session.sessionId);
  });

  it("keeps providers per tab and refreshes file instructions without duplicating old rules", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/agents.md", "第一個規則：使用中文。");
    await connect(); await enterAgent(); await send("Hello from A");
    expect(requests[0].messages[0].content).toContain("第一個規則");
    await fs.writeFile("~/agents.md", "第二個規則：使用繁體中文。");
    await send("Check new rules");
    expect(requests[1].messages[0].content).toContain("第二個規則");
    expect(requests[1].messages[0].content).not.toContain("第一個規則");
    document.querySelector<HTMLButtonElement>("#add-tab")!.click();
    expect(document.querySelector("#provider-label")?.textContent).toBe("groq · live");
    await enterAgent(); await send("Hello only from B");
    expect(JSON.stringify(requests[2].messages)).not.toContain("Hello from A");
    expect(document.querySelector("#pane-model")?.textContent).toBe("openai/gpt-oss-120b");
  });

  it("selects models from /models and saves their actual context length across reload", async () => {
    const transport = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => String(input).endsWith("/models")
      ? Response.json({ data: [{ id: "catalog-model", context_window: 32768 }, { id: "unknown-limit" }] })
      : transport(input, init));
    await loadApp();
    document.querySelector<HTMLInputElement>("#api-key")!.value = "fixture-secret";
    document.querySelector<HTMLButtonElement>("#provider-toggle")!.click();
    await vi.waitFor(() => expect(document.querySelector("#models-status")!.textContent).toContain("Models loaded"));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#model-select-label")!.hidden).toBe(false));
    const select = document.querySelector<HTMLSelectElement>("#model-select")!;
    select.value = "catalog-model"; select.dispatchEvent(new Event("change"));
    expect(document.querySelector<HTMLInputElement>("#context-window")!.value).toBe("32768");
    document.querySelector<HTMLFormElement>("#provider-form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector("#provider-label")!.textContent).toBe("groq · live"));
    await enterAgent(); await send("Catalog model request");
    const before = (await saved())!.tabs[0].session;
    expect(before.model).toMatchObject({ id: "catalog-model", contextWindow: 32768 });
    await loadApp();
    expect(document.querySelector("#provider-label")!.textContent).toBe("groq · live");
    expect(document.querySelector<HTMLInputElement>("#context-window")!.value).toBe("32768");
    expect((await saved())!.tabs[0].session).toMatchObject({ sessionId: before.sessionId, model: { id: "catalog-model", contextWindow: 32768 } });
    expect(requests).toHaveLength(1); // Runtime recovery never resends a prompt.
    document.querySelector<HTMLButtonElement>("#provider-toggle")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#model-select-label")!.hidden).toBe(false));
    const restoredSelect = document.querySelector<HTMLSelectElement>("#model-select")!;
    restoredSelect.value = "unknown-limit"; restoredSelect.dispatchEvent(new Event("change"));
    expect(document.querySelector<HTMLInputElement>("#context-window")!.value).toBe("");
    document.querySelector<HTMLInputElement>("#context-window")!.value = "16384";
    document.querySelector<HTMLFormElement>("#provider-form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#settings-drawer")!.hidden).toBe(true));
    expect((await saved())!.tabs[0].session.model).toMatchObject({ id: "unknown-limit", contextWindow: 16384 });
  });

  it("allows manual models when /models is unavailable", async () => {
    await loadApp();
    document.querySelector<HTMLButtonElement>("#provider-toggle")!.click();
    document.querySelector<HTMLInputElement>("#api-key")!.value = "fixture-secret";
    document.querySelector<HTMLButtonElement>("#refresh-models")!.click();
    await vi.waitFor(() => expect(document.querySelector("#models-status")!.textContent).toContain("Enter the model ID and context length manually"));
    const model = document.querySelector<HTMLInputElement>("#model")!;
    model.value = "custom-model"; model.dispatchEvent(new Event("input"));
    expect(document.querySelector<HTMLInputElement>("#context-window")!.value).toBe("");
    document.querySelector<HTMLInputElement>("#context-window")!.value = "65536";
    document.querySelector<HTMLFormElement>("#provider-form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector("#provider-label")!.textContent).toBe("groq · live"));
    expect((await saved())!.tabs[0].session.model).toMatchObject({ id: "custom-model", contextWindow: 65536 });
  });

  it("reconnects restored tabs together without replacing their individual models", async () => {
    await loadApp();
    document.querySelector<HTMLInputElement>("#remember-key")!.checked = false;
    await connect();
    document.querySelector<HTMLButtonElement>("#add-tab")!.click();
    document.querySelector<HTMLInputElement>("#model")!.value = "second-model";
    document.querySelector<HTMLInputElement>("#context-window")!.value = "8192";
    await connect();
    const original = (await saved())!.tabs.map(tab => tab.session.model);
    await loadApp();
    expect(document.querySelector("#provider-label")!.textContent).toBe("groq · reconnect");
    await connect();
    const restored = (await saved())!;
    expect(restored.tabs.map(tab => tab.session.model)).toEqual(original);
    document.querySelector<HTMLButtonElement>("#tab-list .tab")!.click();
    expect(document.querySelector("#provider-label")!.textContent).toBe("groq · live");
    expect(requests).toHaveLength(0);
    await loadApp();
    expect(document.querySelector("#provider-label")!.textContent).toBe("groq · live");
    expect((await saved())!.tabs.map(tab => tab.session.model)).toEqual(original);
  });

});
