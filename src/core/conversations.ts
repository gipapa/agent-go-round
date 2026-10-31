import { validateWorkspaceSnapshot, WorkspacePersistenceError, type WorkspaceSnapshot, type WorkspaceStore, type WorkspaceTabSnapshot } from "./workspace-store";
import type { SessionEvent, SessionEventStore } from "./session";

type RecordRow = { key: string; workspace: string; id: string; value: unknown };
/** Short-lived, atomic transactions; callbacks must not await network or filesystem work. */
export class IndexedWorkspaceRecords {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory, private readonly workspace = "default", private readonly name = "agent-go-round.conversations.v1") {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("records", { keyPath: "key" }).createIndex("workspace", "workspace"); };
      request.onerror = () => { this.database = undefined; reject(new WorkspacePersistenceError(request.error?.message ?? "Cannot open conversations database")); };
      request.onblocked = () => { this.database = undefined; reject(new WorkspacePersistenceError("Close other windows to upgrade conversations database")); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.database = undefined; }; resolve(db); };
    });
  }
  async access<T>(write: boolean, operation: (records: Map<string, unknown>) => T): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", write ? "readwrite" : "readonly");
      const store = tx.objectStore("records");
      const request = store.index("workspace").getAll(this.workspace);
      let result: T, error: unknown;
      request.onsuccess = () => {
        try {
          const records = new Map((request.result as RecordRow[]).map((row) => [row.id, row.value]));
          const before = new Map(records);
          result = operation(records);
          if (write) {
            for (const id of before.keys()) if (!records.has(id)) store.delete(JSON.stringify([this.workspace, id]));
            for (const [id, value] of records) if (before.get(id) !== value) store.put({ key: JSON.stringify([this.workspace, id]), workspace: this.workspace, id, value });
          }
        } catch (failure) { error = failure; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(error ?? new WorkspacePersistenceError(tx.error?.message ?? "Conversation transaction aborted"));
      tx.onerror = () => {};
    });
  }
}

type SavedConversation = { revision: number; tab: WorkspaceTabSnapshot };
type Lease = { owner: string; expires: number };
export class IndexedDbConversationStore implements WorkspaceStore {
  private revisions = new Map<string, number>();
  private layoutRevision = 0;
  readonly writerId = crypto.randomUUID();
  constructor(readonly records: IndexedWorkspaceRecords, private readonly layoutKey = "layout") {}

  async migrate(legacy: WorkspaceStore, legacyEvents?: SessionEventStore): Promise<void> {
    if (this.layoutKey !== "layout") return;
    const needed = await this.records.access(false, (records) => !records.has(this.layoutKey) && !records.has("migration.local.v1"));
    if (!needed) return;
    const old = await legacy.load();
    if (!old) return;
    await this.records.access(true, (records) => {
      if (records.has("layout") || records.has("migration.local.v1")) return;
      const valid = validateWorkspaceSnapshot(old);
      for (const tab of valid.tabs) {
        records.set(`session:${tab.session.sessionId}`, { revision: 1, tab });
        legacyEvents?.list(tab.session.sessionId).filter((event) => event.type !== "text_delta").forEach((event, index) => records.set(`event:${tab.session.sessionId}:${String(index).padStart(12, "0")}`, event));
      }
      records.set("layout", { revision: 1, snapshot: valid });
      records.set("migration.local.v1", { migratedAt: Date.now() });
    });
  }

  async load(): Promise<WorkspaceSnapshot | undefined> {
    return this.records.access(false, (records) => {
      for (const [key, value] of records) if (key.startsWith("session:")) this.revisions.set(key.slice(8), (value as SavedConversation).revision);
      const layout = records.get(this.layoutKey) as { revision: number; snapshot: WorkspaceSnapshot } | undefined;
      this.layoutRevision = layout?.revision ?? 0;
      return layout ? structuredClone(validateWorkspaceSnapshot(layout.snapshot)) : undefined;
    });
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const valid = structuredClone(validateWorkspaceSnapshot(snapshot));
    const changes = await this.records.access(true, (records) => {
      const previous = records.get(this.layoutKey) as { revision: number } | undefined;
      if ((previous?.revision ?? 0) !== this.layoutRevision) throw new WorkspacePersistenceError("Workspace changed in another browser window; reload before saving");
      const revisions = new Map<string, number>();
      for (const tab of valid.tabs) {
        const id = tab.session.sessionId;
        const stored = records.get(`session:${id}`) as SavedConversation | undefined;
        const lease = records.get(`lease:${id}`) as Lease | undefined;
        if (lease && lease.owner !== this.writerId && lease.expires > Date.now()) throw new WorkspacePersistenceError("Conversation is running in another browser window");
        if ((stored?.revision ?? 0) !== (this.revisions.get(id) ?? 0)) throw new WorkspacePersistenceError("Conversation changed in another window; resume it again");
        const revision = (stored?.revision ?? 0) + 1;
        records.set(`session:${id}`, { revision, tab });
        revisions.set(id, revision);
      }
      const revision = this.layoutRevision + 1;
      records.set(this.layoutKey, { revision, snapshot: valid });
      return { revisions, revision };
    });
    for (const [id, revision] of changes.revisions) this.revisions.set(id, revision);
    this.layoutRevision = changes.revision;
  }

