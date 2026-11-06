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
});
