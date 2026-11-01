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
  it("starts with default VFS rules and an empty skills folder, then discovers demo skills at home", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    expect(await fs.readFile("~/agents.md")).toMatchObject({ content: "請回覆繁體中文", revision: 1 });
    expect(await fs.listDirectory("~/skills")).toEqual([]);
    await connect(); await send("ai"); await send("Hello");
    expect(requests[0].messages[0].content).toContain("請回覆繁體中文");
    await send("/exit"); await send("demo jokes");
    expect((await fs.readFile("~/skills/joke-master/SKILL.md")).content).toContain("name: joke-master");
    await expect(fs.stat("~/.pi")).rejects.toMatchObject({ code: "not_found" });
    await expect(fs.stat("~/AGENTS.md")).rejects.toMatchObject({ code: "not_found" });
    await send("ai"); await send("Use joke-master");
    expect(requests.at(-1)!.messages[0].content).toContain("/home/user/skills/joke-master/SKILL.md");
    await loadApp();
    expect((await fs.readFile("~/agents.md")).revision).toBe(1);
  });

  it("documents the limited shell and starts/replaces conversations with ai", async () => {
    await loadApp();
    expect(document.querySelector(".shell-notice")!.textContent).toContain("簡易 bash");
    expect(document.querySelector(".shell-notice")!.textContent).toContain("read／cat、write、edit、grep、find、ls");
    expect(document.querySelector<HTMLTextAreaElement>("#prompt")!.placeholder).toContain("ai");
    await send("HeLp");
    expect(document.querySelector("#terminal")!.textContent).toContain("ai --resume ID");
    await send("AI");
    expect(document.querySelector("#pane-type")!.textContent).toBe("AI agent");
    await send("/ExIt");
    const before = (await saved())!.tabs[0].session.sessionId;
    await send("aI --NeW"); await send("/EXIT");
    expect((await saved())!.tabs[0].session.sessionId).not.toBe(before);
    expect(document.querySelector("#pane-type")!.textContent).toBe("簡易 bash");
  });
  it("accepts mixed-case UI commands while preserving entry paths and history identities", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/Mixed.html", "<h1>MiXeD Content</h1>");
    await send("EdIt Mixed.html");
    expect(document.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("<h1>MiXeD Content</h1>");
    document.querySelector<HTMLButtonElement>("#editor-cancel")!.click();
    await send("DeMo JoKeS");
    expect((await fs.readFile("~/agents.md")).content).toContain("繁體中文");
    const initial = await saved();
    const store = new IndexedDbConversationStore(new IndexedWorkspaceRecords(window.indexedDB));
    await store.load();
    const archived = structuredClone(initial!.tabs[0]);
    archived.session.sessionId = "History-MiXeD42";
    await store.remember(archived);
    await send("HiStOrY");
    expect(document.querySelector("#terminal")!.textContent).toContain("History-MiXeD42");
    await send("AI --ReSuMe History-MiXeD42");
    expect((await saved())!.tabs[0].session.sessionId).toBe("History-MiXeD42");
    await send("/SKILL OFF"); await send("/EXIT");
    await send("PrEvIeW Mixed.html");
    await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>(".preview-surface > iframe")?.srcdoc).toContain("MiXeD Content"));
  });
  it("restores the preview entry and popup surface without changing workspace conversations", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/main.html", "<h1>Preview entry</h1>");
    await send("preview main.html");
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
    await loadApp(); await connect(); await send("ai"); await send("Remember pineapple-42");
    expect(requests).toHaveLength(1);
    const initial = await saved();
    const id = initial!.tabs[0].session.sessionId;
    expect(JSON.stringify(initial)).not.toContain("fixture-secret");
    await loadApp();
    expect(document.querySelector("#provider-label")?.textContent).toContain("reconnect");
    await send("What did I ask you to remember?");
    expect(requests).toHaveLength(1);
    await connect(); await send("What did I ask you to remember?");
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: "Remember pineapple-42" }), expect.objectContaining({ role: "assistant", content: "好，已記住。" })]));
    await connect(); await send("Again, what was the code?");
    expect(requests[2].messages.filter((message) => message.content === "Remember pineapple-42")).toHaveLength(1);
    expect(requests[2].messages.some((message) => message.content === "ai")).toBe(false);
    await saved();
    document.querySelector<HTMLButtonElement>("#add-tab")!.click();
    document.querySelector<HTMLElement>('[aria-label="Close main"]')!.click();
    await vi.waitFor(() => expect(document.querySelectorAll("#tab-list .tab")).toHaveLength(1));
    await send(`ai --resume ${id}`);
    await connect(); await send("Recall the original code after reopening");
    expect(requests.at(-1)!.messages).toContainEqual(expect.objectContaining({ content: "Remember pineapple-42" }));
  });

  it("keeps providers per tab and refreshes file instructions without duplicating old rules", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/agents.md", "第一個規則：使用中文。");
    await connect(); await send("ai"); await send("Hello from A");
    expect(requests[0].messages[0].content).toContain("第一個規則");
    await fs.writeFile("~/agents.md", "第二個規則：使用繁體中文。");
    await send("Check new rules");
    expect(requests[1].messages[0].content).toContain("第二個規則");
    expect(requests[1].messages[0].content).not.toContain("第一個規則");
    document.querySelector<HTMLButtonElement>("#add-tab")!.click();
    expect(document.querySelector("#provider-label")?.textContent).toBe("groq · live");
    await send("ai"); await send("Hello only from B");
    expect(JSON.stringify(requests[2].messages)).not.toContain("Hello from A");
    expect(document.querySelector("#pane-model")?.textContent).toBe("openai/gpt-oss-120b");
  });

  it("retains editor drafts across reload and rejects concurrent file changes", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/code.ts", "original");
    await send("edit code.ts");
    const editor = document.querySelector<HTMLTextAreaElement>("#editor-content")!;
    editor.value = "unsaved edit"; editor.dispatchEvent(new Event("input", { bubbles: true }));
    await saved(); await loadApp();
    expect(document.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("unsaved edit");
    await fs.writeFile("~/code.ts", "other writer");
    document.querySelector<HTMLButtonElement>("#editor-save")!.click();
    await vi.waitFor(() => expect(document.querySelector("#editor-status")?.textContent).toContain("changed"));
    expect((await fs.readFile("~/code.ts")).content).toBe("other writer");
    expect(document.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("unsaved edit");
  });

  it("keeps a delayed editor save attached to its originating tab", async () => {
    await loadApp();
    const fs = new IndexedDbFileSystem(window.indexedDB);
    await fs.writeFile("~/a.md", "a"); await fs.writeFile("~/b.md", "b");
    await send("edit a.md");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = IndexedDbFileSystem.prototype.writeFile;
    const spy = vi.spyOn(IndexedDbFileSystem.prototype, "writeFile").mockImplementation(async function (this: IndexedDbFileSystem, path, content, options) {
      if (path.endsWith("/a.md")) await pending;
      return original.call(this, path, content, options);
    });
    try {
      document.querySelector<HTMLButtonElement>("#editor-save")!.click();
      expect(document.querySelector<HTMLButtonElement>("#editor-save")!.disabled).toBe(true);
      document.querySelector<HTMLButtonElement>("#add-tab")!.click();
      await send("edit b.md");
      expect(document.querySelector<HTMLButtonElement>("#editor-save")!.disabled).toBe(false);
      release(); await vi.waitFor(async () => expect((await fs.readFile("~/a.md")).revision).toBe(2));
      expect(document.querySelector("#editor-status")!.textContent).toBe("");
      expect(document.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("b");
      document.querySelector<HTMLElement>('#tab-list .tab')!.click();
      expect(document.querySelector("#editor-status")!.textContent).toContain("Saved");
    } finally { release(); spy.mockRestore(); }
  });
});
