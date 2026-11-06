import { DEFAULT_AGENT_RULES } from "./core/workspace-bootstrap";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbFileSystem } from "./core/fs";
import { IndexedDbConversationStore, IndexedWorkspaceRecords } from "./core/conversations";

let requests: Array<{ messages: Array<{ role: string; content: string }> }>;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (_input, init: RequestInit) => {
    if (!init.body) return new Response("", { status: 404 });
    const body = JSON.parse(init.body as string);
    requests.push({ ...body, messages: body.messages.map((message: { role: string; content: unknown }) => ({ ...message, content: Array.isArray(message.content) ? message.content.map((block) => block.text ?? "").join("") : message.content })) });
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
}
async function enterAgent() {
  if (document.querySelector("#mode-toggle")!.getAttribute("aria-checked") !== "true") document.querySelector<HTMLButtonElement>("#mode-toggle")!.click();
  await vi.waitFor(() => expect(document.querySelector("#pane-type")!.textContent).toBe("AI agent"));
}
async function openPreviewFixture(path: string) {
  document.querySelector<HTMLInputElement>("#preview-entry")!.value = path;
  document.querySelector<HTMLFormElement>("#open-preview-form")!.requestSubmit();
  await vi.waitFor(() => expect(document.querySelector("#pane-type")!.textContent).toBe("頁面預覽"));
}
async function installDemo() {
  document.querySelector<HTMLButtonElement>("#install-demo")!.click();
  await vi.waitFor(() => expect(document.querySelector("#terminal")!.textContent).toContain("Joke demo:"));
}
async function resume(id: string) {
  document.querySelector<HTMLButtonElement>("#history-toggle")!.click();
  await vi.waitFor(() => expect(document.querySelector(`option[value="${id}"]`)).not.toBeNull());
  document.querySelector<HTMLSelectElement>("#conversation-list")!.value = id;
  document.querySelector<HTMLButtonElement>("#resume-conversation")!.click();
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#conversation-history")!.hidden).toBe(true));
  await vi.waitFor(() => expect(document.querySelector("#pane-type")!.textContent).toBe("AI agent"));
}
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

describe("UI history at the real provider request boundary", () => {
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

  it("defaults new tabs to AI and switches modes without replacing the conversation", async () => {
    await loadApp();
    const toggle = document.querySelector<HTMLButtonElement>("#mode-toggle")!;
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("#new-conversation")).toBeNull();
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
  it("resumes a saved identity from History and preserves preview path case", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/Mixed.html", "<h1>MiXeD Content</h1>");
    const initial = await saved();
    const store = new IndexedDbConversationStore(new IndexedWorkspaceRecords(window.indexedDB));
    await store.load(); const archived = structuredClone(initial!.tabs[0]); archived.session.sessionId = "History-MiXeD42";
    await store.remember(archived);
    await resume("History-MiXeD42");
    expect((await saved())!.tabs[0].session.sessionId).toBe("History-MiXeD42");
    await send("/SKILL OFF"); await send("/EXIT");
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
  it("preserves history across reload, reconnect, repeated Connect, close and resume", async () => {
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
    await resume(id);
    expect(document.querySelector("#provider-label")?.textContent).toBe("groq · live");
    await send("Recall the original code after reopening");
    expect(requests.at(-1)!.messages).toContainEqual(expect.objectContaining({ content: "Remember pineapple-42" }));
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
