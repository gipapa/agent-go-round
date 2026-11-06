import { FileSystemError, VFS_HOME, displayPath, isHomePath, resolvePath, type VirtualFileSystem } from "./core/fs";
import { isComposing, isTouchLayout, toolButton, trapTabKey } from "./human-tool-ui";

export type EditorDraft = { path: string; revision: number; original: string; content: string };
export type EditorDraftStore = { load(): Promise<EditorDraft | undefined>; save(draft: EditorDraft | undefined): Promise<void> };
export type FileEditorOptions = {
  /** Opens the saved page. Throwing keeps the editor open and shows the reason. */
  onPreview?: (path: string) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};
type Tone = "info" | "success" | "warning" | "error";
type BannerAction = { id: string; label: string; tone?: "primary" | "danger"; run: () => unknown };

const INDENT = "  ";
const HTML_FILE = /\.html?$/i;
const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf("/")) || "/";
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Human-only UTF-8 editor. Draft backups never write to the file being edited. */
export class FileEditor {
  readonly element = document.createElement("section");
  private readonly panel: HTMLElement;
  private readonly pathInput: HTMLInputElement;
  private readonly content: HTMLTextAreaElement;
  private readonly gutterLines: HTMLElement;
  private readonly status: HTMLElement;
  private readonly position: HTMLElement;
  private readonly files: HTMLElement;
  private readonly directoryLabel: HTMLElement;
  private readonly current: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly bannerActions: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly previewButton: HTMLButtonElement;
  private readonly wrapButton: HTMLButtonElement;
  private readonly filesButton: HTMLButtonElement;
  private readonly upButton: HTMLButtonElement;
  private document?: EditorDraft;
  private directory = VFS_HOME;
  private busy = false;
  private notice?: { text: string; tone: Tone };
  private bannerDismissible = false;
  private conflictRevision?: number;
  private watcher?: ReturnType<typeof setInterval>;
  private lineCount = 0;
  private reportedDirty = false;
  private returnFocus: HTMLElement | null = null;
  private backup: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  constructor(private readonly fs: VirtualFileSystem, private readonly drafts?: EditorDraftStore, private readonly options: FileEditorOptions = {}) {
    this.element.className = "file-editor";
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");
    this.element.setAttribute("aria-labelledby", "editor-title");
    const saveHint = isTouchLayout() ? "" : /Mac|iPhone|iPad/.test(navigator.platform) ? " ⌘S" : " Ctrl+S";
    this.element.innerHTML = `
      <div class="human-tool-backdrop"></div>
      <div class="editor-panel" tabindex="-1">
        <header class="editor-header">
          <button id="editor-toggle-files" class="tool-button icon" type="button" aria-controls="editor-browser" aria-expanded="true" aria-label="檔案清單" title="顯示或隱藏檔案清單">☰</button>
          <div class="editor-heading"><strong id="editor-title">編輯檔案</strong><span id="editor-current" class="editor-current">尚未開啟檔案</span><span id="editor-badge" class="editor-badge" hidden></span></div>
          <button id="editor-preview" class="tool-button" data-icon="▣" type="button" hidden><span class="tool-label">預覽</span></button>
          <button id="editor-close" class="drawer-close" type="button" aria-label="關閉編輯器">×</button>
        </header>
        <div class="editor-body">
          <nav id="editor-browser" class="editor-browser" aria-label="工作區檔案">
            <div class="editor-directory"><button id="editor-up" class="tool-button icon ghost" type="button" aria-label="上一層目錄" title="上一層目錄">↑</button><div id="editor-directory" class="editor-breadcrumbs"></div><button id="editor-refresh" class="tool-button icon ghost" type="button" aria-label="重新整理檔案" title="重新整理檔案">↻</button></div>
            <form id="editor-open-form" class="editor-path-form"><label for="editor-path" class="sr-only">開啟或新增檔案路徑</label><input id="editor-path" placeholder="開啟或新增：notes/todo.md" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit" class="tool-button">開啟</button></form>
            <div id="editor-file-list" class="editor-file-list"></div>
          </nav>
          <div class="editor-main">
            <div id="editor-banner" class="editor-banner" role="alert" hidden><p id="editor-banner-text"></p><div id="editor-banner-actions" class="editor-banner-actions"></div></div>
            <div class="editor-surface">
              <div class="editor-gutter" aria-hidden="true"><div id="editor-gutter-lines"></div></div>
              <textarea id="editor-content" aria-label="檔案內容" aria-describedby="editor-keys" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" disabled></textarea>
              <span id="editor-keys" class="sr-only">Tab 插入縮排，Shift+Tab 減少縮排，F6 移到下方按鈕，Esc 關閉編輯器。</span>
            </div>
          </div>
        </div>
        <footer class="editor-footer">
          <span id="editor-status" role="status" aria-live="polite">選擇檔案開始編輯</span>
          <span id="editor-position" class="editor-position"></span>
          <div class="editor-actions"><button id="editor-wrap" class="tool-button ghost" type="button" aria-pressed="false">自動換行</button><button id="editor-reload" class="tool-button ghost" type="button" disabled>捨棄變更</button><button id="editor-save" class="tool-button primary" type="button" disabled>儲存${saveHint}</button></div>
        </footer>
      </div>`;
    const get = <T extends HTMLElement>(id: string) => this.element.querySelector<T>(`#${id}`)!;
    this.panel = this.element.querySelector(".editor-panel")!;
    this.pathInput = get("editor-path"); this.content = get("editor-content"); this.gutterLines = get("editor-gutter-lines");
    this.status = get("editor-status"); this.position = get("editor-position"); this.files = get("editor-file-list"); this.directoryLabel = get("editor-directory");
    this.current = get("editor-current"); this.badge = get("editor-badge"); this.banner = get("editor-banner"); this.bannerText = get("editor-banner-text"); this.bannerActions = get("editor-banner-actions");
    this.saveButton = get("editor-save"); this.reloadButton = get("editor-reload"); this.previewButton = get("editor-preview"); this.wrapButton = get("editor-wrap"); this.filesButton = get("editor-toggle-files"); this.upButton = get("editor-up");
    get("editor-close").addEventListener("click", () => this.close());
    this.element.querySelector(".human-tool-backdrop")!.addEventListener("click", () => this.close());
    this.filesButton.addEventListener("click", () => this.setFilesOpen(this.panel.classList.contains("files-collapsed")));
    get("editor-open-form").addEventListener("submit", event => { event.preventDefault(); void this.openTypedPath(); });
    this.upButton.addEventListener("click", () => void this.browse(resolvePath("..", this.directory)));
    get("editor-refresh").addEventListener("click", () => void this.browse(this.directory));
    this.reloadButton.addEventListener("click", () => this.confirmDiscard());
    this.saveButton.addEventListener("click", () => void this.save());
    this.previewButton.addEventListener("click", () => void this.previewCurrent());
    this.wrapButton.addEventListener("click", () => this.setWrap(this.wrapButton.getAttribute("aria-pressed") !== "true"));
    this.content.addEventListener("input", () => {
      if (!this.document) return;
      this.document.content = this.content.value; this.notice = undefined;
      this.sync(); this.renderLines(); this.renderPosition(); this.persist();
    });
    this.content.addEventListener("scroll", () => { this.gutterLines.style.transform = `translateY(${-this.content.scrollTop}px)`; });
    for (const type of ["click", "keyup", "select"]) this.content.addEventListener(type, () => this.renderPosition());
    this.content.addEventListener("keydown", event => this.handleEditingKey(event));
    this.element.addEventListener("keydown", event => this.handleKey(event));
    this.setWrap(isTouchLayout());
    this.ready = this.restore();
  }
  get path(): string | undefined { return this.document?.path; }
  private get dirty(): boolean { return !!this.document && this.document.content !== this.document.original; }
  private async restore(): Promise<void> {
    try {
      const draft = await this.drafts?.load();
      if (draft && typeof draft.path === "string" && draft.path.startsWith("/") && Number.isInteger(draft.revision) && draft.revision >= 0 && typeof draft.original === "string" && typeof draft.content === "string") {
        this.document = draft; this.content.value = draft.content;
        this.directory = directoryOf(draft.path); this.sync(); this.renderLines(); this.renderPosition();
      }
    } catch { this.sync("無法還原編輯草稿，原檔未變更。", "error"); }
  }
  async show(cwd = VFS_HOME, path?: string): Promise<void> {
    if (this.element.hidden) this.returnFocus = document.activeElement as HTMLElement | null;
    await this.ready;
    this.element.hidden = false;
    this.setFilesOpen(!isTouchLayout());
    if (path) await this.openFile(path);
    else if (!this.document) { this.directory = cwd; await this.openFile("~/main.html"); }
    else await this.browse(this.directory);
    if (this.element.hidden) return;
    this.watcher ??= setInterval(() => void this.checkExternalChange(), 2000);
    await this.checkExternalChange();
    if (this.banner.hidden) this.focusEditor();
  }
  close(): void {
    if (this.element.hidden) return;
    this.persist(); this.stopWatching();
    this.element.hidden = true; this.returnFocus?.focus();
  }
  /** Opening the keyboard hides most of a phone screen, so touch layouts only focus the panel. */
  private focusEditor(): void { if (isTouchLayout() || this.content.disabled) this.panel.focus(); else this.content.focus(); }
  private stopWatching(): void { clearInterval(this.watcher); this.watcher = undefined; }
  private persist(): void {
    const draft = this.document ? { ...this.document } : undefined;
    this.backup = this.backup.then(() => this.drafts?.save(draft)).then(() => {}, () => { this.sync("草稿備份失敗，請先儲存檔案再離開。", "error"); });
  }
  private setFilesOpen(open: boolean): void {
    this.panel.classList.toggle("files-collapsed", !open);
    this.filesButton.setAttribute("aria-expanded", String(open));
  }
  private setWrap(wrap: boolean): void {
    this.panel.classList.toggle("wrapped", wrap);
    this.content.wrap = wrap ? "soft" : "off";
    this.wrapButton.setAttribute("aria-pressed", String(wrap));
  }
  private sync(text?: string, tone: Tone = "info"): void {
    if (text !== undefined) this.notice = { text, tone };
    const doc = this.document, dirty = this.dirty, isNew = doc?.revision === 0;
    // Disabling would drop focus on every save, so a busy textarea only turns read-only.
    this.content.disabled = !doc;
    this.content.readOnly = this.busy;
    this.content.placeholder = isNew ? "輸入內容後按儲存，檔案才會建立" : "";
    this.saveButton.disabled = !doc || this.busy || (!dirty && !isNew);
    this.reloadButton.disabled = !doc || this.busy || !dirty;
    this.current.textContent = doc ? displayPath(doc.path) : "尚未開啟檔案";
    this.current.title = this.current.textContent;
    this.badge.hidden = !dirty && !isNew;
    this.badge.textContent = dirty ? "未儲存" : "新檔案";
    this.badge.dataset.tone = dirty ? "warning" : "info";
    this.previewButton.hidden = !doc || !this.options.onPreview || !HTML_FILE.test(doc.path) || !isHomePath(doc.path);
    this.previewButton.disabled = this.busy;
    this.previewButton.querySelector(".tool-label")!.textContent = dirty || isNew ? "儲存並預覽" : "預覽";
    this.upButton.disabled = this.directory === VFS_HOME || this.directory === "/";
    for (const row of this.files.querySelectorAll<HTMLElement>(".editor-file")) {
      if (row.dataset.path === doc?.path) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
      row.classList.toggle("dirty", dirty && row.dataset.path === doc?.path);
    }
    this.status.dataset.tone = this.notice?.tone ?? "info";
    this.status.textContent = this.notice?.text ?? (!doc ? "選擇檔案開始編輯" : isNew ? "新檔案，儲存後才會建立" : `revision ${doc.revision}${dirty ? " · 未儲存" : ""}`);
    if (dirty !== this.reportedDirty) { this.reportedDirty = dirty; this.options.onDirtyChange?.(dirty); }
  }
  private renderLines(): void {
    const value = this.content.value;
    let lines = 1;
    for (let index = value.indexOf("\n"); index !== -1; index = value.indexOf("\n", index + 1)) lines++;
    if (lines !== this.lineCount) {
      this.lineCount = lines;
      this.gutterLines.textContent = Array.from({ length: lines }, (_, index) => index + 1).join("\n");
      this.panel.style.setProperty("--editor-gutter-digits", String(String(lines).length));
    }
    this.gutterLines.style.transform = `translateY(${-this.content.scrollTop}px)`;
  }
  private renderPosition(): void {
    if (!this.document) { this.position.textContent = ""; return; }
    const before = this.content.value.slice(0, this.content.selectionStart);
    const line = before.split("\n").length, column = before.length - before.lastIndexOf("\n");
    this.position.textContent = `行 ${line}，欄 ${column}`;
  }
  private showBanner(tone: Tone, text: string, actions: BannerAction[], { dismissible = false, focus = true } = {}): void {
    const hadFocus = this.banner.contains(document.activeElement);
    this.bannerDismissible = dismissible;
    this.banner.dataset.tone = tone;
    this.bannerText.textContent = text;
    this.bannerActions.replaceChildren(...actions.map(action => {
      const button = toolButton(action.label, { tone: action.tone });
      button.dataset.action = action.id;
      button.addEventListener("click", () => void action.run());
      return button;
    }));
    this.banner.hidden = false;
    if (focus || hadFocus) (this.bannerActions.firstElementChild as HTMLElement | null)?.focus();
  }
  private hideBanner(returnFocus = false): void {
    this.banner.hidden = true; this.bannerActions.replaceChildren(); this.bannerDismissible = false;
    if (returnFocus) this.focusEditor();
  }
  private confirmDiscard(): void {
    if (!this.document || !this.dirty) return;
    const path = this.document.path;
    this.showBanner("warning", `捨棄未儲存的變更，並重新載入 ${displayPath(path)}？這個動作無法復原。`, [
      { id: "cancel", label: "取消", run: () => this.hideBanner(true) },
      { id: "discard", label: "捨棄變更", tone: "danger", run: () => this.openFile(path, true) }
    ], { dismissible: true });
  }
  /** Takes an absolute target: saving moves the browsed folder, which would re-aim a relative path. */
  private promptUnsaved(target: string): void {
    this.showBanner("warning", `${displayPath(this.document!.path)} 有未儲存的變更，要怎麼處理後再開啟 ${displayPath(target)}？`, [
      { id: "save", label: "儲存後開啟", tone: "primary", run: async () => { if (await this.save()) await this.openFile(target); } },
      { id: "discard", label: "捨棄變更並開啟", tone: "danger", run: () => this.openFile(target, true) },
      { id: "cancel", label: "留在目前檔案", run: () => this.hideBanner(true) }
    ], { dismissible: true });
  }
  private showConflict(focus: boolean): void {
    const path = this.document!.path;
    this.sync("未覆寫 · 草稿已保留", "warning");
    this.showBanner("warning", "這個檔案已被 AI 或其他分頁更新，你的草稿沒有覆寫它，也還保留在這裡。可以先複製草稿，再載入最新版本。", [
      { id: "copy", label: "複製草稿", run: () => this.copyDraft() },
      { id: "latest", label: "載入最新版本（捨棄草稿）", tone: "danger", run: () => this.openFile(path, true) }
    ], { focus });
  }
  private async copyDraft(): Promise<void> {
    try { await navigator.clipboard.writeText(this.content.value); this.sync("草稿已複製到剪貼簿。", "success"); }
    catch { this.content.focus(); this.content.select(); this.sync("無法自動複製，已選取全部內容，請手動複製。", "warning"); }
  }
  private handleKey(event: KeyboardEvent): void {
    if (isComposing(event)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void this.save(); }
    else if (event.key === "Escape") {
      event.preventDefault();
      if (this.bannerDismissible) this.hideBanner(true); else this.close();
    }
    else if (event.key === "F6" && event.target === this.content) { event.preventDefault(); this.wrapButton.focus(); }
    else if (event.key === "Tab" && event.target !== this.content) trapTabKey(event, this.panel);
  }
  private handleEditingKey(event: KeyboardEvent): void {
    if (isComposing(event) || event.metaKey || event.ctrlKey || event.altKey || this.content.readOnly) return;
    if (event.key === "Tab") { event.preventDefault(); this.indent(event.shiftKey); }
    else if (event.key === "Enter" && !event.shiftKey) {
      const { selectionStart: start, value } = this.content;
      const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
      const indentation = /^[ \t]*/.exec(value.slice(lineStart, start))![0];
      if (indentation) { event.preventDefault(); this.insertText(`\n${indentation}`); }
    }
  }
  /** execCommand is the only insertion that keeps the browser's undo history. */
  private insertText(text: string): void {
    if (document.execCommand?.("insertText", false, text)) return;
    this.content.setRangeText(text, this.content.selectionStart, this.content.selectionEnd, "end");
    this.content.dispatchEvent(new Event("input", { bubbles: true }));
  }
  private indent(outdent: boolean): void {
    const { selectionStart: start, selectionEnd: end, value } = this.content;
    if (!outdent && !value.slice(start, end).includes("\n")) { this.insertText(INDENT); return; }
    const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
    const selectionEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const nextBreak = value.indexOf("\n", selectionEnd), lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd);
    const next = lines.split("\n").map(line => outdent ? line.replace(/^(?: {1,2}|\t)/, "") : line && INDENT + line).join("\n");
    if (next === lines) return;
    this.content.setSelectionRange(lineStart, lineEnd);
    this.insertText(next);
    this.content.setSelectionRange(lineStart, lineStart + next.length);
  }
  private renderBreadcrumbs(): void {
    const inHome = isHomePath(this.directory), base = inHome ? VFS_HOME : "";
    const parts = this.directory.slice(base.length).split("/").filter(Boolean);
    const crumbs = [{ label: inHome ? "~" : "/", path: inHome ? VFS_HOME : "/" }, ...parts.map((label, index) => ({ label, path: `${base}/${parts.slice(0, index + 1).join("/")}` }))];
    this.directoryLabel.replaceChildren(...crumbs.flatMap(({ label, path }, index) => {
      const last = index === crumbs.length - 1;
      const crumb = document.createElement(last ? "span" : "button");
      crumb.textContent = label; crumb.className = "editor-crumb"; crumb.title = displayPath(path);
      if (last) crumb.setAttribute("aria-current", "location");
      else { (crumb as HTMLButtonElement).type = "button"; crumb.addEventListener("click", () => void this.browse(path)); }
      if (!index) return [crumb];
      const separator = document.createElement("span"); separator.textContent = "/"; separator.className = "editor-crumb-separator"; separator.setAttribute("aria-hidden", "true");
      return [separator, crumb];
    }));
  }
  private async browse(directory: string): Promise<void> {
    if (this.busy) return;
    const active = document.activeElement as HTMLElement | null;
    const focusedRow = this.files.contains(active) ? active!.dataset.path ?? "" : undefined;
    const focusedNavigation = this.directoryLabel.contains(active) || active === this.upButton;
    this.busy = true; this.sync();
    try {
      const entries = await this.fs.listDirectory(directory);
      this.directory = directory; this.renderBreadcrumbs();
      this.files.replaceChildren(...entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path)).map(entry => {
        const button = document.createElement("button"); button.type = "button"; button.className = "editor-file"; button.dataset.kind = entry.kind; button.dataset.path = entry.path;
        const name = entry.path.split("/").at(-1)!, label = document.createElement("span");
        label.textContent = entry.kind === "directory" ? `${name}/` : name; button.append(label); button.title = displayPath(entry.path);
        button.addEventListener("click", () => entry.kind === "directory" ? void this.browse(entry.path) : void this.openFile(entry.path));
        return button;
      }));
      if (!entries.length) { const empty = document.createElement("p"); empty.className = "editor-empty"; empty.textContent = "這個資料夾是空的"; this.files.append(empty); }
    } catch (error) { this.sync(errorText(error), "error"); }
    finally { this.busy = false; this.sync(); }
    if (focusedRow !== undefined || (focusedNavigation && (this.upButton.disabled || active !== this.upButton))) {
      const rows = [...this.files.querySelectorAll<HTMLElement>(".editor-file")];
      (rows.find(row => row.dataset.path === focusedRow) ?? rows[0] ?? this.panel).focus();
    }
  }
  private async openTypedPath(): Promise<void> {
    const value = this.pathInput.value.trim();
    if (!value) { this.pathInput.focus(); return; }
    try {
      const target = resolvePath(value, this.directory);
      if ((await this.fs.stat(target)).kind === "directory") { await this.browse(target); this.pathInput.value = ""; return; }
    } catch (error) {
      if (!(error instanceof FileSystemError) || error.code !== "not_found") { this.sync(errorText(error), "error"); return; }
    }
    await this.openFile(value);
  }
  async openFile(path: string, discard = false): Promise<boolean> {
    if (this.busy) return false;
    let resolved: string;
    try { resolved = resolvePath(path, this.directory); } catch (error) { this.sync(errorText(error), "error"); return false; }
    if (this.dirty && !discard) {
      if (resolved === this.document!.path) return true;
      this.promptUnsaved(resolved); return false;
    }
    if (!await this.load(resolved)) return false;
    this.pathInput.value = "";
    if (isTouchLayout()) this.setFilesOpen(false);
    await this.browse(this.document!.revision === 0 ? this.directory : directoryOf(this.document!.path));
    if (!this.element.hidden) this.focusEditor();
    return true;
  }
  /** Replaces the open document without moving focus or the directory being browsed. */
  private async load(path: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true; this.sync("讀取中…");
    let loaded = false;
    try {
      let original = "", revision = 0, resolved = path;
      try { const file = await this.fs.readFile(path); original = file.content; revision = file.revision; resolved = file.path; }
      catch (error) { if (!(error instanceof FileSystemError) || error.code !== "not_found") throw error; }
      this.document = { path: resolved, revision, original, content: original };
      this.content.value = original; this.content.scrollTop = 0; this.content.scrollLeft = 0; this.content.setSelectionRange(0, 0);
      this.conflictRevision = undefined; this.notice = undefined; this.persist(); loaded = true;
    } catch (error) {
      this.notice = { text: errorText(error), tone: "error" };
    }
    finally { this.busy = false; this.sync(); }
    if (loaded) { this.hideBanner(); this.renderLines(); this.renderPosition(); }
    return loaded;
  }
  /** Resolves false when nothing was written, for example on a revision conflict. */
  async save(): Promise<boolean> {
    if (!this.document || this.busy) return false;
    if (!this.dirty && this.document.revision !== 0) { this.sync("沒有需要儲存的變更"); return true; }
    const focusedSave = document.activeElement === this.saveButton;
    this.busy = true; this.sync("儲存中…");
    try {
      const draft = this.document;
      if (draft.revision === 0) await this.fs.mkdir(directoryOf(draft.path), { recursive: true });
      const file = await this.fs.writeFile(draft.path, draft.content, { expectedRevision: draft.revision });
      this.document = { ...draft, path: file.path, revision: file.revision, original: draft.content };
      this.conflictRevision = undefined; this.persist(); this.hideBanner();
      this.busy = false; await this.browse(directoryOf(file.path)); this.sync("已儲存 · " + displayPath(file.path), "success");
      return true;
    } catch (error) {
      this.busy = false;
      if (error instanceof FileSystemError && error.code === "conflict") this.showConflict(true);
      else this.sync(errorText(error), "error");
      return false;
    } finally {
      // The button is disabled while saving, which drops its focus out of the dialog and its key handling.
      if (focusedSave && this.banner.hidden) this.focusEditor();
    }
  }
  private async previewCurrent(): Promise<void> {
    if (!this.document || !this.options.onPreview) return;
    if ((this.dirty || this.document.revision === 0) && !await this.save()) return;
    try { await this.options.onPreview(this.document.path); }
    catch (error) { this.sync(errorText(error), "error"); }
  }
  /** Clean copies follow the file; a dirty draft is warned before its save would be refused. */
  private async checkExternalChange(): Promise<void> {
    if (!this.element.isConnected) { this.stopWatching(); return; }
    const doc = this.document;
    if (!doc || this.busy || this.element.hidden) return;
    let revision = 0;
    try { revision = (await this.fs.stat(doc.path)).revision; }
    catch (error) { if (!(error instanceof FileSystemError) || error.code !== "not_found") return; }
    if (doc !== this.document || this.busy || revision === doc.revision) return;
    if (this.dirty) {
      if (this.conflictRevision !== revision) { this.conflictRevision = revision; this.showConflict(false); }
      return;
    }
    const { selectionStart, selectionEnd, scrollTop, scrollLeft } = this.content;
    if (!await this.load(doc.path)) return;
    this.content.setSelectionRange(selectionStart, selectionEnd); this.content.scrollTop = scrollTop; this.content.scrollLeft = scrollLeft;
    this.renderLines(); this.renderPosition();
    await this.browse(this.directory);
    this.sync(revision === 0 ? "檔案已被移除，儲存會重新建立。" : `檔案已更新，已載入最新版本 · revision ${revision}`, revision === 0 ? "warning" : "info");
  }
}
