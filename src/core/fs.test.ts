import "fake-indexeddb/auto";
import { initializeWorkspace } from "./workspace-bootstrap";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore, IDBIndex } from "fake-indexeddb";
import { IndexedDbFileSystem, MemoryFileSystem, resolvePath } from "./fs";

describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s filesystem", (_name, create) => {
  it("initializes an empty skills folder and Traditional Chinese rules without overwriting existing rules", async () => {
    const fs = create();
    await initializeWorkspace(fs);
    expect((await fs.listDirectory("~")).map(node => node.path)).toEqual(["/home/user/agents.md", "/home/user/skills"]);
    expect(await fs.listDirectory("~/skills")).toEqual([]);
    expect(await fs.readFile("~/agents.md")).toMatchObject({ content: "請回覆繁體中文", revision: 1 });
    await fs.writeFile("~/agents.md", "自訂規則");
    await initializeWorkspace(fs);
    expect(await fs.readFile("~/agents.md")).toMatchObject({ content: "自訂規則", revision: 2 });
    await fs.rename("~/agents.md", "~/AGENTS.md");
    await initializeWorkspace(fs);
    await expect(fs.stat("~/agents.md")).rejects.toMatchObject({ code: "not_found" });
    expect((await fs.readFile("~/AGENTS.md")).content).toBe("自訂規則");
  });

  it("separates metadata from file contents and counts UTF-8 bytes", async () => {
    const fs = create();
    const file = await fs.writeFile("~/unicode.txt", "你好🙂");
    expect(file).toMatchObject({ size: 10, kind: "file" });
    expect(file).not.toHaveProperty("content");
    expect(await fs.stat(file.path)).not.toHaveProperty("content");
    expect((await fs.listDirectory("~"))[0]).not.toHaveProperty("content");
    expect((await fs.readFile(file.path)).content).toBe("你好🙂");
    await fs.rename(file.path, "~/renamed.txt");
    expect(await fs.stat("~/renamed.txt")).toMatchObject({ size: 10, createdAt: file.createdAt, revision: 2 });
  });

  it("keeps byte accounting atomic, reclaims space and renames at a full quota", async () => {
    const fs = create(), content = "x".repeat(512 * 1024);
    await fs.writeFiles(Array.from({ length: 32 }, (_, index) => ({ path: `~/file${index}`, content })));
    await expect(fs.writeFile("~/overflow", "x")).rejects.toMatchObject({ code: "quota" });
    await expect(fs.writeFiles([{ path: "~/file0", content: "" }, { path: "~/file1", content: "", expectedRevision: 99 }])).rejects.toMatchObject({ code: "conflict" });
    await expect(fs.writeFile("~/overflow", "x")).rejects.toMatchObject({ code: "quota" });
    await fs.rename("~/file0", "~/renamed");
    expect((await fs.stat("~/renamed")).size).toBe(content.length);
    await fs.remove("~/renamed");
    await fs.writeFile("~/replacement", content);
    await fs.writeFile("~/replacement", "", { expectedRevision: 1 });
    await fs.writeFile("~/reclaimed", content);
    await expect(fs.writeFile("~/overflow", "x")).rejects.toMatchObject({ code: "quota" });
  });

  it("rejects duplicate canonical paths without partially committing", async () => {
    const fs = create();
    await expect(fs.writeFiles([{ path: "~/same", content: "one" }, { path: "~/./same", content: "two" }])).rejects.toMatchObject({ code: "invalid_batch" });
    await expect(fs.stat("~/same")).rejects.toMatchObject({ code: "not_found" });
  });

  it("resolves paths inside the virtual root and persists directories", async () => {
    const fs = create();
    await fs.mkdir("~/中文/empty", { recursive: true });
    expect((await fs.listDirectory("~/中文")).map((node) => node.kind)).toEqual(["directory"]);
    const file = await fs.writeFile("~/中文/空 白.md", "你好\nworld", { expectedRevision: 0 });
    expect((await fs.readFile(file.path)).content).toBe("你好\nworld");
    expect(resolvePath("../中文/./空 白.md", "/home/user/中文")).toBe(file.path);
    expect(resolvePath("../../secret")).toBe("/secret");
    expect(resolvePath("../../../../secret", "/")).toBe("/secret");
    await fs.mkdir("/tmp", { recursive: true });
    await fs.writeFile("/tmp/virtual", "workspace only");
    expect((await fs.readFile("/tmp/virtual")).content).toBe("workspace only");
    await expect(fs.readFile("~/中文")).rejects.toMatchObject({ code: "wrong_kind" });
    await expect(fs.remove("~/中文")).rejects.toMatchObject({ code: "not_empty" });
    await fs.rename("~/中文", "~/新目錄");
    expect((await fs.readFile("~/新目錄/空 白.md")).content).toBe("你好\nworld");
    await expect(fs.rename("~/新目錄", "~/新目錄/inside")).rejects.toThrow(/inside itself/);
  });

  it("rejects stale writes and rolls back failed mutations", async () => {
    const fs = create();
    await fs.writeFile("~/code.ts", "before", { expectedRevision: 0 });
    const results = await Promise.allSettled([
      fs.writeFile("~/code.ts", "one", { expectedRevision: 1 }),
      fs.writeFile("~/code.ts", "two", { expectedRevision: 1 })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(fs.writeFile("~/code.ts", "x".repeat(524289))).rejects.toMatchObject({ code: "quota" });
    expect((await fs.readFile("~/code.ts")).revision).toBe(2);
    await expect(fs.writeFile("~/missing/file", "data")).rejects.toMatchObject({ code: "not_found" });
    await expect(fs.writeFiles([{ path: "~/new.md", content: "partial", expectedRevision: 0 }, { path: "~/code.ts", content: "stale", expectedRevision: 1 }])).rejects.toMatchObject({ code: "conflict" });
    await expect(fs.readFile("~/new.md")).rejects.toMatchObject({ code: "not_found" });
  });
});