  async remember(tab: WorkspaceTabSnapshot): Promise<void> {
    const copy = structuredClone(tab);
    const id = tab.session.sessionId;
    const revision = await this.records.access(true, (records) => {
      const previous = records.get(`session:${id}`) as SavedConversation | undefined;
      const lease = records.get(`lease:${id}`) as Lease | undefined;
      if (lease && lease.owner !== this.writerId && lease.expires > Date.now()) throw new WorkspacePersistenceError("Conversation is running in another browser window");
      if ((previous?.revision ?? 0) !== (this.revisions.get(id) ?? 0)) throw new WorkspacePersistenceError("Conversation changed; resume it again before saving");
      const next = (previous?.revision ?? 0) + 1;
      records.set(`session:${id}`, { revision: next, tab: copy });
      return next;
    });
    this.revisions.set(id, revision);
  }

  async history(): Promise<WorkspaceTabSnapshot[]> {
    return this.records.access(false, (records) => [...records].filter(([key]) => key.startsWith("session:")).map(([, value]) => structuredClone((value as SavedConversation).tab)).sort((a, b) => b.session.savedAt - a.session.savedAt));
  }

  async resume(sessionId: string): Promise<WorkspaceTabSnapshot> {
    const saved = await this.records.access(false, (records) => records.get(`session:${sessionId}`) as SavedConversation | undefined);
    if (!saved) throw new WorkspacePersistenceError(`Conversation not found: ${sessionId}`);
    this.revisions.set(sessionId, saved.revision);
    return structuredClone(saved.tab);
  }

  async claim(sessionId: string): Promise<void> {
    await this.records.access(true, (records) => {
      const lease = records.get(`lease:${sessionId}`) as Lease | undefined;
      if (lease && lease.owner !== this.writerId && lease.expires > Date.now()) throw new WorkspacePersistenceError("Conversation is running in another browser window");
      const saved = records.get(`session:${sessionId}`) as SavedConversation | undefined;
      if ((saved?.revision ?? 0) !== (this.revisions.get(sessionId) ?? 0)) throw new WorkspacePersistenceError("Conversation has changed; resume it again");
      records.set(`lease:${sessionId}`, { owner: this.writerId, expires: Date.now() + 390_000 });
    });
  }
  async release(sessionId: string): Promise<void> {
    await this.records.access(true, (records) => { if ((records.get(`lease:${sessionId}`) as Lease | undefined)?.owner === this.writerId) records.delete(`lease:${sessionId}`); });
  }
  async remove(): Promise<void> { await this.records.access(true, (records) => records.delete(this.layoutKey)); this.layoutRevision = 0; }
}

export class IndexedDbSessionEventStore implements SessionEventStore {
  private events: SessionEvent[] = [];
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;
  constructor(private readonly records: IndexedWorkspaceRecords) {}
  async hydrate(): Promise<void> {
    this.events = await this.records.access(false, (records) => [...records].filter(([key]) => key.startsWith("event:")).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value as SessionEvent));
  }
  append(event: SessionEvent): void {
    // Durable transcript snapshots hold text; recovery needs lifecycle and source metadata.
    if (event.type === "text_delta") return;
    const order = this.events.filter((previous) => previous.sessionId === event.sessionId).length;
    const copy = structuredClone(event);
    this.events.push(copy);
    this.pending = this.pending.then(async () => {
      await this.records.access(true, (records) => { records.set(`event:${event.sessionId}:${String(order).padStart(12, "0")}`, copy); });
    }).catch((error) => { this.failure = error; });
  }
  list(sessionId?: string): readonly SessionEvent[] { return this.events.filter((event) => sessionId === undefined || event.sessionId === sessionId); }
  async flush(): Promise<void> { await this.pending; if (this.failure) throw this.failure; }
}
