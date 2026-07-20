import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDocsController } from "../resources/useDocsController";
import { DocItem } from "../types";

function createStore(initial: DocItem[] = []) {
  let docs = initial.slice();
  return {
    list: vi.fn(async () => docs.slice()),
    upsert: vi.fn(async (doc: DocItem) => {
      docs = docs.some((item) => item.id === doc.id)
        ? docs.map((item) => item.id === doc.id ? doc : item)
        : [...docs, doc];
    }),
    remove: vi.fn(async (id: string) => {
      docs = docs.filter((doc) => doc.id !== id);
    })
  };
}

describe("docs controller", () => {
  it("loads docs and reports the restored count", async () => {
    const existing: DocItem = { id: "doc-1", title: "Existing", content: "text", updatedAt: 1 };
    const store = createStore([existing]);
    const pushLog = vi.fn();
    const { result } = renderHook(() => useDocsController({ pushLog, store }));

    await waitFor(() => expect(result.current.docsLoaded).toBe(true));
    expect(result.current.docs).toEqual([existing]);
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ message: "Docs loaded: 1", ok: true }));
  });

  it("creates, saves, and removes docs while keeping editor selection valid", async () => {
    const store = createStore();
    const pushLog = vi.fn();
    const { result } = renderHook(() => useDocsController({ pushLog, store }));
    await waitFor(() => expect(result.current.docsLoaded).toBe(true));

    let created: DocItem | null = null;
    await act(async () => {
      created = await result.current.createDoc();
    });
    expect(created).not.toBeNull();
    expect(result.current.docEditorId).toBe(created!.id);
    expect(result.current.docs).toHaveLength(1);

    await act(async () => result.current.saveDoc({ ...created!, title: "Renamed" }));
    expect(result.current.docs[0].title).toBe("Renamed");

    await act(async () => result.current.removeDoc(created!.id));
    expect(result.current.docs).toEqual([]);
    expect(result.current.docEditorId).toBeNull();
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ message: "Doc deleted", ok: true }));
  });

  it("clears a stale editor selection after external reload", async () => {
    const existing: DocItem = { id: "doc-1", title: "Existing", content: "text", updatedAt: 1 };
    const store = createStore([existing]);
    const pushLog = vi.fn();
    const { result } = renderHook(() => useDocsController({ pushLog, store }));
    await waitFor(() => expect(result.current.docsLoaded).toBe(true));
    act(() => result.current.setDocEditorId(existing.id));

    store.list.mockResolvedValueOnce([]);
    await act(async () => result.current.reloadDocs());
    await waitFor(() => expect(result.current.docEditorId).toBeNull());
  });

  it("logs storage failures without leaking rejected operations", async () => {
    const store = createStore();
    store.upsert.mockRejectedValueOnce(new Error("write failed"));
    const pushLog = vi.fn();
    const { result } = renderHook(() => useDocsController({ pushLog, store }));
    await waitFor(() => expect(result.current.docsLoaded).toBe(true));

    let created: DocItem | null | undefined;
    await act(async () => {
      created = await result.current.createDoc();
    });
    expect(created).toBeNull();
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ message: "Doc create failed", details: "write failed" }));
  });
});
