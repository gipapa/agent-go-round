import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryFileSystem } from "./core/fs";
import { FileEditor, type EditorDraft } from "./file-editor";

afterEach(() => document.body.replaceChildren());
function change(editor: FileEditor, value: string) {
  const input = editor.element.querySelector<HTMLTextAreaElement>("#editor-content")!;
  input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
}
it("edits literal UTF-8 content and saves against the opened file revision", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("~/main.html", "Original");
  const editor = new FileEditor(fs); document.body.append(editor.element); await editor.show();
  change(editor, '<p title="quote">人類的 $HOME `文字`</p>\n'); await editor.save();
  expect(await fs.readFile("~/main.html")).toMatchObject({ revision: 2, content: '<p title="quote">人類的 $HOME `文字`</p>\n' });
  expect(editor.element.querySelector("#editor-status")!.textContent).toContain("已儲存");
  await fs.writeBytes("~/binary", new Uint8Array([255]));
  await editor.openFile("~/binary");
  expect(editor.element.querySelector("#editor-current")!.textContent).toBe("~/main.html");
  expect(editor.element.querySelector("#editor-status")!.textContent).toContain("not valid UTF-8");
  expect(editor.path).toBe("/home/user/main.html");
});
it("keeps a conflicting draft and restores it after reopening without overwriting the AI change", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("~/main.html", "Original");
  let draft: EditorDraft | undefined;
  const store = { load: async () => draft, save: async (value: EditorDraft | undefined) => { draft = value; } };
  const editor = new FileEditor(fs, store); document.body.append(editor.element); await editor.show();
  change(editor, "Human draft"); await fs.writeFile("~/main.html", "AI changed the file"); await editor.save();
  expect((await fs.readFile("~/main.html")).content).toBe("AI changed the file");
  expect(editor.element.querySelector("#editor-status")!.textContent).toContain("未覆寫");
  editor.close(); await vi.waitFor(() => expect(draft?.content).toBe("Human draft"));
  editor.element.remove();
  const restored = new FileEditor(fs, store); document.body.append(restored.element); await restored.show();
  expect(restored.element.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("Human draft");
  await restored.save(); expect((await fs.readFile("~/main.html")).content).toBe("AI changed the file");
});
it("blocks switching files with a dirty draft until the human explicitly discards it", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("~/main.html", "Original"); await fs.writeFile("~/other.txt", "Other");
  const editor = new FileEditor(fs); document.body.append(editor.element); await editor.show();
  change(editor, "Unsaved"); await editor.openFile("~/other.txt");
  expect(editor.path).toBe("/home/user/main.html");
  expect(editor.element.querySelector<HTMLTextAreaElement>("#editor-content")!.value).toBe("Unsaved");
  await editor.openFile("~/other.txt", true);
  expect(editor.path).toBe("/home/user/other.txt");
  expect((await fs.readFile("~/main.html")).content).toBe("Original");
});
it("creates new files and parents only when saved, and does not replace a concurrent creation", async () => {
  const fs = new MemoryFileSystem(); const editor = new FileEditor(fs); document.body.append(editor.element); await editor.show();
  await editor.openFile("~/notes/new.txt"); change(editor, "新檔案");
  await expect(fs.stat("~/notes")).rejects.toMatchObject({ code: "not_found" });
  await editor.save(); expect((await fs.readFile("~/notes/new.txt")).content).toBe("新檔案");
  await editor.openFile("~/new.txt"); change(editor, "Human"); await fs.writeFile("~/new.txt", "Other writer");
  await editor.save(); expect((await fs.readFile("~/new.txt")).content).toBe("Other writer");
});

