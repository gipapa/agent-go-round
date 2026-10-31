// @vitest-environment node
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbFileSystem, MemoryFileSystem, resolvePath } from "./fs";

describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s filesystem", (_name, create) => {
  it("resolves home and relative paths, persists directories, and rejects escapes", async () => {
    const fs = create();
    await fs.mkdir("~/中文/empty", { recursive: true });
    expect((await fs.listDirectory("~/中文")).map((node) => node.kind)).toEqual(["directory"]);
    const file = await fs.writeFile("~/中文/空 白.md", "你好\nworld", { expectedRevision: 0 });
    expect((await fs.readFile(file.path)).content).toBe("你好\nworld");
    expect(resolvePath("../中文/./空 白.md", "/home/user/中文")).toBe(file.path);
    expect(() => resolvePath("../../secret")).toThrow(/inside/);
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

it("upgrades existing IndexedDB files without losing content or creation metadata", async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const request = factory.open("legacy-files", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("nodes", { keyPath: "key" }).createIndex("workspace", "workspace"); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("nodes", "readwrite");
      for (const node of [{ path: "/home/user", kind: "directory", content: "", revision: 1, updatedAt: 10 }, { path: "/home/user/legacy.md", kind: "file", content: "keep me", revision: 3, updatedAt: 20 }]) tx.objectStore("nodes").put({ key: JSON.stringify(["default", node.path]), workspace: "default", node });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  });
  const fs = new IndexedDbFileSystem(factory, "default", "legacy-files");
  expect((await fs.readFile("~/legacy.md"))).toMatchObject({ content: "keep me", revision: 3, createdAt: 20 });
  expect((await fs.listDirectory("~")).map((node) => node.path)).toEqual(["/home/user/legacy.md"]);
});

it("restores IndexedDB files across instances and isolates workspaces", async () => {
  const factory = new IDBFactory();
  const first = new IndexedDbFileSystem(factory, "a");
  await first.writeFile("~/document.md", "saved");
  expect((await new IndexedDbFileSystem(factory, "a").readFile("~/document.md")).content).toBe("saved");
  await expect(new IndexedDbFileSystem(factory, "b").readFile("~/document.md")).rejects.toMatchObject({ code: "not_found" });
});
