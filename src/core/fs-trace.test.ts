// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory, IDBDatabase, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { IndexedDbFileSystem, MemoryFileSystem, type FileAccess } from "./fs";

describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s transaction trace", (_name, create) => {
  it("shares storage while keeping independent and nested recorder contexts isolated", async () => {
    const root = create(); await root.writeFile("~/file", "first");
    const a: FileAccess[] = [], b: FileAccess[] = [], nested: FileAccess[] = [];
    const fa = root.withAccessRecorder(event => a.push(event)), fb = root.withAccessRecorder(event => b.push(event));
    await Promise.all([fa.appendBytes("~/file", new TextEncoder().encode(" A")), fb.appendBytes("~/file", new TextEncoder().encode(" B"))]);
    expect((await root.readFile("~/file")).content).toBe("first A B");
    expect(a.filter(event => event.path.endsWith("/file"))).toEqual([
      { method: "readBytes", path: "/home/user/file", revision: 1 }, { method: "writeBytes", path: "/home/user/file", revision: 2 }
    ]);
    expect(b.filter(event => event.path.endsWith("/file"))).toEqual([
      { method: "readBytes", path: "/home/user/file", revision: 2 }, { method: "writeBytes", path: "/home/user/file", revision: 3 }
    ]);
    a.length = 0; b.length = 0;
    await fa.withAccessRecorder(event => nested.push(event)).readFile("~/file");
    await root.writeFile("~/unrelated", "not attributed");
    expect(a).toEqual([]); expect(b).toEqual([]);
    expect(nested).toEqual([{ method: "readBytes", path: "/home/user/file", revision: 3 }]);
  });

  it("records every copied/moved file from the atomic transaction with exact revisions", async () => {
    const root = create(); await root.mkdir("~/source/nested", { recursive: true });
    await root.writeFile("~/source/a", "alpha"); await root.writeFile("~/source/nested/b", "beta");
    await root.symlink("nested/b", "~/source/link");
    const events: FileAccess[] = [], fs = root.withAccessRecorder(event => events.push(event));
    await fs.copy("~/source", "~/copy", { recursive: true });
    expect(events.filter(event => event.method === "readBytes")).toEqual(expect.arrayContaining([
      { method: "readBytes", path: "/home/user/source/a", revision: 1 }, { method: "readBytes", path: "/home/user/source/nested/b", revision: 1 }
    ]));
    expect(events.filter(event => event.method === "writeBytes")).toEqual(expect.arrayContaining([
      { method: "writeBytes", path: "/home/user/copy/a", revision: 1 }, { method: "writeBytes", path: "/home/user/copy/nested/b", revision: 1 }
    ]));
    expect(events).toContainEqual({ method: "metadataWrite", path: "/home/user/copy/link", revision: 1 });
    events.length = 0;
    await fs.rename("~/copy", "~/moved");
    expect(events).toContainEqual({ method: "remove", path: "/home/user/copy/nested/b", revision: 1 });
    expect(events).toContainEqual({ method: "writeBytes", path: "/home/user/moved/nested/b", revision: 2 });
    expect(events.every(event => !("readRange" in event))).toBe(true);
    await fs.chmod("~/moved/a", 0o600);
    expect(events).toContainEqual({ method: "metadataWrite", path: "/home/user/moved/a", revision: 3 });
  });

  it("retains actual reads but never reports rolled-back writes as committed", async () => {
    const root = create(); await root.mkdir("~/source"); await root.mkdir("~/dest/z-conflict", { recursive: true });
    await root.writeFile("~/source/first", "first"); await root.writeFile("~/source/z-conflict", "file vs directory");
    const events: FileAccess[] = [], fs = root.withAccessRecorder(event => events.push(event));
    await expect(fs.copy("~/source", "~/dest", { recursive: true })).rejects.toMatchObject({ code: "is_directory" });
    expect(events).toContainEqual({ method: "readBytes", path: "/home/user/source/first", revision: 1 });
    expect(events.some(event => ["writeBytes", "metadataWrite", "remove"].includes(event.method))).toBe(false);
    await expect(root.stat("~/dest/first")).rejects.toMatchObject({ code: "not_found" });
    await root.writeFile("~/full", "x".repeat(512 * 1024)); events.length = 0;
    await expect(fs.appendBytes("~/full", new Uint8Array([1]))).rejects.toMatchObject({ code: "quota" });
    expect(events).toEqual([{ method: "readBytes", path: "/home/user/full", revision: 1 }]);
  });
});

it("traced stat/list/overwrite do not load file bodies; a delayed completion retains its own revision", async () => {
  const root = new IndexedDbFileSystem(new IDBFactory()); await root.writeFile("~/file", "one");
  const events: FileAccess[] = [], fs = root.withAccessRecorder(event => events.push(event));
  const get = IDBObjectStore.prototype.get, bodies: string[] = [];
  const spy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === "contents") bodies.push(String(key)); return get.call(this, key);
  });
  try {
    await fs.stat("~/file"); await fs.listDirectory("~"); await fs.writeFile("~/file", "two");
    expect(bodies).toEqual([]);
    expect(events.some(event => event.method === "readBytes")).toBe(false);
    expect(events).toContainEqual({ method: "writeBytes", path: "/home/user/file", revision: 2 });
  } finally { spy.mockRestore(); }

  let committed!: () => void, release!: () => void;
  const didCommit = new Promise<void>(resolve => { committed = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let delay = true;
  const original = IDBDatabase.prototype.transaction;
  const delayed = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
    const tx = original.apply(this, args);
    if (delay && args[1] === "readwrite") {
      delay = false;
      let complete: ((event: Event) => void) | undefined;
      Object.defineProperty(tx, "oncomplete", { configurable: true, get: () => null, set: handler => { complete = handler; } });
      tx.addEventListener("complete", event => { committed(); void gate.then(() => complete?.(event)); });
    }
    return tx;
  });
  try {
    events.length = 0;
    const pending = fs.writeFile("~/file", "three");
    await didCommit;
    expect((await root.readFile("~/file")).content).toBe("three");
    expect(events).toEqual([]); // Storage completion has not been delivered yet.
    await root.writeFile("~/file", "other tab");
    release(); await pending;
    expect((await root.stat("~/file")).revision).toBe(4);
    expect(events).toEqual([{ method: "writeBytes", path: "/home/user/file", revision: 3 }]);
  } finally { release(); delayed.mockRestore(); }
});
