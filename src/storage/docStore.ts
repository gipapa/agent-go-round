import { DocItem } from "../types";

const DB_NAME = "agr_docs_db";
const STORE = "docs";
const VERSION = 1;

function idbError(label: string, error: DOMException | null) {
  return new Error(`${label}: ${error?.message ?? "unknown IndexedDB error"}`);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(idbError("open docs db failed", req.error));
  });
}

export async function listDocs(): Promise<DocItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.getAll();
    req.onsuccess = () => {
      const items = (req.result as DocItem[]).sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(items);
    };
    req.onerror = () => reject(idbError("list docs failed", req.error));
    tx.onabort = () => reject(idbError("list docs transaction aborted", tx.error));
  });
}

export async function upsertDoc(doc: DocItem): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(doc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(idbError("save doc failed", tx.error));
    tx.onabort = () => reject(idbError("save doc transaction aborted", tx.error));
  });
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(idbError("delete doc failed", tx.error));
    tx.onabort = () => reject(idbError("delete doc transaction aborted", tx.error));
  });
}
