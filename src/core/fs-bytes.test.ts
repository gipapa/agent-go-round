// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { IndexedDbFileSystem, MemoryFileSystem, VFS_DATABASE } from "./fs";

const utf8 = (text: string) => new TextEncoder().encode(text);
describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s byte filesystem", (_name, create) => {
  it("round trips every byte without aliasing buffers or silently decoding binary", async () => {
    const fs = create(), original = Uint8Array.from({ length: 256 }, (_, index) => index);
    const input = original.slice();
    const saved = fs.writeBytes("~/binary", input); input.fill(0);
    expect(await saved).toMatchObject({ size: 256, mode: 0o644 });
    expect((await fs.readBytes("~/binary")).content).toEqual(original);
    const output = await fs.readBytes("~/binary"); output.content.fill(0);
    expect((await fs.readBytes("~/binary")).content).toEqual(original);
    await expect(fs.readFile("~/binary")).rejects.toMatchObject({ code: "invalid_encoding" });
    await fs.writeFile("~/text", "\uFEFF世界🙂");
    expect((await fs.readFile("~/text")).content).toBe("\uFEFF世界🙂");
    expect((await fs.readBytes("~/text")).size).toBe(13);
  });

  it("appends atomically, enforces revisions and rolls quota failures back", async () => {
    const fs = create();
    await fs.writeBytes("~/log", utf8("start\n"));
    await Promise.all(Array.from({ length: 30 }, (_, index) => fs.appendBytes("~/log", utf8(`${index}\n`))));
    const log = await fs.readFile("~/log");
    expect(new Set(log.content.trim().split("\n"))).toEqual(new Set(["start", ...Array.from({ length: 30 }, (_, i) => String(i))]));
    expect(log.revision).toBe(31);
    await expect(fs.appendBytes("~/log", utf8("stale"), { expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
    await fs.writeBytes("~/full", new Uint8Array(512 * 1024));
    await expect(fs.appendBytes("~/full", new Uint8Array([1]))).rejects.toMatchObject({ code: "quota" });
    expect(await fs.stat("~/full")).toMatchObject({ size: 512 * 1024, revision: 1 });
    expect((await fs.readFile("~/log")).content).toBe(log.content);
  });

  it("creates exclusively with mode already applied, including dangling link collisions", async () => {
    const fs = create();
    const outcomes = await Promise.allSettled([fs.createExclusive("~/private", { mode: 0o600 }), fs.createExclusive("~/private", { mode: 0o700 })]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "exists" } });
    expect(await fs.stat("~/private")).toMatchObject({ mode: 0o600, size: 0, revision: 1 });
    await fs.createExclusive("~/private-dir", { mode: 0o700, directory: true });
    expect(await fs.stat("~/private-dir")).toMatchObject({ kind: "directory", mode: 0o700 });
    await fs.symlink("missing", "~/dangling");
    await expect(fs.createExclusive("~/dangling", { mode: 0o600 })).rejects.toMatchObject({ code: "exists" });
    await expect(fs.stat("~/missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("atomically removes a known file pair and preserves both when either revision changed", async () => {
    const fs = create();
    await fs.writeFile("~/tool.js", "original source");
    await fs.writeFile("~/tool.json", "original manifest");
    const files = [{ path: "~/tool.js", expectedRevision: 1, expectedContent: "original source" }, { path: "~/tool.json", expectedRevision: 1, expectedContent: "original manifest" }];
    await fs.writeFile("~/tool.json", "custom manifest");
    await expect(fs.removeFiles(files)).rejects.toMatchObject({ code: "conflict" });
    expect((await fs.readFile("~/tool.js")).content).toBe("original source");
    expect((await fs.readFile("~/tool.json")).content).toBe("custom manifest");
    await fs.remove("~/tool.json");
    await fs.writeFile("~/tool.json", "recreated custom manifest");
    await expect(fs.removeFiles(files)).rejects.toMatchObject({ code: "conflict" });
    expect((await fs.readFile("~/tool.js")).content).toBe("original source");
    await fs.removeFiles([{ ...files[0] }, { ...files[1], expectedContent: "recreated custom manifest" }]);
    await expect(fs.stat("~/tool.js")).rejects.toMatchObject({ code: "not_found" });
    await expect(fs.stat("~/tool.json")).rejects.toMatchObject({ code: "not_found" });
  });

  it("stores mode and times and distinguishes metadata changes from content modification", async () => {
    const fs = create();
    await fs.writeBytes("~/file", utf8("body"), { mode: 0o600 });
    await fs.utimes("~/file", 123, 456);
    const changed = await fs.chmod("~/file", 0o755);
    expect(changed).toMatchObject({ atime: 123, mtime: 456, mode: 0o755, revision: 3 });
    await fs.readFile("~/file");
    expect(await fs.stat("~/file")).toEqual(changed);
    await fs.appendBytes("~/file", utf8("!"));
    expect(await fs.stat("~/file")).toMatchObject({ mode: 0o755, revision: 4, size: 5 });
    expect((await fs.stat("~/file")).mtime).toBeGreaterThan(456);
  });

  it("updates parent directory times for entry changes and preserves a moved tree's times", async () => {
    const fs = create(); let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await fs.mkdir("~/directory");
      now = 2000; await fs.writeFile("~/directory/file", "one");
      expect((await fs.stat("~/directory")).mtime).toBe(2000);
      now = 3000; await fs.writeFile("~/directory/file", "two");
      expect((await fs.stat("~/directory")).mtime).toBe(2000);
      now = 4000; await fs.mkdir("~/directory/nested");
      now = 5000; await fs.rename("~/directory", "~/moved");
      expect((await fs.stat("~/moved")).mtime).toBe(4000);
      expect((await fs.stat("~/moved/nested")).mtime).toBe(4000);
      expect((await fs.stat("~")).mtime).toBe(5000);
      now = 6000; await fs.remove("~/moved/file");
      expect((await fs.stat("~/moved")).mtime).toBe(6000);
    } finally { clock.mockRestore(); }
  });

  it("resolves intermediate, relative, absolute, dangling and cyclic symbolic links", async () => {
    const fs = create();
    await fs.mkdir("~/real/nested", { recursive: true });
    await fs.writeFile("~/real/file", "original");
    await fs.symlink("real/nested", "~/dir-link");
    expect((await fs.readFile("~/dir-link/../file")).content).toBe("original");
    await fs.symlink("/home/user/real/file", "~/absolute");
    expect(await fs.realpath("~/absolute")).toBe("/home/user/real/file");
    expect(await fs.lstat("~/absolute")).toMatchObject({ kind: "symlink", target: "/home/user/real/file" });
    await fs.writeFile("~/absolute", "through link");
    expect((await fs.readFile("~/real/file")).content).toBe("through link");
    await fs.symlink("future", "~/dangling");
    await fs.writeBytes("~/dangling", new Uint8Array([0, 255]));
    expect((await fs.readBytes("~/future")).content).toEqual(new Uint8Array([0, 255]));
    await fs.symlink("cycle-b", "~/cycle-a"); await fs.symlink("cycle-a", "~/cycle-b");
    await expect(fs.stat("~/cycle-a")).rejects.toMatchObject({ code: "symlink_loop" });
    await fs.remove("~/dir-link", { recursive: true });
    expect((await fs.readFile("~/real/file")).content).toBe("through link");
    await expect(fs.stat("~/real/file/child")).rejects.toMatchObject({ code: "not_directory" });
    await expect(fs.stat("~/real/file/")).rejects.toMatchObject({ code: "not_directory" });
    await expect(fs.writeFile("~/missing-trailing/", "no")).rejects.toMatchObject({ code: "not_found" });
    await fs.createExclusive("~/trailing-dir/", { directory: true, mode: 0o700 });
    expect(await fs.stat("~/trailing-dir/")).toMatchObject({ kind: "directory", mode: 0o700 });
  });

  it("copies and moves subtrees atomically and replaces only compatible destinations", async () => {
    const fs = create();
    await fs.mkdir("~/source/nested", { recursive: true });
    await fs.writeBytes("~/source/nested/binary", new Uint8Array([0, 255]));
    await fs.symlink("nested/binary", "~/source/link");
    await expect(fs.copy("~/source", "~/copied")).rejects.toMatchObject({ code: "is_directory" });
    await fs.copy("~/source", "~/copied", { recursive: true });
    expect(await fs.readlink("~/copied/link")).toBe("nested/binary");
    expect((await fs.readBytes("~/copied/link")).content).toEqual(new Uint8Array([0, 255]));
    await fs.rename("~/copied", "~/moved");
    expect((await fs.readBytes("~/moved/link")).content).toEqual(new Uint8Array([0, 255]));
    await expect(fs.stat("~/copied")).rejects.toMatchObject({ code: "not_found" });
    await fs.writeFile("~/destination", "old");
    await fs.rename("~/moved/nested/binary", "~/destination", { replace: true });
    expect((await fs.readBytes("~/destination")).content).toEqual(new Uint8Array([0, 255]));
    await expect(fs.rename("~/source", "~/destination", { replace: true })).rejects.toMatchObject({ code: "not_directory" });
    await expect(fs.rename("~/source", "~/moved", { replace: true })).rejects.toMatchObject({ code: "not_empty" });
    await fs.mkdir("~/empty"); await fs.rename("~/source", "~/empty", { replace: true });
    expect((await fs.readBytes("~/empty/link")).content).toEqual(new Uint8Array([0, 255]));
    await fs.remove("~/empty", { recursive: true });
    await expect(fs.stat("~/empty")).rejects.toMatchObject({ code: "not_found" });
    await expect(fs.remove("/home", { recursive: true })).rejects.toMatchObject({ code: "protected" });
  });

  it("rolls a directory copy back when a later entry conflicts or exceeds workspace quota", async () => {
    const fs = create();
    await fs.mkdir("~/source"); await fs.mkdir("~/target/conflict", { recursive: true });
    await fs.writeFile("~/source/a", "would be copied"); await fs.writeFile("~/source/conflict", "file");
    await expect(fs.copy("~/source", "~/target", { recursive: true })).rejects.toMatchObject({ code: "is_directory" });
    await expect(fs.stat("~/target/a")).rejects.toMatchObject({ code: "not_found" });
    await fs.writeByteFiles(Array.from({ length: 32 }, (_, i) => ({ path: `~/full-${i}`, content: new Uint8Array(i === 0 ? 512 * 1024 - 100 : 512 * 1024) })));
    await expect(fs.copy("~/full-1", "~/overflow")).rejects.toMatchObject({ code: "quota" });
    await expect(fs.stat("~/overflow")).rejects.toMatchObject({ code: "not_found" });
    await fs.rename("~/full-1", "~/renamed");
    expect((await fs.stat("~/renamed")).size).toBe(512 * 1024);
  });
});

