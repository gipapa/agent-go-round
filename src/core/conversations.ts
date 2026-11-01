import { validateWorkspaceSnapshot, WorkspacePersistenceError, type WorkspaceSnapshot, type WorkspaceTabSnapshot } from "./workspace-store";
import type { SessionEvent, SessionEventStore } from "./session";

export const CONVERSATIONS_DATABASE = "agent-go-round.sessions";
type RecordRow<T> = { key: string; workspace: string; id: string; value: T };
export interface WorkspaceRecordTransaction {
  get<T>(id: string): Promise<T | undefined>;
  set(id: string, value: unknown): Promise<void>;
  delete(id: string): Promise<void>;
  list<T>(prefix: string): Promise<Array<{ id: string; value: T }>>;
}
function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
}
/** Callbacks only await these database operations, never network or UI work. */
export class IndexedWorkspaceRecords {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory, private readonly workspace = "default") {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const opening = this.factory.open(CONVERSATIONS_DATABASE, 1);
      opening.onupgradeneeded = () => { opening.result.createObjectStore("records", { keyPath: "key" }).createIndex("byId", ["workspace", "id"]); };
      opening.onerror = () => { this.database = undefined; reject(new WorkspacePersistenceError(opening.error?.message ?? "Cannot open conversations database")); };
      opening.onblocked = () => { this.database = undefined; reject(new WorkspacePersistenceError("Close other windows to open conversations database")); };
      opening.onsuccess = () => { const db = opening.result; db.onversionchange = () => { db.close(); this.database = undefined; }; resolve(db); };
    });
  }
  async transaction<T>(write: boolean, operation: (records: WorkspaceRecordTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", write ? "readwrite" : "readonly"), store = tx.objectStore("records");
      const key = (id: string) => JSON.stringify([this.workspace, id]);
      let result: T, failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new WorkspacePersistenceError(tx.error?.message ?? "Conversation transaction aborted"));
      tx.onerror = () => {};
      void operation({
        get: async <T>(id: string) => (await request(store.get(key(id))) as RecordRow<T> | undefined)?.value,
        set: async (id, value) => { await request(store.put({ key: key(id), workspace: this.workspace, id, value })); },
        delete: async id => { await request(store.delete(key(id))); },
        list: async <T>(prefix: string) => {
          const range = IDBKeyRange.bound([this.workspace, prefix], [this.workspace, prefix + "\uffff"]);
          return (await request(store.index("byId").getAll(range)) as RecordRow<T>[]).map(({ id, value }) => ({ id, value }));
        }
      }).then(value => { result = value; }).catch(error => { failure = error; tx.abort(); });
    });
  }
}

