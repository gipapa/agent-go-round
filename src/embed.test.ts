import { describe, expect, it } from "vitest";
import { mount, readHostPage } from "./embed";

describe("AgentGoRound embed loader", () => {
  it("isolates default popup workspaces and preserves explicit workspace bindings", () => {
    const first = mount({ appUrl: "https://example.com/app/" });
    const second = mount({ appUrl: "https://example.com/app/" });
    const explicit = mount({ appUrl: "https://example.com/app/?workspace=shared" });
    try {
      const a = new URL(first.iframe.src).searchParams.get("workspace");
      const b = new URL(second.iframe.src).searchParams.get("workspace");
      expect(a).toMatch(/^popup-/);
      expect(b).not.toBe(a);
      expect(a).not.toBe("default");
      expect(new URL(explicit.iframe.src).searchParams.get("workspace")).toBe("shared");
    } finally { first.destroy(); second.destroy(); explicit.destroy(); }
  });

  it("reads actual host HTML with pagination while excluding widget UI and form values", () => {
    const content = document.createElement("main");
    content.innerHTML = '<p>這一頁的作者是gipapa</p><input value="private-value"><script>private-script</script>';
    document.body.append(content);
    const widget = mount({ appUrl: "about:blank" });
    try {
      const result = readHostPage();
      expect(result.html).toContain("這一頁的作者是gipapa");
      expect(result.html).not.toContain("private-value");
      expect(result.html).not.toContain("private-script");
      expect(result.html).not.toContain("data-agent-go-round-widget");
      const first = readHostPage(0, 12);
      expect(first.nextOffset).toBe(12);
      expect(first.html + readHostPage(12).html).toBe(result.html);
      content.querySelector("p")!.textContent = "updated author";
      expect(readHostPage().html).toContain("updated author");
    } finally { widget.destroy(); content.remove(); }
  });
  it("resizes a popup with its host visual viewport and removes observers on destroy", () => {
    const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const widget = mount({ appUrl: "about:blank" });
    try {
      const root = widget.element.shadowRoot!.querySelector<HTMLElement>(".widget-root")!;
      viewport.height = 320; viewport.offsetTop = 90; viewport.width = 360; viewport.offsetLeft = 15;
      viewport.dispatchEvent(new Event("resize"));
      expect(root.style.getPropertyValue("--agr-viewport-height")).toBe("320px");
      expect(root.style.getPropertyValue("--agr-viewport-width")).toBe("360px");
      expect(root.style.getPropertyValue("--agr-viewport-top")).toBe("90px");
      expect(root.style.getPropertyValue("--agr-viewport-left")).toBe("15px");
      widget.destroy();
      viewport.height = 844; viewport.dispatchEvent(new Event("resize"));
      expect(root.style.getPropertyValue("--agr-viewport-height")).toBe("320px");
    } finally {
      widget.destroy();
      if (original) Object.defineProperty(window, "visualViewport", original); else Reflect.deleteProperty(window, "visualViewport");
    }
  });
  it("binds a popup to an explicit workspace and restorable surface", () => {
    const widget = mount({ appUrl: "https://example.com/app/", workspaceId: "workspace-a", surfaceId: "popup-main" });
    expect(widget.iframe.src).toBe("https://example.com/app/?workspace=workspace-a&surface=popup-main&tabs=vertical");
    widget.destroy();
    expect(() => mount({ workspaceId: "../bad" })).toThrow("Invalid workspace");
  });
  it("mounts a popup and manages its lifecycle", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const widget = mount({ target, appUrl: "about:blank" });
    const shadow = widget.element.shadowRoot;
    if (!shadow) throw new Error("Expected widget shadow root");

    expect(target.contains(widget.element)).toBe(true);
    expect(shadow.querySelector("iframe")?.getAttribute("src")).toBe("about:blank");
    expect(shadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("false");

    const events: string[] = [];
    widget.on("open", () => events.push("open"));
    widget.on("close", () => events.push("close"));
    widget.open();
    widget.close();

    expect(events).toEqual(["open", "close"]);
    expect(shadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("false");

    widget.destroy();
    expect(target.contains(widget.element)).toBe(false);
  });

  it("starts inline widgets open without exposing a launcher", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const widget = mount({ target, mode: "inline", appUrl: "about:blank" });
    const shadow = widget.element.shadowRoot;
    if (!shadow) throw new Error("Expected widget shadow root");

    expect(shadow.querySelector(".widget-root")?.getAttribute("data-mode")).toBe("inline");
    expect(shadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("true");
    expect(shadow.querySelector(".launcher")).not.toBeNull();

    widget.close();
    expect(shadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("false");
    widget.open();
    expect(shadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("true");

    widget.destroy();
  });

  it("keeps two widget instances isolated", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const first = mount({ target, appUrl: "about:blank", buttonLabel: "First" });
    const second = mount({ target, appUrl: "about:blank", buttonLabel: "Second" });
    const firstShadow = first.element.shadowRoot;
    const secondShadow = second.element.shadowRoot;
    if (!firstShadow || !secondShadow) throw new Error("Expected widget shadow roots");

    first.open();
    expect(firstShadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("true");
    expect(secondShadow.querySelector(".overlay")?.getAttribute("data-open")).toBe("false");
    first.destroy();
    expect(target.contains(second.element)).toBe(true);
    second.destroy();
  });
});
