import { FileSystemError, VFS_HOME, displayPath, resolvePath, type VirtualFileSystem } from "./core/fs";

export type EditorDraft = { path: string; revision: number; original: string; content: string };
export type EditorDraftStore = { load(): Promise<EditorDraft | undefined>; save(draft: EditorDraft | undefined): Promise<void> };

/** Human-only UTF-8 editor. Draft backups never write to the file being edited. */
export class FileEditor {
  readonly element = document.createElement("section");
  private readonly pathInput: HTMLInputElement;
  private readonly content: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly files: HTMLElement;
  private readonly directoryLabel: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  private document?: EditorDraft;
  private directory = VFS_HOME;
  private busy = false;
  private returnFocus: HTMLElement | null = null;
  private backup: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  constructor(private readonly fs: VirtualFileSystem, private readonly drafts?: EditorDraftStore) {
    this.element.className = "file-editor";
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");
    this.element.setAttribute("aria-labelledby", "editor-title");
    this.element.innerHTML = `
      <div class="human-tool-backdrop"></div>
      <div class="editor-panel">
        <header class="editor-header"><strong id="editor-title">Edit · 檔案編輯器</strong><button id="editor-close" class="drawer-close" type="button" aria-label="關閉編輯器">×</button></header>
        <form id="editor-open-form" class="editor-path-form"><label for="editor-path" class="sr-only">檔案路徑</label><input id="editor-path" value="~/main.html" autocomplete="off" spellcheck="false"><button type="submit" class="drawer-button">開啟／新增</button></form>
        <div class="editor-body">
          <nav class="editor-browser" aria-label="工作區檔案"><div class="editor-directory"><button id="editor-up" class="drawer-button" type="button" aria-label="上一層目錄">↑</button><span id="editor-directory"></span><button id="editor-refresh" class="drawer-button" type="button" aria-label="重新整理檔案">↻</button></div><div id="editor-file-list"></div></nav>
          <textarea id="editor-content" aria-label="檔案內容" spellcheck="false" autocapitalize="off" autocomplete="off" disabled></textarea>
        </div>
        <footer class="editor-footer"><span id="editor-status" role="status" aria-live="polite">選擇檔案開始編輯</span><button id="editor-reload" class="drawer-button muted-button" type="button">捨棄草稿並重新載入</button><button id="editor-save" class="drawer-button" type="button" disabled>儲存 ⌘S</button></footer>
      </div>`;
    const get = <T extends HTMLElement>(id: string) => this.element.querySelector<T>(`#${id}`)!;
    this.pathInput = get("editor-path"); this.content = get("editor-content"); this.status = get("editor-status");
    this.files = get("editor-file-list"); this.directoryLabel = get("editor-directory"); this.saveButton = get("editor-save");
    get("editor-close").addEventListener("click", () => this.close());
    this.element.querySelector(".human-tool-backdrop")!.addEventListener("click", () => this.close());
    get("editor-open-form").addEventListener("submit", event => { event.preventDefault(); void this.openFile(this.pathInput.value); });
    get("editor-up").addEventListener("click", () => void this.browse(resolvePath("..", this.directory)));
    get("editor-refresh").addEventListener("click", () => void this.browse(this.directory));
    get("editor-reload").addEventListener("click", () => { if (this.document) void this.openFile(this.document.path, true); });
    this.saveButton.addEventListener("click", () => void this.save());
    this.content.addEventListener("input", () => {
      if (!this.document) return;
      this.document.content = this.content.value; this.update(); this.persist();
    });
    this.element.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void this.save(); }
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      if (event.key === "Tab") {
        const controls = [...this.element.querySelectorAll<HTMLElement>("button,input,textarea")].filter(control => !control.hasAttribute("disabled"));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    this.ready = this.restore();
  }
  get path(): string | undefined { return this.document?.path; }
  private get dirty(): boolean { return !!this.document && this.document.content !== this.document.original; }
  private async restore(): Promise<void> {
    try {
      const draft = await this.drafts?.load();
      if (draft && typeof draft.path === "string" && draft.path.startsWith("/") && Number.isInteger(draft.revision) && draft.revision >= 0 && typeof draft.original === "string" && typeof draft.content === "string") {
        this.document = draft; this.pathInput.value = displayPath(draft.path); this.content.value = draft.content;
        this.directory = draft.path.slice(0, draft.path.lastIndexOf("/")) || "/"; this.update();
      }
    } catch { this.status.textContent = "無法還原編輯草稿，原檔未變更。"; }
  }
  async show(cwd = VFS_HOME): Promise<void> {
    this.returnFocus = document.activeElement as HTMLElement | null;
    await this.ready;
    this.element.hidden = false;
    if (!this.document) { this.directory = cwd; await this.openFile("~/main.html"); }
    else await this.browse(this.directory);
    this.content.focus();
  }
  close(): void { this.persist(); this.element.hidden = true; this.returnFocus?.focus(); }
  private persist(): void {
    const draft = this.document ? { ...this.document } : undefined;
    this.backup = this.backup.then(() => this.drafts?.save(draft)).then(() => {}, () => { this.status.textContent = "草稿備份失敗，請先儲存檔案再離開。"; });
  }
  private update(message?: string): void {
    this.content.disabled = !this.document || this.busy;
    this.saveButton.disabled = !this.document || this.busy || (!this.dirty && this.document.revision !== 0);
    this.status.textContent = message ?? (this.document ? `${displayPath(this.document.path)} · ${this.document.revision === 0 ? "新檔案，尚未儲存" : `revision ${this.document.revision}`} ${this.dirty ? "· 未儲存" : ""}` : "選擇檔案開始編輯");
  }
  private async browse(directory: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.update();
    try {
      const entries = await this.fs.listDirectory(directory);
      this.directory = directory; this.directoryLabel.textContent = displayPath(directory); this.files.replaceChildren();
      for (const entry of entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path))) {
        const button = document.createElement("button"); button.type = "button"; button.className = "editor-file";
        button.textContent = `${entry.kind === "directory" ? "▸ " : ""}${entry.path.split("/").at(-1)}`; button.title = displayPath(entry.path);
        button.addEventListener("click", () => entry.kind === "directory" ? void this.browse(entry.path) : void this.openFile(entry.path));
        this.files.append(button);
      }
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.content.disabled = !this.document; this.saveButton.disabled = !this.document || (!this.dirty && this.document.revision !== 0); }
  }
  async openFile(path: string, discard = false): Promise<void> {
    if (this.busy) return;
    if (this.dirty && !discard) { this.pathInput.value = displayPath(this.document!.path); this.update("有未儲存變更，請先儲存，或按「捨棄草稿並重新載入」。"); return; }
    this.busy = true; this.update("讀取中…");
    let loaded = false;
    try {
      let resolved = resolvePath(path, this.directory);
      let original = "", revision = 0;
      try { const file = await this.fs.readFile(resolved); original = file.content; revision = file.revision; resolved = file.path; }
      catch (error) { if (!(error instanceof FileSystemError) || error.code !== "not_found") throw error; }
      this.document = { path: resolved, revision, original, content: original };
      this.pathInput.value = displayPath(resolved); this.content.value = original; this.persist(); loaded = true;
    } catch (error) {
      if (this.document) this.pathInput.value = displayPath(this.document.path);
      this.update(error instanceof Error ? error.message : String(error));
    }
    finally { this.busy = false; if (loaded) this.update(); else { this.content.disabled = !this.document; this.saveButton.disabled = !this.document || (!this.dirty && this.document.revision !== 0); } }
    if (loaded && this.document) await this.browse(this.document.revision === 0 ? this.directory : this.document.path.slice(0, this.document.path.lastIndexOf("/")) || "/");
  }
  async save(): Promise<void> {
    if (!this.document || this.busy) return;
    this.busy = true; this.update("儲存中…");
    try {
      const draft = this.document;
      if (draft.revision === 0) await this.fs.mkdir(draft.path.slice(0, draft.path.lastIndexOf("/")) || "/", { recursive: true });
      const file = await this.fs.writeFile(draft.path, draft.content, { expectedRevision: draft.revision });
      this.document = { ...draft, path: file.path, revision: file.revision, original: draft.content };
      this.pathInput.value = displayPath(file.path); this.persist();
      this.busy = false; await this.browse(file.path.slice(0, file.path.lastIndexOf("/")) || "/"); this.update("已儲存 · " + displayPath(file.path));
    } catch (error) {
      this.busy = false;
      this.update(error instanceof FileSystemError && error.code === "conflict"
        ? "檔案已由 AI 或其他分頁更新，未覆寫。草稿已保留；請先複製草稿，再重新載入最新版本。"
        : error instanceof Error ? error.message : String(error));
    }
  }
}
