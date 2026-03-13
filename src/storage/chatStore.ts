import { ChatMessage } from "../types";

const DB_NAME = "agr_chat_db";
const STORE = "chat_state";
const VERSION = 1;
const CURRENT_KEY = "current";

type ChatStateRecord = {
  id: string;
  messages: ChatMessage[];
  updatedAt: number;
};

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
    req.onerror = () => reject(req.error);
  });
}

export async function loadChatHistory(): Promise<ChatMessage[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(CURRENT_KEY);
    req.onsuccess = () => {
      const record = req.result as ChatStateRecord | undefined;
      resolve(Array.isArray(record?.messages) ? record!.messages : []);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: CURRENT_KEY,
      messages,
      updatedAt: Date.now()
    } satisfies ChatStateRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