it("restores IndexedDB files across instances and isolates workspaces", async () => {
  const factory = new IDBFactory();
  const first = new IndexedDbFileSystem(factory, "a");
  await first.writeFile("~/document.md", "saved");
  expect((await new IndexedDbFileSystem(factory, "a").readFile("~/document.md")).content).toBe("saved");
  await expect(new IndexedDbFileSystem(factory, "b").readFile("~/document.md")).rejects.toMatchObject({ code: "not_found" });
});

it("initializes shared IndexedDB workspaces concurrently and keeps other workspaces independent", async () => {
  const factory = new IDBFactory();
  const first = new IndexedDbFileSystem(factory, "default");
  const popup = new IndexedDbFileSystem(factory, "default");
  await Promise.all([initializeWorkspace(first), initializeWorkspace(popup)]);
  expect(await popup.readFile("~/agents.md")).toMatchObject({ content: "請回覆繁體中文", revision: 1 });
  expect(await popup.listDirectory("~/skills")).toEqual([]);
  const other = new IndexedDbFileSystem(factory, "other");
  await initializeWorkspace(other);
  expect(await other.listDirectory("~/skills")).toEqual([]);
});

it("does not read file bodies or scan workspace nodes when writing or listing metadata", async () => {
  const fs = new IndexedDbFileSystem(new IDBFactory());
  const content = "x".repeat(4096);
  for (let index = 0; index < 100; index += 25) await fs.writeFiles(Array.from({ length: 25 }, (_, i) => ({ path: `~/file${index + i}`, content })));
  const bodies: string[] = [], scans: string[] = [];
  const get = IDBObjectStore.prototype.get, getAll = IDBIndex.prototype.getAll;
  const contentSpy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === "contents") bodies.push(String(key));
    return get.call(this, key);
  });
  const scanSpy = vi.spyOn(IDBIndex.prototype, "getAll").mockImplementation(function (this: IDBIndex, ...args) { scans.push(this.name); return getAll.apply(this, args); });
  try {
    await fs.writeFile("~/file0", "x", { expectedRevision: 1 });
    expect(bodies).toEqual([]); expect(scans).toEqual([]);
    expect(await fs.stat("~/file1")).toMatchObject({ size: 4096 });
    const entries = await fs.listDirectory("~");
    expect(entries).toHaveLength(100); expect(entries.every(entry => !("content" in entry))).toBe(true);
    expect(bodies).toEqual([]); expect(scans).toEqual(["parent"]);
    expect((await fs.readFile("~/file1")).content).toBe(content);
    expect(bodies).toHaveLength(1);
  } finally { contentSpy.mockRestore(); scanSpy.mockRestore(); }
});
