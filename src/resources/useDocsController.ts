import { useEffect, useState } from "react";
import { DocItem } from "../types";
import { deleteDoc, listDocs, upsertDoc } from "../storage/docStore";
import { PendingLogEntry } from "../runtime/logging";
import { errorMessage } from "../utils/errors";
import { generateId } from "../utils/id";

type DocsStore = {
  list: () => Promise<DocItem[]>;
  upsert: (doc: DocItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

type UseDocsControllerArgs = {
  pushLog: (entry: PendingLogEntry) => void;
  store?: DocsStore;
};

const defaultStore: DocsStore = {
  list: listDocs,
  upsert: upsertDoc,
  remove: deleteDoc
};

export function useDocsController({ pushLog, store = defaultStore }: UseDocsControllerArgs) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docEditorId, setDocEditorId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await store.list();
        if (cancelled) return;
        setDocs(list);
        setDocsLoaded(true);
        pushLog({ category: "docs", ok: true, message: `Docs loaded: ${list.length}` });
      } catch (error) {
        if (!cancelled) {
          pushLog({ category: "docs", ok: false, message: "Docs load failed", details: errorMessage(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushLog, store]);

  useEffect(() => {
    if (docsLoaded && docEditorId && !docs.some((doc) => doc.id === docEditorId)) {
      setDocEditorId(null);
    }
  }, [docs, docEditorId, docsLoaded]);

  async function reloadDocs(preferredId?: string | null) {
    const next = await store.list();
    setDocs(next);
    if (preferredId !== undefined) {
      setDocEditorId(preferredId && next.some((doc) => doc.id === preferredId) ? preferredId : null);
    }
    return next;
  }

  async function createDoc() {
    const doc: DocItem = { id: generateId(), title: "New Doc", content: "", updatedAt: Date.now() };
    try {
      await store.upsert(doc);
      await reloadDocs(doc.id);
      pushLog({ category: "docs", ok: true, message: "Doc created", details: JSON.stringify(doc, null, 2) });
      return doc;
    } catch (error) {
      pushLog({ category: "docs", ok: false, message: "Doc create failed", details: errorMessage(error) });
      return null;
    }
  }

  async function saveDoc(doc: DocItem) {
    try {
      await store.upsert({ ...doc, updatedAt: Date.now() });
      await reloadDocs();
      pushLog({ category: "docs", ok: true, message: "Doc saved", details: JSON.stringify(doc, null, 2) });
    } catch (error) {
      pushLog({ category: "docs", ok: false, message: "Doc save failed", details: errorMessage(error) });
    }
  }

  async function removeDoc(id: string) {
    try {
      await store.remove(id);
      await reloadDocs(docEditorId === id ? null : undefined);
      pushLog({ category: "docs", ok: true, message: "Doc deleted", details: id });
    } catch (error) {
      pushLog({ category: "docs", ok: false, message: "Doc delete failed", details: errorMessage(error) });
    }
  }

  return {
    docs,
    setDocs,
    docsLoaded,
    docEditorId,
    setDocEditorId,
    reloadDocs,
    createDoc,
    saveDoc,
    removeDoc
  };
}