it("serializes append and exclusive creation across independent IndexedDB instances", async () => {
  const factory = new IDBFactory(), a = new IndexedDbFileSystem(factory, "shared"), b = new IndexedDbFileSystem(factory, "shared");
  await Promise.all(Array.from({ length: 80 }, (_, i) => (i % 2 ? a : b).appendBytes("~/log", utf8(`${i}\n`))));
  const reopened = new IndexedDbFileSystem(factory, "shared"), file = await reopened.readFile("~/log");
  expect(new Set(file.content.trim().split("\n"))).toEqual(new Set(Array.from({ length: 80 }, (_, i) => String(i))));
  expect(file.revision).toBe(80);
  const exclusive = await Promise.allSettled([a.createExclusive("~/once", { mode: 0o600 }), b.createExclusive("~/once", { mode: 0o600 })]);
  expect(exclusive.filter(result => result.status === "fulfilled")).toHaveLength(1);
  await a.symlink("log", "~/link"); await a.chmod("~/log", 0o700); await a.utimes("~/log", 10, 20);
  expect(await reopened.stat("~/link")).toMatchObject({ mode: 0o700, mtime: 20, atime: 10 });
  await expect(new IndexedDbFileSystem(factory, "other").readBytes("~/log")).rejects.toMatchObject({ code: "not_found" });
});

it("reads only the appended file body and keeps stat/list entirely in metadata", async () => {
  const fs = new IndexedDbFileSystem(new IDBFactory());
  await fs.writeFile("~/target", "first"); await fs.writeFile("~/unrelated", "other");
  const reads: string[] = [], get = IDBObjectStore.prototype.get;
  const spy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === "contents") reads.push(String(key)); return get.call(this, key);
  });
  try {
    await fs.stat("~/target"); await fs.listDirectory("~"); await fs.writeFile("~/unrelated", "updated");
    expect(reads).toEqual([]);
    await fs.appendBytes("~/target", utf8(" second"));
    expect(reads).toEqual([JSON.stringify(["default", "/home/user/target"])]);
  } finally { spy.mockRestore(); }
});

it("uses an explicit new database without opening or clearing the legacy text database", async () => {
  const factory = new IDBFactory();
  const open = vi.spyOn(factory, "open");
  await new IndexedDbFileSystem(factory).writeBytes("~/new", utf8("bytes"));
  expect(open.mock.calls.map(call => call[0])).toEqual([VFS_DATABASE]);
  expect(VFS_DATABASE).not.toBe("agent-go-round.vfs");
});
