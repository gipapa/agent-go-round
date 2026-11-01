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
  private expanded = new Set<string>([VFS_HOME]);
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
    this.list.className = "browser-list"; this.list.setAttribute("aria-label", "樹狀檔案");
    this.status.className = "browser-status"; this.status.setAttribute("role", "status");
    const actions = document.createElement("div"); actions.className = "browser-actions";
    actions.append(this.button("新增檔案", () => this.prepare("file")), this.button("新增資料夾", () => this.prepare("directory")));
    this.name.required = true; this.name.setAttribute("aria-label", "檔案或資料夾名稱"); this.name.placeholder = "名稱（包含副檔名）";
    this.submit.type = "submit"; this.submit.textContent = "建立檔案";
    this.form.append(this.name, this.submit); this.form.className = "browser-create";
    this.form.addEventListener("submit", event => { event.preventDefault(); void this.run(async context => {
      const value = this.name.value;
      if (!value.trim() || value === "." || value === ".." || /[\/\\\0]/.test(value)) throw new Error("請輸入單一檔案或資料夾名稱");
      const target = resolvePath(value, this.renameTarget && this.operation === "rename" ? this.renameTarget.path.slice(0, this.renameTarget.path.lastIndexOf("/")) : context.directory);
      if (this.operation === "rename" && this.renameTarget) {
        const source = this.renameTarget;
        if (!await context.beforeMutation(source.path, "rename")) return;
        await context.fs.rename(source.path, target, { expectedRevision: source.revision });
        this.expanded = new Set([...this.expanded].map(path => path === source.path || path.startsWith(source.path + "/") ? target + path.slice(source.path.length) : path));
        if (context.directory === source.path || context.directory.startsWith(source.path + "/")) this.select(target + context.directory.slice(source.path.length));
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
    const tabChanged = this.context?.id !== context.id;
    const changed = tabChanged || this.context?.directory !== context.directory;
    if (tabChanged) this.expanded = new Set([VFS_HOME]);
    this.context = context;
    if (changed) {
      this.expandParents(context.directory);
      this.generation++; this.prepare("file", false); void this.refresh();
    }
  }
  private prepare(operation: "file" | "directory" | "rename", focus = true, target?: FileStat): void {
    this.operation = operation; this.renameTarget = target;
    this.name.value = target?.path.split("/").at(-1) ?? "";
    this.submit.textContent = operation === "rename" ? "確認改名" : operation === "directory" ? "建立資料夾" : "建立檔案";
    if (focus) this.name.focus();
  }
  private async go(path: string): Promise<void> {
    if (!this.context) return;
    this.select(path); this.expandParents(path); await this.refresh();
  }
  private select(path: string): void {
    if (!this.context) return;
    this.context = { ...this.context, directory: path };
    this.context.navigate(path);
  }
  private expandParents(path: string): void {
    for (let current = path; current.startsWith(VFS_HOME); current = current.slice(0, current.lastIndexOf("/"))) this.expanded.add(current);
  }
  async refresh(): Promise<void> {
    if (!this.context) return;
    const context = this.context, generation = ++this.generation;
    this.path.textContent = `新增位置：${displayPath(context.directory)}`;
    this.status.textContent = "讀取中…";
    try {
      const directories = new Map<string, FileStat[]>();
      const read = async (path: string): Promise<void> => {
        const entries = await context.fs.listDirectory(path);
        directories.set(path, entries);
        for (const entry of entries) if (entry.kind === "directory" && this.expanded.has(entry.path)) await read(entry.path);
      };
      await read(VFS_HOME);
      if (generation !== this.generation) return;
      this.list.replaceChildren();
      const renderDirectory = (path: string, container: HTMLElement): void => {
        const entries = directories.get(path) ?? [];
        entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path));
        const group = document.createElement("ul"); group.className = "browser-tree"; container.append(group);
        for (const entry of entries) {
          const item = document.createElement("li"); group.append(item);
          const row = document.createElement("div"); row.className = "browser-row"; row.dataset.path = entry.path;
          const name = entry.path.split("/").at(-1)!;
          const open = this.button(`${entry.kind === "directory" ? (this.expanded.has(entry.path) ? "▾" : "▸") : "·"} ${name}`, () => this.run(async current => {
            if (entry.kind === "directory") {
              if (this.expanded.has(entry.path)) {
                this.expanded.delete(entry.path);
                if (current.directory === entry.path || current.directory.startsWith(entry.path + "/")) this.select(entry.path.slice(0, entry.path.lastIndexOf("/")));
              } else { this.expanded.add(entry.path); this.select(entry.path); }
              await this.refresh();
            } else await current.open(entry.path);
          }, false));
          open.className = "browser-entry"; open.title = displayPath(entry.path);
          if (entry.kind === "directory") open.setAttribute("aria-expanded", String(this.expanded.has(entry.path)));
          if (entry.path === this.context?.directory) open.setAttribute("aria-current", "true");
          const rename = this.button("改名", () => this.prepare("rename", true, entry));
          rename.setAttribute("aria-label", `重新命名 ${name}`);
          const remove = this.button("刪除", () => this.run(async current => {
            if (!window.confirm(`刪除 ${displayPath(entry.path)}？此操作無法復原。${entry.kind === "directory" ? "只能刪除空資料夾。" : ""}`)) return;
            if (!await current.beforeMutation(entry.path, "remove")) return;
            await current.fs.remove(entry.path); current.removed(entry.path);
          }));
          remove.setAttribute("aria-label", `刪除 ${name}`);
          row.append(open, rename, remove); item.append(row);
          if (entry.kind === "directory" && this.expanded.has(entry.path)) {
            if (!directories.get(entry.path)?.length) { const empty = document.createElement("p"); empty.className = "browser-empty"; empty.textContent = "空資料夾"; item.append(empty); }
            else renderDirectory(entry.path, item);
          }
        }
      };
      const root = this.button("▾ ~", () => this.go(VFS_HOME)); root.className = "browser-entry"; this.list.append(root);
      renderDirectory(VFS_HOME, this.list);
      const selected = directories.get(this.context?.directory ?? VFS_HOME) ?? [];
      this.status.textContent = selected.length ? `${selected.length} 個項目` : "空資料夾";
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