type SavedConversation = { revision: number; tab: WorkspaceTabSnapshot };
type SavedLayout = { revision: number; snapshot: WorkspaceSnapshot };
type Lease = { owner: string; expires: number };
export class IndexedDbConversationStore {
  private revisions = new Map<string, number>();
  private layoutRevision = 0;
  readonly writerId = crypto.randomUUID();
  constructor(readonly records: IndexedWorkspaceRecords, private readonly layoutKey = "layout") {}
  async load(): Promise<WorkspaceSnapshot | undefined> {
    return this.records.transaction(false, async records => {
      const layout = await records.get<SavedLayout>(this.layoutKey);
      this.layoutRevision = layout?.revision ?? 0;
      if (!layout) return undefined;
      const snapshot = validateWorkspaceSnapshot(layout.snapshot);
      for (const tab of snapshot.tabs) {
        const id = tab.session.sessionId;
        this.revisions.set(id, (await records.get<SavedConversation>(`session:${id}`))?.revision ?? 0);
      }
      return snapshot;
    });
  }
  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const valid = structuredClone(validateWorkspaceSnapshot(snapshot));
    const changes = await this.records.transaction(true, async records => {
      const previous = await records.get<SavedLayout>(this.layoutKey);
      if ((previous?.revision ?? 0) !== this.layoutRevision) throw new WorkspacePersistenceError("Workspace changed in another browser window; reload before saving");
      const revisions = new Map<string, number>();
      for (const tab of valid.tabs) {
        const id = tab.session.sessionId;
        await this.checkWriter(records, id);
        const revision = (this.revisions.get(id) ?? 0) + 1;
        await records.set(`session:${id}`, { revision, tab }); revisions.set(id, revision);
      }
      const revision = this.layoutRevision + 1;
      await records.set(this.layoutKey, { revision, snapshot: valid });
      return { revisions, revision };
    });
    for (const [id, revision] of changes.revisions) this.revisions.set(id, revision);
    this.layoutRevision = changes.revision;
  }
  private async checkWriter(records: WorkspaceRecordTransaction, id: string): Promise<void> {
    const lease = await records.get<Lease>(`lease:${id}`);
    if (lease && lease.owner !== this.writerId && lease.expires > Date.now()) throw new WorkspacePersistenceError("Conversation is running in another browser window");
    const saved = await records.get<SavedConversation>(`session:${id}`);
    if ((saved?.revision ?? 0) !== (this.revisions.get(id) ?? 0)) throw new WorkspacePersistenceError("Conversation changed in another window; resume it again");
  }
  async remember(tab: WorkspaceTabSnapshot): Promise<void> {
    const copy = structuredClone(tab), id = tab.session.sessionId;
    const revision = await this.records.transaction(true, async records => {
      await this.checkWriter(records, id);
      const next = (this.revisions.get(id) ?? 0) + 1;
      await records.set(`session:${id}`, { revision: next, tab: copy }); return next;
    });
    this.revisions.set(id, revision);
  }
  async history(): Promise<WorkspaceTabSnapshot[]> {
    return this.records.transaction(false, async records => (await records.list<SavedConversation>("session:")).map(row => row.value.tab).sort((a, b) => b.session.savedAt - a.session.savedAt));
  }
  async resume(sessionId: string): Promise<WorkspaceTabSnapshot> {
    const saved = await this.records.transaction(false, records => records.get<SavedConversation>(`session:${sessionId}`));
    if (!saved) throw new WorkspacePersistenceError(`Conversation not found: ${sessionId}`);
    this.revisions.set(sessionId, saved.revision); return saved.tab;
  }
  async claim(sessionId: string): Promise<void> {
    await this.records.transaction(true, async records => {
      await this.checkWriter(records, sessionId);
      await records.set(`lease:${sessionId}`, { owner: this.writerId, expires: Date.now() + 390_000 });
    });
  }
  async release(sessionId: string): Promise<void> {
    await this.records.transaction(true, async records => { if ((await records.get<Lease>(`lease:${sessionId}`))?.owner === this.writerId) await records.delete(`lease:${sessionId}`); });
  }
  async remove(): Promise<void> { await this.records.transaction(true, records => records.delete(this.layoutKey)); this.layoutRevision = 0; }
}

export class IndexedDbSessionEventStore implements SessionEventStore {
  private events: SessionEvent[] = [];
  private counts = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;
  constructor(private readonly records: IndexedWorkspaceRecords) {}
  async hydrate(): Promise<void> {
    this.events = await this.records.transaction(false, async records => (await records.list<SessionEvent>("event:")).map(row => row.value));
    this.counts.clear();
    for (const event of this.events) this.counts.set(event.sessionId, (this.counts.get(event.sessionId) ?? 0) + 1);
  }
  append(event: SessionEvent): void {
    if (event.type === "text_delta") return;
    const order = this.counts.get(event.sessionId) ?? 0;
    this.counts.set(event.sessionId, order + 1);
    const copy = structuredClone(event); this.events.push(copy);
    this.pending = this.pending.then(() => this.records.transaction(true, records => records.set(`event:${event.sessionId}:${String(order).padStart(12, "0")}`, copy))).catch(error => { this.failure = error; });
  }
  list(sessionId?: string): readonly SessionEvent[] { return this.events.filter(event => sessionId === undefined || event.sessionId === sessionId); }
  async flush(): Promise<void> { await this.pending; if (this.failure) throw this.failure; }
}
