import { afterEach, expect, it, vi } from "vitest";
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
  expect(editor.element.querySelector<HTMLInputElement>("#editor-path")!.value).toBe("~/main.html");
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
