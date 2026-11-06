import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryFileSystem } from "./core/fs";
import { PreviewSurface } from "./preview-surface";

afterEach(() => { document.body.replaceChildren(); });

describe("preview and popup lifecycle", () => {
  it("omits navigation links in expanded view while keeping the shared AI launcher", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("~/main.html", "<h1>Expanded</h1>");
    const surface = new PreviewSurface(fs, { entry: "/home/user/main.html", surfaceId: "popup-expanded" }, "expanded-space", { expanded: true });
    document.body.append(surface.element);
    try {
      await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Expanded"));
      expect(surface.element.querySelectorAll(".preview-toolbar a")).toHaveLength(0);
      expect(surface.widget.element.shadowRoot!.querySelector(".launcher")!.textContent).toBe("回到 AI 模式");
      expect(new URL(surface.widget.iframe.src).searchParams.has("view")).toBe(false);
      expect(new URL(surface.widget.iframe.src).searchParams.get("workspace")).toBe("expanded-space");
    } finally { surface.destroy(); }
  });

  it("refreshes content and dependencies without remounting its workspace-bound popup", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("~/main.html", '<link rel="stylesheet" href="styles.css"><h1>Before</h1>');
    await fs.writeFile("~/styles.css", "h1{color:red}");
    const surface = new PreviewSurface(fs, { entry: "/home/user/main.html", surfaceId: "popup-test" }, "test-space");
    document.body.append(surface.element);
    try {
      await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Before"));
      const popup = surface.widget.iframe;
      const original = popup.src;
      expect(new URL(original).searchParams.get("workspace")).toBe("test-space");
      expect(new URL(original).searchParams.get("surface")).toBe("popup-test");
      expect(surface.frame.getAttribute("sandbox")).toBe("");
      expect([...surface.element.querySelectorAll(".preview-toolbar a")].map(link => link.textContent)).toEqual(["放大顯示"]);
      expect(surface.widget.element.shadowRoot!.querySelector(".launcher")!.textContent).toBe("回到 AI 模式");
      surface.widget.open();
      await fs.writeFile("~/main.html", '<link rel="stylesheet" href="styles.css"><h1>After</h1>');
      await fs.writeFile("~/styles.css", "h1{color:blue}");
      await surface.reload();
      expect(surface.frame.srcdoc).toContain("After"); expect(surface.frame.srcdoc).toContain("color:blue");
      expect(surface.widget.iframe).toBe(popup); expect(popup.src).toBe(original);
      expect(surface.widget.element.shadowRoot!.querySelector(".overlay")!.getAttribute("data-open")).toBe("true");
      const messages = vi.spyOn(popup.contentWindow!, "postMessage").mockImplementation(() => {});
      try {
        popup.dispatchEvent(new Event("load"));
        const hello = messages.mock.calls.map(([message]) => message).find(message => message.type === "hello");
        window.dispatchEvent(new MessageEvent("message", {
          source: popup.contentWindow, origin: new URL(popup.src).origin,
          data: { source: "agent-go-round", type: "host_tool_call", payload: {
            version: 2, instanceId: hello.payload.instanceId, requestId: "read-preview", sessionId: "test", toolCallId: "read-host", toolName: "read_host_page", args: {}
          } }
        }));
        await vi.waitFor(() => expect(messages.mock.calls.map(([message]) => message).find(message => message.type === "host_tool_result")?.payload).toMatchObject({
          status: "success", result: { path: "/home/user/main.html", revision: 2, html: expect.stringContaining("After") }
        }));
      } finally { messages.mockRestore(); }
    } finally { surface.destroy(); }
    expect(surface.element.isConnected).toBe(false);
  });

  it("creates a missing page only on request and never overwrites an existing file", async () => {
    const fs = new MemoryFileSystem();
    const surface = new PreviewSurface(fs, { entry: "/home/user/main.html", surfaceId: "popup-new" }, "new-space");
    document.body.append(surface.element);
    try {
      const create = [...surface.element.querySelectorAll("button")].find(button => button.textContent === "建立主頁範本")!;
      await vi.waitFor(() => expect(create.hidden).toBe(false));
      await expect(fs.readFile("~/main.html")).rejects.toThrow("Not found");
      await fs.writeFile("~/main.html", "other writer");
      create.click();
      await vi.waitFor(() => expect(surface.element.textContent).toContain("changed"));
      expect((await fs.readFile("~/main.html")).content).toBe("other writer");
    } finally { surface.destroy(); }
  });

  describe("states", () => {
    const surfaceFor = (fs: MemoryFileSystem, onEdit?: (path: string) => void) => {
      const surface = new PreviewSurface(fs, { entry: "/home/user/main.html", surfaceId: "popup-state" }, "state-space", { onEdit });
      document.body.append(surface.element);
      return surface;
    };
    const message = (surface: PreviewSurface) => surface.element.querySelector<HTMLElement>(".preview-message")!;
    const status = (surface: PreviewSurface) => surface.element.querySelector(".preview-status")!.textContent;
    const button = (surface: PreviewSurface, label: string) => [...surface.element.querySelectorAll("button")].find(candidate => candidate.textContent === label)!;

    it("replaces the blank frame with an explanation when the page is missing, then shows it once created", async () => {
      const fs = new MemoryFileSystem();
      const onEdit = vi.fn();
      const surface = surfaceFor(fs, onEdit);
      try {
        await vi.waitFor(() => expect(message(surface).hidden).toBe(false));
        expect(surface.element.dataset.state).toBe("missing");
        expect(surface.frame.hidden).toBe(true);
        expect(message(surface).textContent).toContain("~/main.html");
        button(surface, "在編輯器中新增").click();
        expect(onEdit).toHaveBeenCalledWith("/home/user/main.html");
        await fs.writeFile("~/main.html", "<h1>Made elsewhere</h1>");
        await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Made elsewhere"), { timeout: 3000 });
        expect(surface.element.dataset.state).toBe("ready");
        expect(surface.frame.hidden).toBe(false);
        expect(message(surface).hidden).toBe(true);
      } finally { surface.destroy(); }
    });

    it("keeps the last good page on screen when a later reload fails", async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("~/main.html", "<h1>Good</h1>");
      const surface = surfaceFor(fs);
      try {
        await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Good"));
        await fs.writeFile("~/main.html", '<link rel="stylesheet" href="missing.css"><h1>Broken</h1>');
        await surface.reload();
        expect(surface.element.dataset.state).toBe("error");
        expect(surface.element.dataset.hasContent).toBe("true");
        expect(surface.frame.hidden).toBe(false);
        expect(surface.frame.srcdoc).toContain("Good");
        expect(message(surface).textContent).toContain("上一次可用");
        expect(message(surface).textContent).toContain("missing.css");
        expect(button(surface, "建立主頁範本").hidden).toBe(true);
      } finally { surface.destroy(); }
    });

    it("keeps a failed reload's explanation until the file changes again", async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("~/main.html", '<link rel="stylesheet" href="styles.css"><h1>Good</h1>');
      await fs.writeFile("~/styles.css", "h1{color:red}");
      const surface = surfaceFor(fs);
      try {
        await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Good"));
        await fs.writeFile("~/main.html", '<link rel="stylesheet" href="missing.css"><h1>Broken</h1>');
        await fs.remove("~/styles.css");
        await surface.reload();
        expect(surface.element.dataset.state).toBe("error");
        await new Promise(resolve => setTimeout(resolve, 2300));
        expect(surface.element.dataset.state).toBe("error");
        expect(message(surface).textContent).toContain("missing.css");
        await fs.writeFile("~/main.html", "<h1>Fixed</h1>");
        await vi.waitFor(() => expect(surface.element.dataset.state).toBe("stale"), { timeout: 3000 });
      } finally { surface.destroy(); }
    });

    it("explains a page that never rendered instead of showing an empty frame", async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("~/main.html", '<link rel="stylesheet" href="missing.css">');
      const onEdit = vi.fn();
      const surface = surfaceFor(fs, onEdit);
      try {
        await vi.waitFor(() => expect(surface.element.dataset.state).toBe("error"));
        expect(surface.element.dataset.hasContent).toBe("false");
        expect(surface.frame.hidden).toBe(true);
        expect(message(surface).textContent).toContain("無法顯示這個頁面");
        expect(button(surface, "在編輯器中修正")).toBeTruthy();
      } finally { surface.destroy(); }
    });

    it("flags outside changes and emphasises reload without applying them itself", async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("~/main.html", "<h1>Before</h1>");
      const surface = surfaceFor(fs);
      try {
        await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Before"));
        const reload = button(surface, "重新載入預覽");
        expect(reload.classList.contains("primary")).toBe(false);
        await fs.writeFile("~/main.html", "<h1>After</h1>");
        await vi.waitFor(() => expect(status(surface)).toContain("檔案有更新"), { timeout: 3000 });
        expect(reload.classList.contains("primary")).toBe(true);
        expect(surface.frame.srcdoc).toContain("Before");
        reload.click();
        await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("After"));
        expect(reload.classList.contains("primary")).toBe(false);
        expect(status(surface)).toBe("revision 2");
        reload.focus();
        await surface.reload();
        expect(document.activeElement).toBe(reload);
      } finally { surface.destroy(); }
    });

    it("opens its page in the editor and switches preview width", async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("~/main.html", "<h1>Page</h1>");
      const onEdit = vi.fn();
      const surface = surfaceFor(fs, onEdit);
      try {
        await vi.waitFor(() => expect(surface.frame.srcdoc).toContain("Page"));
        button(surface, "編輯").click();
        expect(onEdit).toHaveBeenCalledWith("/home/user/main.html");
        button(surface, "手機").click();
        expect(surface.element.dataset.device).toBe("mobile");
        expect(button(surface, "手機").getAttribute("aria-pressed")).toBe("true");
        expect(button(surface, "桌面").getAttribute("aria-pressed")).toBe("false");
      } finally { surface.destroy(); }
    });
  });
});
