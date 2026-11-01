import { displayPath, resolvePath, VFS_HOME, type FileStat, type VirtualFileSystem } from "../core/fs";

export type FileBrowserContext = {
  id: string;
  directory: string;
  fs: VirtualFileSystem;
  navigate(path: string): void;
  open(path: string): Promise<void>;
  beforeMutation(path: string, operation: "rename" | "remove"): Promise<boolean>;
  renamed(from: string, to: string): void;
  removed(path: string): void;
};

/** Human-only VFS navigation. Listing reads metadata; opening a file reads its body. */
export class FileBrowser {
  private context?: FileBrowserContext;
  private generation = 0;
  private busy = false;
  private renameTarget?: FileStat;
  private operation: "file" | "directory" | "rename" = "file";
  private readonly path = document.createElement("strong");
  private readonly list = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly form = document.createElement("form");
  private readonly name = document.createElement("input");
  private readonly submit = document.createElement("button");
  constructor(private readonly element: HTMLElement) {
    element.className = "file-browser";
    element.setAttribute("aria-label", "檔案瀏覽器");
    const navigation = document.createElement("div"); navigation.className = "browser-actions";
    navigation.append(this.button("上層", () => this.go(this.context!.directory === VFS_HOME ? VFS_HOME : resolvePath("..", this.context!.directory))), this.button("首頁", () => this.go(VFS_HOME)), this.button("重新整理", () => this.refresh()));
    this.path.className = "browser-path";
    this.list.className = "browser-list";
    this.status.className = "browser-status"; this.status.setAttribute("role", "status");
    const actions = document.createElement("div"); actions.className = "browser-actions";
    actions.append(this.button("新增檔案", () => this.prepare("file")), this.button("新增資料夾", () => this.prepare("directory")));
    this.name.required = true; this.name.setAttribute("aria-label", "檔案或資料夾名稱"); this.name.placeholder = "名稱（包含副檔名）";
    this.submit.type = "submit"; this.submit.textContent = "建立檔案";
    this.form.append(this.name, this.submit); this.form.className = "browser-create";
    this.form.addEventListener("submit", event => { event.preventDefault(); void this.run(async context => {
      const value = this.name.value;
      if (!value.trim() || value === "." || value === ".." || /[\/\\\0]/.test(value)) throw new Error("請輸入單一檔案或資料夾名稱");
      const target = resolvePath(value, context.directory);
      if (this.operation === "rename" && this.renameTarget) {
        const source = this.renameTarget;
        if (!await context.beforeMutation(source.path, "rename")) return;
        await context.fs.rename(source.path, target, { expectedRevision: source.revision });
        context.renamed(source.path, target);
      } else if (this.operation === "directory") {
        // mkdir accepts existing folders; creation must report a name collision.
        if ((await context.fs.listDirectory(context.directory)).some(entry => entry.path === target)) throw new Error("此名稱已存在");
        await context.fs.mkdir(target);
      } else {
        await context.fs.writeFile(target, "", { expectedRevision: 0 });
        await context.open(target);
      }
      if (this.context?.id === context.id) this.prepare("file", false);
    }); });
    element.append(this.path, navigation, actions, this.form, this.status, this.list);
  }
  private button(label: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => { if (!this.busy) void action(); }); return button;
  }
  show(context: FileBrowserContext): void {
    const changed = this.context?.id !== context.id || this.context?.directory !== context.directory;
    this.context = context;
    if (changed) { this.generation++; this.prepare("file", false); void this.refresh(); }
  }
  private prepare(operation: "file" | "directory" | "rename", focus = true, target?: FileStat): void {
    this.operation = operation; this.renameTarget = target;
    this.name.value = target?.path.split("/").at(-1) ?? "";
    this.submit.textContent = operation === "rename" ? "確認改名" : operation === "directory" ? "建立資料夾" : "建立檔案";
    if (focus) this.name.focus();
  }
  private async go(path: string): Promise<void> {
    if (!this.context) return;
    const context = { ...this.context, directory: path };
    context.navigate(path); this.show(context);
  }
  async refresh(): Promise<void> {
    if (!this.context) return;
    const context = this.context, generation = ++this.generation;
    this.path.textContent = displayPath(context.directory);
    this.status.textContent = "讀取中…";
    try {
      const entries = await context.fs.listDirectory(context.directory);
      if (generation !== this.generation) return;
      this.list.replaceChildren();
      entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path));
      for (const entry of entries) {
        const row = document.createElement("div"); row.className = "browser-row"; row.dataset.path = entry.path;
        const name = entry.path.split("/").at(-1)!;
        const open = this.button(`${entry.kind === "directory" ? "▸" : "·"} ${name}`, () => this.run(async current => {
          if (entry.kind === "directory") await this.go(entry.path); else await current.open(entry.path);
        }, false));
        open.className = "browser-entry"; open.title = displayPath(entry.path);
        const rename = this.button("改名", () => this.prepare("rename", true, entry));
        rename.setAttribute("aria-label", `重新命名 ${name}`);
        const remove = this.button("刪除", () => this.run(async current => {
          if (!window.confirm(`刪除 ${displayPath(entry.path)}？此操作無法復原。${entry.kind === "directory" ? "只能刪除空資料夾。" : ""}`)) return;
          if (!await current.beforeMutation(entry.path, "remove")) return;
          await current.fs.remove(entry.path); current.removed(entry.path);
        }));
        remove.setAttribute("aria-label", `刪除 ${name}`);
        row.append(open, rename, remove); this.list.append(row);
      }
      this.status.textContent = entries.length ? `${entries.length} 個項目` : "空資料夾";
    } catch (error) { if (generation === this.generation) { this.list.replaceChildren(); this.status.textContent = error instanceof Error ? error.message : String(error); } }
  }
  private async run(action: (context: FileBrowserContext) => Promise<void>, refresh = true): Promise<void> {
    if (!this.context || this.busy) return;
    const context = this.context;
    this.busy = true; this.element.setAttribute("aria-busy", "true");
    try { await action(context); if (refresh && this.context?.id === context.id) await this.refresh(); }
    catch (error) { if (this.context?.id === context.id) this.status.textContent = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.element.removeAttribute("aria-busy"); }
  }
}
