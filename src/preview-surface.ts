import { mount, type AgentGoRoundWidget } from "./embed";
import { displayPath, type VirtualFileSystem } from "./core/fs";
import { resolvePreview, STARTER_PAGE } from "./core/preview";

export type PreviewConfig = { entry: string; surfaceId: string };

/** The document iframe and the Pi iframe have independent lifecycles. */
export class PreviewSurface {
  readonly element = document.createElement("section");
  readonly frame = document.createElement("iframe");
  readonly widget: AgentGoRoundWidget;
  private readonly status = document.createElement("span");
  private readonly refresh = document.createElement("button");
  private readonly create = document.createElement("button");
  private revisions: Record<string, number> = {};
  private loading = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  constructor(private readonly fs: VirtualFileSystem, readonly config: PreviewConfig, workspaceId: string, options: { expanded?: boolean } = {}) {
    this.element.className = "preview-surface";
    this.element.setAttribute("aria-label", "Page preview");
    const toolbar = document.createElement("div");
    toolbar.className = "preview-toolbar";
    const title = document.createElement("strong"); title.textContent = displayPath(config.entry);
    this.status.setAttribute("role", "status"); this.status.className = "preview-status";
    this.refresh.type = "button"; this.refresh.textContent = "重新載入預覽";
    this.refresh.addEventListener("click", () => void this.reload());
    this.create.type = "button"; this.create.textContent = "建立主頁範本"; this.create.hidden = true;
    this.create.addEventListener("click", () => void this.createStarter());
    const page = document.createElement("a"); page.textContent = "放大顯示"; page.target = "_blank"; page.rel = "noopener";
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", workspaceId); url.searchParams.set("view", "page"); url.searchParams.set("entry", config.entry); url.searchParams.set("surface", "page");
    page.href = url.href;
    const workspaceUrl = new URL(url); for (const name of ["view", "entry", "surface"]) workspaceUrl.searchParams.delete(name);
    toolbar.append(title, this.status, this.refresh, this.create);
    if (!options.expanded) toolbar.append(page);
    this.frame.title = `預覽 ${displayPath(config.entry)}`;
    this.frame.setAttribute("sandbox", ""); this.frame.setAttribute("referrerpolicy", "no-referrer");
    this.element.append(toolbar, this.frame);
    this.widget = mount({ target: this.element, appUrl: workspaceUrl.href, workspaceId, surfaceId: config.surfaceId, title: "Pi · 頁面工作區", buttonLabel: "回到 AI 模式", width: 700, height: 800,
      hostPageReader: async (offset, limit) => {
        const file = await this.fs.readFile(this.config.entry);
        if (offset > file.content.length) throw new Error("Host page offset exceeds HTML length");
        const end = Math.min(offset + limit, file.content.length);
        return { url: `vfs:${file.path}`, path: file.path, revision: file.revision, title: displayPath(file.path), html: file.content.slice(offset, end), offset, totalCharacters: file.content.length, ...(end < file.content.length ? { nextOffset: end } : {}) };
      }
    });
    this.widget.on("error", error => { if (!this.disposed) this.status.textContent = error instanceof Error ? error.message : String(error); });
    this.unsubscribe = this.widget.on("message", message => {
      const event = message as { type?: string; payload?: { phase?: string } };
      if (event.type === "prompt" && event.payload?.phase === "finished") void this.checkChanges();
    });
    this.timer = setInterval(() => void this.checkChanges(), 2000);
    void this.reload();
  }
  private async createStarter(): Promise<void> {
    this.create.disabled = true;
    try {
      await this.fs.mkdir(this.config.entry.slice(0, this.config.entry.lastIndexOf("/")), { recursive: true });
      await this.fs.writeFile(this.config.entry, STARTER_PAGE, { expectedRevision: 0 });
      await this.reload();
    } catch (error) { this.status.textContent = String(error instanceof Error ? error.message : error); }
    finally { this.create.disabled = false; }
  }
  async reload(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true; this.refresh.disabled = true; this.status.textContent = "載入中…";
    try {
      const result = await resolvePreview(this.fs, this.config.entry);
      if (this.disposed) return;
      this.frame.srcdoc = result.html;
      this.revisions = result.revisions;
      this.create.hidden = true;
      this.status.textContent = `revision ${result.revisions[this.config.entry]}`;
    } catch (error) {
      if (this.disposed) return;
      this.status.textContent = error instanceof Error ? error.message : String(error);
      try { await this.fs.stat(this.config.entry); this.create.hidden = true; } catch { this.create.hidden = false; }
    } finally { this.loading = false; this.refresh.disabled = false; }
  }
  private checking = false;
  private async checkChanges(): Promise<void> {
    if (this.loading || this.checking || this.disposed) return;
    this.checking = true;
    try {
      for (const [path, revision] of Object.entries(this.revisions)) {
        let changed = false;
        try { changed = (await this.fs.stat(path)).revision !== revision; } catch { changed = true; }
        if (changed && !this.disposed) { this.status.textContent = "檔案有更新 · 請重新載入預覽"; return; }
      }
    } finally { this.checking = false; }
  }
  destroy(): void {
    this.disposed = true; clearInterval(this.timer); this.unsubscribe(); this.widget.destroy(); this.element.remove();
  }
}
