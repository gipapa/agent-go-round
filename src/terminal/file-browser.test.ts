import { afterEach, expect, it, vi } from "vitest";
import { MemoryFileSystem, VFS_HOME } from "../core/fs";
import { FileBrowser, type FileBrowserContext } from "./file-browser";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
async function setup() {
  const fs = new MemoryFileSystem(); await fs.mkdir("~/skills"); await fs.writeFile("~/agents.md", "規則");
  const element = document.createElement("aside"); document.body.append(element);
  const context: FileBrowserContext = { id: "main", directory: VFS_HOME, fs, navigate: vi.fn(), open: vi.fn(async () => {}), beforeMutation: vi.fn(async () => true), renamed: vi.fn(), removed: vi.fn() };
  const browser = new FileBrowser(element); browser.show(context);
  await vi.waitFor(() => expect(element.querySelectorAll(".browser-row")).toHaveLength(2));
  const click = (label: string) => { const button = [...element.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label); if (!button) throw new Error(label); button.click(); };
  const submit = async (name: string) => {
    element.querySelector("input")!.value = name; element.querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(element.hasAttribute("aria-busy")).toBe(false));
  };
  return { fs, element, browser, context, click, submit };
}
it("browses metadata, enters folders, and creates, renames and deletes files through VFS", async () => {
  const { fs, element, context, click, submit } = await setup();
  const reads = vi.spyOn(fs, "readFile");
  click("重新整理"); await vi.waitFor(() => expect(element.querySelector(".browser-status")!.textContent).toBe("2 個項目"));
  expect(reads).not.toHaveBeenCalled();
  click("▸ skills"); await vi.waitFor(() => expect(element.querySelector(".browser-status")!.textContent).toBe("空資料夾"));
  expect(context.navigate).toHaveBeenCalledWith("/home/user/skills");
  click("新增資料夾"); await submit("測試 skill");
  expect((await fs.stat("~/skills/測試 skill")).kind).toBe("directory");
  click("新增檔案"); await submit("skill.md");
  expect((await fs.readFile("~/skills/skill.md")).revision).toBe(1);
  expect(context.open).toHaveBeenCalledWith("/home/user/skills/skill.md");
  click("重新命名 skill.md"); await submit("SKILL.md");
  expect((await fs.readFile("~/skills/SKILL.md")).revision).toBe(2);
  expect(context.renamed).toHaveBeenCalledWith("/home/user/skills/skill.md", "/home/user/skills/SKILL.md");
  vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
  click("刪除 SKILL.md"); await vi.waitFor(() => expect(element.hasAttribute("aria-busy")).toBe(false));
  expect((await fs.stat("~/skills/SKILL.md")).kind).toBe("file");
  click("刪除 SKILL.md"); await vi.waitFor(() => expect(context.removed).toHaveBeenCalledWith("/home/user/skills/SKILL.md"));
  await expect(fs.stat("~/skills/SKILL.md")).rejects.toMatchObject({ code: "not_found" });
});
it("keeps existing contents on collisions, invalid names, nonempty folders and rejected draft changes", async () => {
  const { fs, element, context, click, submit } = await setup();
  await submit("agents.md"); expect((await fs.readFile("~/agents.md")).content).toBe("規則");
  await submit("../escape.md"); await expect(fs.stat("~/escape.md")).rejects.toMatchObject({ code: "not_found" });
  await fs.writeFile("~/skills/file.md", "keep"); vi.spyOn(window, "confirm").mockReturnValue(true);
  click("刪除 skills"); await vi.waitFor(() => expect(element.querySelector(".browser-status")!.textContent).toContain("not empty"));
  expect((await fs.readFile("~/skills/file.md")).content).toBe("keep");
  vi.mocked(context.beforeMutation).mockResolvedValue(false);
  click("刪除 agents.md"); await vi.waitFor(() => expect(element.hasAttribute("aria-busy")).toBe(false));
  expect((await fs.readFile("~/agents.md")).content).toBe("規則");
});
it("expands nested folders in place, preserves siblings, and renames inside the correct parent", async () => {
  const { fs, element, browser, click, submit } = await setup();
  await fs.mkdir("~/skills/one"); await fs.mkdir("~/skills/two"); await fs.writeFile("~/skills/one/SKILL.md", "instructions");
  const listing = vi.spyOn(fs, "listDirectory");
  await browser.refresh();
  expect(listing).not.toHaveBeenCalledWith("/home/user/skills/one");
  click("▸ skills"); await vi.waitFor(() => expect(element.textContent).toContain("▸ one"));
  click("▸ one"); await vi.waitFor(() => expect(element.textContent).toContain("· SKILL.md"));
  expect(element.textContent).toContain("agents.md"); expect(element.textContent).toContain("▸ two");
  click("▾ one"); await vi.waitFor(() => expect(element.textContent).not.toContain("· SKILL.md"));
  expect(element.textContent).toContain("▸ one"); expect(element.textContent).toContain("▸ two");
  click("▸ one"); await vi.waitFor(() => expect(element.textContent).toContain("· SKILL.md"));
  click("重新命名 agents.md"); await submit("rules.md");
  expect((await fs.readFile("~/rules.md")).content).toBe("規則");
  await expect(fs.stat("~/skills/one/rules.md")).rejects.toMatchObject({ code: "not_found" });
});
