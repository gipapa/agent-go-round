import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryFileSystem } from "./core/fs";
import { PreviewPicker, listHtmlFiles } from "./preview-picker";

afterEach(() => document.body.replaceChildren());

async function setup(paths: string[], open: (path: string) => void = () => {}) {
  const fs = new MemoryFileSystem();
  for (const path of paths) { await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true }); await fs.writeFile(path, "<h1>page</h1>"); }
  const picker = new PreviewPicker(fs, open);
  document.body.append(picker.element);
  const input = picker.element.querySelector<HTMLInputElement>("#human-preview-path")!;
  const rows = () => [...picker.element.querySelectorAll<HTMLButtonElement>(".human-preview-option")];
  const paths_ = () => rows().map(row => row.title);
  const hint = () => picker.element.querySelector<HTMLElement>("#human-preview-hint")!;
  const type = (value: string) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
  const press = (key: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  return { fs, picker, input, rows, paths: paths_, hint, type, press };
}

describe("listHtmlFiles", () => {
  it("finds HTML at any depth, newest first, and skips other files and symlinks", async () => {
    const fs = new MemoryFileSystem();
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1000); await fs.writeFile("~/older.HTML", "a");
      await fs.mkdir("~/docs/deep", { recursive: true });
      now.mockReturnValue(2000); await fs.writeFile("~/docs/deep/newer.htm", "b");
      now.mockReturnValue(3000); await fs.writeFile("~/notes.txt", "c");
      await fs.symlink("/home/user/older.HTML", "/home/user/link.html");
    } finally { now.mockRestore(); }
    expect((await listHtmlFiles(fs)).map(file => file.path)).toEqual(["/home/user/docs/deep/newer.htm", "/home/user/older.HTML"]);
  });
});

describe("PreviewPicker", () => {
  it("offers the workspace's pages with the suggested one selected, and a click opens it", async () => {
    const open = vi.fn();
    const { picker, input, rows, paths } = await setup(["~/main.html", "~/docs/index.html", "~/notes.txt"], open);
    picker.show("~/main.html");
    expect(picker.element.hidden).toBe(false);
    expect(input.value).toBe("~/main.html");
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    expect(paths().sort()).toEqual(["~/docs/index.html", "~/main.html"]);
    expect(rows().find(row => row.title === "~/main.html")!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(rows().find(row => row.title === "~/main.html")!.id);
    rows().find(row => row.title === "~/docs/index.html")!.click();
    expect(open).toHaveBeenCalledWith("~/docs/index.html");
    expect(picker.element.hidden).toBe(true);
  });

  it("filters only after typing, and still opens a path that matches nothing", async () => {
    const open = vi.fn();
    const { picker, rows, type, hint } = await setup(["~/main.html", "~/docs/index.html"], open);
    picker.show("~/main.html");
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    type("DOCS");
    expect(rows().map(row => row.title)).toEqual(["~/docs/index.html"]);
    expect(hint().hidden).toBe(true);
    type("~/brand-new.html");
    expect(rows()).toHaveLength(0);
    expect(hint().textContent).toContain("~/brand-new.html");
    picker.element.querySelector<HTMLFormElement>("#human-preview-form")!.requestSubmit();
    expect(open).toHaveBeenCalledWith("~/brand-new.html");
  });

  it("moves through results with the arrow keys and submits the highlighted page", async () => {
    const open = vi.fn();
    const { picker, input, rows, press } = await setup(["~/a.html", "~/b.html"], open);
    picker.show("~/main.html");
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    press("ArrowDown");
    const first = rows()[0].title;
    expect(input.value).toBe(first);
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    expect(input.value).toBe(rows()[1].title);
    press("ArrowDown");
    expect(input.value).toBe(first);
    expect(rows()).toHaveLength(2);
    picker.element.querySelector<HTMLFormElement>("#human-preview-form")!.requestSubmit();
    expect(open).toHaveBeenCalledWith(first);
  });

  it("explains an empty workspace and keeps the path usable", async () => {
    const { picker, rows, hint, input } = await setup([]);
    picker.show("~/main.html");
    await vi.waitFor(() => expect(hint().textContent).toContain("還沒有 HTML"));
    expect(rows()).toHaveLength(0);
    expect(input.value).toBe("~/main.html");
  });

  it("stays open with the reason when opening fails or the path is empty", async () => {
    const { picker, input } = await setup([], () => { throw new Error("請選擇家目錄（~/）內的 HTML 檔案。"); });
    const status = picker.element.querySelector("#human-preview-status")!;
    picker.show("/etc/page.html");
    picker.element.querySelector<HTMLFormElement>("#human-preview-form")!.requestSubmit();
    expect(picker.element.hidden).toBe(false);
    expect(status.textContent).toContain("家目錄");
    input.value = "   ";
    picker.element.querySelector<HTMLFormElement>("#human-preview-form")!.requestSubmit();
    expect(status.textContent).toContain("請選擇檔案");
  });

  it("closes on Escape but not while an IME is composing, and returns focus", async () => {
    const { picker, input } = await setup(["~/main.html"]);
    const trigger = document.createElement("button");
    document.body.append(trigger); trigger.focus();
    picker.show("~/main.html");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
    expect(picker.element.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(picker.element.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores a slow listing that finishes after the picker was reopened", async () => {
    const { picker, fs, rows } = await setup(["~/page.html"]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, "listDirectory").mockImplementationOnce(async () => { await gate; return []; });
    picker.show("~/page.html");
    picker.close();
    picker.show("~/page.html");
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    release();
    await new Promise(resolve => setTimeout(resolve));
    expect(rows()).toHaveLength(1);
  });
});
