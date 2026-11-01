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
  activeSkill?: string;
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

export function validateSessionSnapshot(value: unknown): SessionSnapshot {
  if (!value || typeof value !== "object") throw new SessionPersistenceError("Session snapshot is not an object");
  const snapshot = value as Partial<SessionSnapshot>;
  if (snapshot.version !== SESSION_SNAPSHOT_VERSION) {
    throw new SessionPersistenceError(`Unsupported session snapshot version: ${String(snapshot.version)}`);
  }
  if (typeof snapshot.sessionId !== "string" || !snapshot.sessionId) {
    throw new SessionPersistenceError("Session snapshot is missing sessionId");
  }
  if (!snapshot.model || typeof snapshot.model !== "object") {
    throw new SessionPersistenceError("Session snapshot is missing model");
  }
  if (typeof snapshot.systemPrompt !== "string" || !Array.isArray(snapshot.messages)) {
    throw new SessionPersistenceError("Session snapshot has invalid transcript data");
  }
  if (typeof snapshot.savedAt !== "number" || !Number.isFinite(snapshot.savedAt)) throw new SessionPersistenceError("Session snapshot is missing savedAt");
  if (snapshot.activeSkill !== undefined && typeof snapshot.activeSkill !== "string") throw new SessionPersistenceError("Invalid active skill");
  return snapshot as SessionSnapshot;
}

export class MemorySessionStore implements SessionStore {
  private readonly snapshots = new Map<string, SessionSnapshot>();

  async load(sessionId: string): Promise<SessionSnapshot | undefined> {
    const snapshot = this.snapshots.get(sessionId);
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    const valid = validateSessionSnapshot(snapshot);
    this.snapshots.set(valid.sessionId, cloneSnapshot(valid));
  }

  async remove(sessionId: string): Promise<void> {
    this.snapshots.delete(sessionId);
  }
}
