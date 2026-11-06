import { mount, type AgentGoRoundWidget } from "./embed";
import { displayPath, type VirtualFileSystem } from "./core/fs";
import { resolvePreview, STARTER_PAGE } from "./core/preview";
import { toolButton } from "./human-tool-ui";

export type PreviewConfig = { entry: string; surfaceId: string };
export type PreviewOptions = { expanded?: boolean; onEdit?: (path: string) => void };
type PreviewState = "loading" | "ready" | "stale" | "missing" | "error";
const DEVICES = [["desktop", "桌面"], ["tablet", "平板"], ["mobile", "手機"]] as const;

/** The document iframe and the Pi iframe have independent lifecycles. */
export class PreviewSurface {
  readonly element = document.createElement("section");
  readonly frame = document.createElement("iframe");
  readonly widget: AgentGoRoundWidget;
  private readonly status = document.createElement("span");
  private readonly refresh = toolButton("重新載入預覽", { icon: "↻" });
  private readonly create = toolButton("建立主頁範本", { tone: "primary" });
  private readonly message = document.createElement("div");
  private readonly messageTitle = document.createElement("strong");
  private readonly messageDetail = document.createElement("p");
  private messageEdit?: HTMLButtonElement;
  private revisions: Record<string, number> = {};
  private state: PreviewState = "loading";
  private hasContent = false;
  private loading = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  constructor(private readonly fs: VirtualFileSystem, readonly config: PreviewConfig, workspaceId: string, options: PreviewOptions = {}) {
    this.element.className = "preview-surface";
    this.element.dataset.device = "desktop";
    this.element.setAttribute("aria-label", "Page preview");
    const toolbar = document.createElement("div");
    toolbar.className = "preview-toolbar";
    const heading = document.createElement("div");
    heading.className = "preview-heading";
    const title = document.createElement("strong"); title.textContent = displayPath(config.entry); title.title = title.textContent;
    this.status.setAttribute("role", "status"); this.status.className = "preview-status";
    heading.append(title, this.status);
    const actions = document.createElement("div");
    actions.className = "preview-actions";
    actions.append(this.deviceSwitcher());
    this.refresh.addEventListener("click", () => void this.reload());
    this.create.hidden = true;
    this.create.addEventListener("click", () => void this.createStarter());
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", workspaceId); url.searchParams.set("view", "page"); url.searchParams.set("entry", config.entry); url.searchParams.set("surface", "page");
    const workspaceUrl = new URL(url); for (const name of ["view", "entry", "surface"]) workspaceUrl.searchParams.delete(name);
    if (options.onEdit) {
      const edit = toolButton("編輯", { icon: "✎" });
      edit.addEventListener("click", () => options.onEdit!(config.entry));
      actions.append(edit);
    }
    actions.append(this.refresh);
    if (!options.expanded) {
      const page = document.createElement("a");
      page.className = "tool-button"; page.dataset.icon = "↗"; page.title = "放大顯示（開新分頁）"; page.target = "_blank"; page.rel = "noopener"; page.href = url.href;
      const label = document.createElement("span"); label.className = "tool-label"; label.textContent = "放大顯示";
      page.append(label); actions.append(page);
    }
    toolbar.append(heading, actions);
    this.message.className = "preview-message"; this.message.hidden = true;
    const messageActions = document.createElement("div");
    messageActions.className = "preview-message-actions";
    messageActions.append(this.create);
    if (options.onEdit) {
      this.messageEdit = toolButton("在編輯器中修正", { icon: "✎" });
      this.messageEdit.addEventListener("click", () => options.onEdit!(config.entry));
      messageActions.append(this.messageEdit);
    }
    this.message.append(this.messageTitle, this.messageDetail, messageActions);
    this.frame.title = `預覽 ${displayPath(config.entry)}`;
    this.frame.setAttribute("sandbox", ""); this.frame.setAttribute("referrerpolicy", "no-referrer");
    this.element.append(toolbar, this.message, this.frame);
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
    this.setState("loading", "載入中…");
    void this.reload();
  }
  private deviceSwitcher(): HTMLElement {
    const group = document.createElement("div");
    group.className = "preview-devices"; group.setAttribute("role", "group"); group.setAttribute("aria-label", "預覽寬度");
    for (const [device, label] of DEVICES) {
      const button = toolButton(label, { tone: "ghost" });
      button.setAttribute("aria-pressed", String(device === "desktop"));
      button.addEventListener("click", () => {
        this.element.dataset.device = device;
        for (const peer of group.querySelectorAll("button")) peer.setAttribute("aria-pressed", String(peer === button));
      });
      group.append(button);
    }
    return group;
  }
  private setState(state: PreviewState, status: string, title = "", detail = ""): void {
    this.state = state;
    const blocked = state === "missing" || state === "error";
    // A missing entry has nothing left to show; other failures keep the last good page on screen.
    const showFrame = this.hasContent && state !== "missing";
    this.element.dataset.state = state;
    this.element.dataset.hasContent = String(showFrame);
    this.status.textContent = status;
    this.frame.hidden = !showFrame;
    this.message.hidden = !blocked;
    this.messageTitle.textContent = title;
    this.messageDetail.textContent = detail;
    this.create.hidden = state !== "missing";
    this.messageEdit?.querySelector(".tool-label")!.replaceChildren(state === "missing" ? "在編輯器中新增" : "在編輯器中修正");
    this.refresh.classList.toggle("primary", state === "stale");
  }
  private async createStarter(): Promise<void> {
    this.create.disabled = true;
    try {
      await this.fs.mkdir(this.config.entry.slice(0, this.config.entry.lastIndexOf("/")), { recursive: true });
      await this.fs.writeFile(this.config.entry, STARTER_PAGE, { expectedRevision: 0 });
      await this.reload();
      this.refresh.focus();
    } catch (error) { this.showFailure(error instanceof Error ? error.message : String(error)); }
    finally { this.create.disabled = false; }
  }
  private showFailure(detail: string): void {
    if (this.hasContent) this.setState("error", "預覽更新失敗", "無法更新預覽，目前顯示上一次可用的內容", detail);
    else this.setState("error", "無法顯示", "無法顯示這個頁面", detail);
  }
  async reload(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true; this.status.textContent = "載入中…";
    try {
      const result = await resolvePreview(this.fs, this.config.entry);
      if (this.disposed) return;
      this.frame.srcdoc = result.html;
      this.revisions = result.revisions;
      this.hasContent = true;
      this.setState("ready", `revision ${result.revisions[this.config.entry]}`);
    } catch (error) {
      if (this.disposed) return;
      let missing = false;
      try { await this.fs.stat(this.config.entry); } catch { missing = true; }
      if (missing) this.setState("missing", "找不到檔案", "這個頁面還不存在", `${displayPath(this.config.entry)} 尚未建立。可以建立一份範本，或先寫好內容再回來預覽。`);
      else {
        // Compare later polls with what just failed, or the unchanged failure would read as a new update.
        for (const path of Object.keys(this.revisions)) this.revisions[path] = await this.currentRevision(path);
        if (this.disposed) return;
        this.showFailure(error instanceof Error ? error.message : String(error));
      }
    } finally { this.loading = false; }
  }
  private async currentRevision(path: string): Promise<number> {
    try { return (await this.fs.stat(path)).revision; } catch { return 0; }
  }
  private checking = false;
  private async checkChanges(): Promise<void> {
    if (this.loading || this.checking || this.disposed || this.state === "stale") return;
    this.checking = true;
    try {
      if (this.state === "missing") {
        // Nothing is on screen to lose, so show the page as soon as someone creates it.
        try { await this.fs.stat(this.config.entry); } catch { return; }
        if (!this.disposed) void this.reload();
        return;
      }
      for (const [path, revision] of Object.entries(this.revisions)) {
        const changed = await this.currentRevision(path) !== revision;
        if (changed && !this.disposed) { this.setState("stale", "檔案有更新 · 請重新載入預覽"); return; }
      }
    } finally { this.checking = false; }
  }
  destroy(): void {
    this.disposed = true; clearInterval(this.timer); this.unsubscribe(); this.widget.destroy(); this.element.remove();
  }
}
