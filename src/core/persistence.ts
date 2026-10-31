import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

export const SESSION_SNAPSHOT_VERSION = 1 as const;

export type SessionSnapshot = {
  version: typeof SESSION_SNAPSHOT_VERSION;
  sessionId: string;
  model: Model<any>;
  systemPrompt: string;
  messages: AgentMessage[];
  savedAt: number;
};

export class SessionPersistenceError extends Error {
  readonly code = "session_persistence_error" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionPersistenceError";
  }
}

export interface SessionStore {
  load(sessionId: string): Promise<SessionSnapshot | undefined>;
  save(snapshot: SessionSnapshot): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SessionSnapshot;
}

function validateSnapshot(value: unknown, expectedSessionId?: string): SessionSnapshot {
  if (!value || typeof value !== "object") throw new SessionPersistenceError("Session snapshot is not an object");
  const snapshot = value as Partial<SessionSnapshot>;
  if (snapshot.version !== SESSION_SNAPSHOT_VERSION) {
    throw new SessionPersistenceError(`Unsupported session snapshot version: ${String(snapshot.version)}`);
  }
  if (typeof snapshot.sessionId !== "string" || !snapshot.sessionId) {
    throw new SessionPersistenceError("Session snapshot is missing sessionId");
  }
  if (expectedSessionId !== undefined && snapshot.sessionId !== expectedSessionId) {
    throw new SessionPersistenceError(`Session snapshot identity mismatch: expected ${expectedSessionId}`);
  }
  if (!snapshot.model || typeof snapshot.model !== "object") {
    throw new SessionPersistenceError("Session snapshot is missing model");
  }
  if (typeof snapshot.systemPrompt !== "string" || !Array.isArray(snapshot.messages)) {
    throw new SessionPersistenceError("Session snapshot has invalid transcript data");
  }
  return snapshot as SessionSnapshot;
}

export class MemorySessionStore implements SessionStore {
  private readonly snapshots = new Map<string, SessionSnapshot>();

  async load(sessionId: string): Promise<SessionSnapshot | undefined> {
    const snapshot = this.snapshots.get(sessionId);
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    const valid = validateSnapshot(snapshot);
    this.snapshots.set(valid.sessionId, cloneSnapshot(valid));
  }

  async remove(sessionId: string): Promise<void> {
    this.snapshots.delete(sessionId);
  }
}

export class LocalStorageSessionStore implements SessionStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, private readonly keyPrefix = "agent-go-round.session.") {}

  async load(sessionId: string): Promise<SessionSnapshot | undefined> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key(sessionId));
    } catch (error) {
      throw new SessionPersistenceError("Unable to read session storage", { cause: error });
    }
    if (raw === null) return undefined;
    try {
      return validateSnapshot(JSON.parse(raw), sessionId);
    } catch (error) {
      if (error instanceof SessionPersistenceError) throw error;
      throw new SessionPersistenceError("Stored session snapshot is not valid JSON", { cause: error });
    }
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    const valid = validateSnapshot(snapshot);
    try {
      this.storage.setItem(this.key(valid.sessionId), JSON.stringify(valid));
    } catch (error) {
      throw new SessionPersistenceError("Unable to write session storage", { cause: error });
    }
  }

  async remove(sessionId: string): Promise<void> {
    try {
      this.storage.removeItem(this.key(sessionId));
    } catch (error) {
      throw new SessionPersistenceError("Unable to remove session storage", { cause: error });
    }
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${encodeURIComponent(sessionId)}`;
  }
}
