import { VFS_HOME, displayPath, type FileStat, type VirtualFileSystem } from "./core/fs";
import { isComposing, isTouchLayout, trapTabKey } from "./human-tool-ui";

const HTML_FILE = /\.html?$/i;

/** Every HTML file under `root`, most recently updated first. Symlinks are not followed. */
export async function listHtmlFiles(fs: VirtualFileSystem, root = VFS_HOME): Promise<FileStat[]> {
  const files: FileStat[] = [], directories = [root];
  for (let directory = directories.pop(); directory; directory = directories.pop()) {
    for (const entry of await fs.listDirectory(directory)) {
      if (entry.kind === "directory") directories.push(entry.path);
      else if (entry.kind === "file" && HTML_FILE.test(entry.path)) files.push(entry);
    }
  }
  return files.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
}

/** Pick a page to preview. The path field stays authoritative, so unlisted or new paths still open. */
export class PreviewPicker {
  readonly element = document.createElement("section");
  private readonly panel: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly status: HTMLElement;
  private files: FileStat[] = [];
  private visible: FileStat[] = [];
  private activeIndex = -1;
  private filtering = false;
  private loadState: "loading" | "ready" | "failed" = "loading";
  private loadToken = 0;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly fs: VirtualFileSystem, private readonly open: (path: string) => void) {
    this.element.id = "human-preview-dialog";
    this.element.className = "human-preview-dialog";
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");
    this.element.setAttribute("aria-labelledby", "human-preview-title");
    this.element.innerHTML = `
      <div class="human-tool-backdrop"></div>
      <form id="human-preview-form" class="human-preview-panel" tabindex="-1" novalidate>
        <header class="human-preview-header">
          <div><strong id="human-preview-title">開啟預覽</strong><span>選擇工作區的 HTML 頁面，不需要連接模型</span></div>
          <button id="human-preview-close" class="drawer-close" type="button" aria-label="關閉預覽選擇">×</button>
        </header>
        <div class="human-preview-field">
          <label for="human-preview-path">搜尋或輸入路徑</label>
          <input id="human-preview-path" role="combobox" aria-controls="human-preview-list" aria-expanded="true" aria-autocomplete="list" placeholder="例如 ~/main.html" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <div class="human-preview-results">
          <div class="human-preview-heading"><span>工作區 HTML 檔案</span><span id="human-preview-count"></span></div>
          <div id="human-preview-list" class="human-preview-list" role="listbox" aria-label="工作區 HTML 檔案"></div>
          <p id="human-preview-hint" class="human-preview-hint" hidden></p>
        </div>
        <p id="human-preview-status" role="status" aria-live="polite"></p>
        <footer class="human-preview-footer">
          <button id="human-preview-cancel" class="tool-button ghost" type="button">取消</button>
          <button id="human-preview-submit" class="tool-button primary" type="submit">開啟預覽</button>
        </footer>
      </form>`;
    const get = <T extends HTMLElement>(id: string) => this.element.querySelector<T>(`#${id}`)!;
    this.panel = get("human-preview-form"); this.input = get("human-preview-path"); this.list = get("human-preview-list");
    this.count = get("human-preview-count"); this.hint = get("human-preview-hint"); this.status = get("human-preview-status");
    get("human-preview-close").addEventListener("click", () => this.close());
    get("human-preview-cancel").addEventListener("click", () => this.close());
    this.element.querySelector(".human-tool-backdrop")!.addEventListener("click", () => this.close());
    this.panel.addEventListener("submit", event => { event.preventDefault(); this.submit(); });
    this.input.addEventListener("input", () => { this.filtering = true; this.status.textContent = ""; this.render(); });
    this.element.addEventListener("keydown", event => {
      if (isComposing(event)) return;
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      else if (event.key === "Tab") trapTabKey(event, this.panel);
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); this.move(event.key === "ArrowDown" ? 1 : -1); }
    });
  }

  /** Runs synchronously up to the file scan, so the field is ready as soon as this returns. */
  show(path: string): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.input.value = path;
    this.status.textContent = "";
    this.filtering = false;
    this.loadState = "loading";
    this.files = [];
    this.render();
    this.element.hidden = false;
    // Keep the list visible on touch screens instead of raising the keyboard over it.
    if (isTouchLayout()) this.panel.focus();
    else { this.input.focus(); this.input.select(); }
    void this.load();
  }

  close(): void {
    if (this.element.hidden) return;
    this.loadToken++;
    this.element.hidden = true;
    this.returnFocus?.focus();
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    try {
      const files = await listHtmlFiles(this.fs);
      if (token !== this.loadToken) return;
      this.files = files; this.loadState = "ready";
    } catch {
      if (token !== this.loadToken) return;
      this.loadState = "failed";
    }
    this.render();
  }

  private render(): void {
    const typed = this.input.value.trim();
    const query = this.filtering ? typed.toLowerCase() : "";
    this.visible = this.files.filter(file => displayPath(file.path).toLowerCase().includes(query));
    this.activeIndex = this.visible.findIndex(file => displayPath(file.path) === typed);
    this.list.replaceChildren(...this.visible.map((file, index) => this.row(file, index)));
    this.count.textContent = this.loadState === "ready" ? String(this.visible.length) : "";
    this.hint.textContent = this.hintText(typed);
    this.hint.hidden = !this.hint.textContent;
    this.highlight();
  }

  private row(file: FileStat, index: number): HTMLButtonElement {
    const path = displayPath(file.path), slash = path.lastIndexOf("/");
    const row = document.createElement("button");
    row.type = "button"; row.id = `human-preview-option-${index}`; row.className = "human-preview-option"; row.tabIndex = -1; row.title = path;
    row.setAttribute("role", "option");
    const name = document.createElement("span"); name.textContent = path.slice(slash + 1);
    const directory = document.createElement("small"); directory.textContent = path.slice(0, slash + 1);
    row.append(name, directory);
    row.addEventListener("click", () => { this.input.value = path; this.submit(); });
    return row;
  }

  private hintText(typed: string): string {
    if (this.loadState === "loading") return "讀取檔案中…";
    if (this.loadState === "failed") return "無法列出檔案，仍可輸入路徑開啟。";
    if (this.visible.length) return "";
    if (!this.files.length) return "工作區還沒有 HTML 檔案。輸入路徑後開啟，可在預覽中建立範本。";
    return `沒有符合「${typed}」的檔案。按「開啟預覽」仍會開啟這個路徑，可在預覽中建立範本。`;
  }

  private move(delta: number): void {
    const count = this.visible.length;
    if (!count) return;
    this.activeIndex = this.activeIndex < 0 ? (delta > 0 ? 0 : count - 1) : (this.activeIndex + delta + count) % count;
    this.input.value = displayPath(this.visible[this.activeIndex].path);
    this.highlight();
  }

  private highlight(): void {
    [...this.list.children].forEach((row, index) => row.setAttribute("aria-selected", String(index === this.activeIndex)));
    const active = this.list.children[this.activeIndex];
    if (active) { this.input.setAttribute("aria-activedescendant", active.id); active.scrollIntoView?.({ block: "nearest" }); }
    else this.input.removeAttribute("aria-activedescendant");
  }

  private submit(): void {
    const path = this.input.value.trim();
    if (!path) { this.status.textContent = "請選擇檔案或輸入路徑。"; this.input.focus(); return; }
    try { this.open(path); this.close(); }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); this.input.focus(); }
  }
}