describe("editing surface", () => {
  const query = <T extends HTMLElement>(editor: FileEditor, selector: string) => editor.element.querySelector<T>(selector)!;
  const content = (editor: FileEditor) => query<HTMLTextAreaElement>(editor, "#editor-content");
  const row = (editor: FileEditor, name: string) => [...editor.element.querySelectorAll<HTMLButtonElement>(".editor-file")].find(button => button.textContent === name)!;
  const action = (editor: FileEditor, id: string) => query<HTMLButtonElement>(editor, `#editor-banner [data-action="${id}"]`);
  async function open(...files: [string, string][]) {
    const fs = new MemoryFileSystem();
    for (const [path, text] of files) { await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true }); await fs.writeFile(path, text); }
    const options = { onPreview: vi.fn(), onDirtyChange: vi.fn() };
    const editor = new FileEditor(fs, undefined, options);
    document.body.append(editor.element);
    await editor.show();
    return { fs, editor, ...options };
  }

  it("marks the open file and its unsaved state in the header, list and sidebar callback", async () => {
    const { editor, onDirtyChange } = await open(["~/main.html", "Original"], ["~/other.txt", "Other"]);
    expect(query(editor, "#editor-current").textContent).toBe("~/main.html");
    expect(row(editor, "main.html").getAttribute("aria-current")).toBe("true");
    expect(row(editor, "other.txt").hasAttribute("aria-current")).toBe(false);
    expect(query(editor, "#editor-badge").hidden).toBe(true);
    expect(query<HTMLButtonElement>(editor, "#editor-save").disabled).toBe(true);
    expect(query<HTMLButtonElement>(editor, "#editor-reload").disabled).toBe(true);
    change(editor, "Edited");
    expect(query(editor, "#editor-badge").textContent).toBe("未儲存");
    expect(row(editor, "main.html").classList.contains("dirty")).toBe(true);
    expect(query<HTMLButtonElement>(editor, "#editor-save").disabled).toBe(false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await editor.save();
    expect(query(editor, "#editor-badge").hidden).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("offers save, discard or stay when another file is opened over unsaved changes", async () => {
    const { fs, editor } = await open(["~/main.html", "Original"], ["~/other.txt", "Other"]);
    change(editor, "Unsaved");
    row(editor, "other.txt").click();
    await vi.waitFor(() => expect(query(editor, "#editor-banner").hidden).toBe(false));
    action(editor, "cancel").click();
    expect(query(editor, "#editor-banner").hidden).toBe(true);
    expect(content(editor).value).toBe("Unsaved");

    row(editor, "other.txt").click();
    await vi.waitFor(() => expect(query(editor, "#editor-banner").hidden).toBe(false));
    action(editor, "save").click();
    await vi.waitFor(() => expect(editor.path).toBe("/home/user/other.txt"));
    expect((await fs.readFile("~/main.html")).content).toBe("Unsaved");

    change(editor, "Throw this away");
    row(editor, "main.html").click();
    await vi.waitFor(() => expect(query(editor, "#editor-banner").hidden).toBe(false));
    action(editor, "discard").click();
    await vi.waitFor(() => expect(editor.path).toBe("/home/user/main.html"));
    expect((await fs.readFile("~/other.txt")).content).toBe("Other");
    expect(query(editor, "#editor-banner").hidden).toBe(true);
  });

  it("asks before the footer discard button throws a draft away", async () => {
    const { editor } = await open(["~/main.html", "Original"]);
    change(editor, "Draft");
    query(editor, "#editor-reload").click();
    expect(content(editor).value).toBe("Draft");
    action(editor, "cancel").click();
    expect(content(editor).value).toBe("Draft");
    query(editor, "#editor-reload").click();
    action(editor, "discard").click();
    await vi.waitFor(() => expect(content(editor).value).toBe("Original"));
    expect(query<HTMLButtonElement>(editor, "#editor-reload").disabled).toBe(true);
  });

  it("explains a conflict and only replaces the draft when asked", async () => {
    const { fs, editor } = await open(["~/main.html", "Original"]);
    change(editor, "Draft");
    await fs.writeFile("~/main.html", "AI version");
    expect(await editor.save()).toBe(false);
    expect(query(editor, "#editor-banner").hidden).toBe(false);
    expect(content(editor).value).toBe("Draft");
    expect((await fs.readFile("~/main.html")).content).toBe("AI version");
    action(editor, "latest").click();
    await vi.waitFor(() => expect(content(editor).value).toBe("AI version"));
    expect(query(editor, "#editor-banner").hidden).toBe(true);
  });

  it("follows outside changes while clean without moving focus or the browsed folder, and warns while dirty", async () => {
    const { fs, editor } = await open(["~/main.html", "Original"], ["~/docs/a.txt", "A"]);
    row(editor, "docs/").click();
    await vi.waitFor(() => expect(row(editor, "a.txt")).toBeTruthy());
    const pathInput = query<HTMLInputElement>(editor, "#editor-path");
    pathInput.focus();
    await fs.writeFile("~/main.html", "AI version");
    await vi.waitFor(() => expect(content(editor).value).toBe("AI version"), { timeout: 3000 });
    expect(query(editor, "#editor-status").textContent).toContain("已載入最新版本");
    expect(document.activeElement).toBe(pathInput);
    expect(row(editor, "a.txt")).toBeTruthy();

    change(editor, "Human draft");
    await fs.writeFile("~/main.html", "AI again");
    await vi.waitFor(() => expect(query(editor, "#editor-banner").hidden).toBe(false), { timeout: 3000 });
    expect(content(editor).value).toBe("Human draft");
    expect(document.activeElement).toBe(pathInput);
  });

  it("does not write or bump the revision when saving an unchanged file, and says so", async () => {
    const { fs, editor } = await open(["~/main.html", "Original"]);
    expect(await editor.save()).toBe(true);
    expect((await fs.readFile("~/main.html")).revision).toBe(1);
    expect(query(editor, "#editor-status").textContent).toContain("沒有需要儲存");
  });

  it("opens the path the prompt named even when saving moves the browsed folder", async () => {
    const { fs, editor } = await open(["~/main.html", "Original"], ["~/b.txt", "Wrong file"], ["~/docs/b.txt", "Right file"]);
    change(editor, "Unsaved");
    row(editor, "docs/").click();
    await vi.waitFor(() => expect(row(editor, "b.txt")).toBeTruthy());
    query<HTMLInputElement>(editor, "#editor-path").value = "b.txt";
    query<HTMLFormElement>(editor, "#editor-open-form").requestSubmit();
    await vi.waitFor(() => expect(query(editor, "#editor-banner").hidden).toBe(false));
    expect(query(editor, "#editor-banner-text").textContent).toContain("~/docs/b.txt");
    action(editor, "save").click();
    await vi.waitFor(() => expect(editor.path).toBe("/home/user/docs/b.txt"));
    expect(content(editor).value).toBe("Right file");
    expect((await fs.readFile("~/main.html")).content).toBe("Unsaved");
    expect(query<HTMLInputElement>(editor, "#editor-path").value).toBe("");
  });

  it("keeps focus inside the dialog when a control that had it goes away", async () => {
    const { editor } = await open(["~/main.html", "Original"], ["~/docs/a.txt", "A"]);
    change(editor, "Edited");
    query(editor, "#editor-save").focus();
    await editor.save();
    expect(document.activeElement).toBe(content(editor));

    row(editor, "docs/").focus();
    row(editor, "docs/").click();
    await vi.waitFor(() => expect(row(editor, "a.txt")).toBeTruthy());
    expect(document.activeElement).toBe(row(editor, "a.txt"));

    query(editor, "#editor-up").focus();
    query(editor, "#editor-up").click();
    await vi.waitFor(() => expect(row(editor, "docs/")).toBeTruthy());
    expect(query<HTMLButtonElement>(editor, "#editor-up").disabled).toBe(true);
    expect(editor.element.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(query(editor, "#editor-up"));

    row(editor, "docs/").click();
    await vi.waitFor(() => expect(row(editor, "a.txt")).toBeTruthy());
    query(editor, "#editor-directory button").focus();
    query(editor, "#editor-directory button").click();
    await vi.waitFor(() => expect(row(editor, "docs/")).toBeTruthy());
    expect(document.activeElement).toBe(row(editor, "docs/"));
  });

  it("keeps focus in the text area through a keyboard save", async () => {
    const { editor } = await open(["~/main.html", "Original"]);
    content(editor).focus();
    change(editor, "Edited");
    const saving = editor.save();
    expect(content(editor).disabled).toBe(false);
    await saving;
    expect(document.activeElement).toBe(content(editor));
  });

  it("numbers lines and reports the caret position", async () => {
    const { editor } = await open(["~/main.html", "one\ntwo\nthree"]);
    expect(query(editor, "#editor-gutter-lines").textContent).toBe("1\n2\n3");
    change(editor, "one\ntwo\nthree\nfour");
    expect(query(editor, "#editor-gutter-lines").textContent).toBe("1\n2\n3\n4");
    content(editor).setSelectionRange(6, 6);
    content(editor).dispatchEvent(new Event("click"));
    expect(query(editor, "#editor-position").textContent).toBe("行 2，欄 3");
  });

  it("indents with Tab, keeps indentation on Enter, and leaves the IME alone", async () => {
    const { editor } = await open(["~/main.html", "  one\ntwo"]);
    const press = (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      content(editor).dispatchEvent(event);
      return event;
    };
    content(editor).setSelectionRange(5, 5);
    press("Enter");
    expect(content(editor).value).toBe("  one\n  \ntwo");
    content(editor).setSelectionRange(0, content(editor).value.length);
    press("Tab");
    expect(content(editor).value).toBe("    one\n    \n  two");
    press("Tab", { shiftKey: true });
    expect(content(editor).value).toBe("  one\n  \ntwo");
    content(editor).setSelectionRange(0, 0);
    press("Tab");
    expect(content(editor).value).toBe("    one\n  \ntwo");

    const value = content(editor).value;
    expect(press("Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(press("Tab", { isComposing: true }).defaultPrevented).toBe(false);
    expect(content(editor).value).toBe(value);
    press("Escape", { isComposing: true });
    expect(editor.element.hidden).toBe(false);
  });

  it("saves before previewing an HTML draft, and only offers preview for HTML in the workspace", async () => {
    const { fs, editor, onPreview } = await open(["~/main.html", "Original"], ["~/notes.txt", "Notes"]);
    const preview = query<HTMLButtonElement>(editor, "#editor-preview");
    expect(preview.hidden).toBe(false);
    change(editor, "Edited");
    expect(preview.textContent).toBe("儲存並預覽");
    preview.click();
    await vi.waitFor(() => expect(onPreview).toHaveBeenCalledWith("/home/user/main.html"));
    expect((await fs.readFile("~/main.html")).content).toBe("Edited");
    await editor.openFile("~/notes.txt");
    expect(preview.hidden).toBe(true);
  });

  it("does not preview when the save was refused", async () => {
    const { fs, editor, onPreview } = await open(["~/main.html", "Original"]);
    change(editor, "Draft");
    await fs.writeFile("~/main.html", "AI version");
    query(editor, "#editor-preview").click();
    await vi.waitFor(() => expect(query(editor, "#editor-banner").hidden).toBe(false));
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("navigates folders by breadcrumb and creates a typed path relative to the browsed folder", async () => {
    const { fs, editor } = await open(["~/main.html", "Original"], ["~/docs/guides/a.txt", "A"]);
    expect(query<HTMLButtonElement>(editor, "#editor-up").disabled).toBe(true);
    row(editor, "docs/").click();
    await vi.waitFor(() => expect(row(editor, "guides/")).toBeTruthy());
    row(editor, "guides/").click();
    await vi.waitFor(() => expect(row(editor, "a.txt")).toBeTruthy());
    expect([...query(editor, "#editor-directory").children].map(node => node.textContent).join("")).toBe("~/docs/guides");
    query<HTMLButtonElement>(editor, "#editor-directory button:last-of-type").click();
    await vi.waitFor(() => expect(row(editor, "guides/")).toBeTruthy());
    expect(query<HTMLButtonElement>(editor, "#editor-up").disabled).toBe(false);

    const input = query<HTMLInputElement>(editor, "#editor-path");
    input.value = "new.md";
    query<HTMLFormElement>(editor, "#editor-open-form").requestSubmit();
    await vi.waitFor(() => expect(editor.path).toBe("/home/user/docs/new.md"));
    expect(input.value).toBe("");
    expect(query(editor, "#editor-badge").textContent).toBe("新檔案");
    await expect(fs.stat("~/docs/new.md")).rejects.toMatchObject({ code: "not_found" });

    input.value = "guides";
    query<HTMLFormElement>(editor, "#editor-open-form").requestSubmit();
    await vi.waitFor(() => expect(row(editor, "a.txt")).toBeTruthy());
    expect(editor.path).toBe("/home/user/docs/new.md");
  });

  it("opens a requested file on show and leaves an already open dirty draft alone", async () => {
    const { editor } = await open(["~/main.html", "Original"], ["~/other.html", "Other"]);
    editor.close();
    await editor.show("/home/user", "~/other.html");
    expect(editor.path).toBe("/home/user/other.html");
    change(editor, "Draft");
    editor.close();
    await editor.show("/home/user", "~/other.html");
    expect(content(editor).value).toBe("Draft");
    expect(query(editor, "#editor-banner").hidden).toBe(true);
  });
});
