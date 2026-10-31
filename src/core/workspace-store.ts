import { validateSessionSnapshot, type SessionSnapshot } from "./persistence";

export const WORKSPACE_SNAPSHOT_VERSION = 1 as const;

export type WorkspaceTranscriptLine = {
  id: string;
  role: "system" | "input" | "assistant";
  text: string;
  streaming?: boolean;
  toolCallId?: string;
};

export type WorkspaceTabSnapshot = {
  id: string;
  name: string;
  branch: string;
  path: string;
  draft: string;
  transcript: WorkspaceTranscriptLine[];
  session: SessionSnapshot;
  mode?: "shell" | "agent" | "editor" | "preview";
  preview?: { entry: string; surfaceId: string };
  cwd?: string;
  agentCwd?: string;
  provider?: "scripted" | "groq";
  pendingContext?: string[];
  editor?: { path: string; content: string; revision: number };
};

export type WorkspaceSnapshot = {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  activeTabId: string;
  nextTabNumber: number;
  provider: "scripted" | "groq";
  tabs: WorkspaceTabSnapshot[];
  savedAt: number;
};

export class WorkspacePersistenceError extends Error {
  readonly code = "workspace_persistence_error" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkspacePersistenceError";
  }
}

export interface WorkspaceStore {
  load(): Promise<WorkspaceSnapshot | undefined>;
  save(snapshot: WorkspaceSnapshot): Promise<void>;
  remove(): Promise<void>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function validateWorkspaceSnapshot(snapshot: unknown): WorkspaceSnapshot {
  if (!snapshot || typeof snapshot !== "object") throw new WorkspacePersistenceError("Workspace snapshot is not an object");
  const value = snapshot as Partial<WorkspaceSnapshot>;
  if (value.version !== WORKSPACE_SNAPSHOT_VERSION) throw new WorkspacePersistenceError(`Unsupported workspace snapshot version: ${String(value.version)}`);
  if (typeof value.activeTabId !== "string" || !value.activeTabId) throw new WorkspacePersistenceError("Workspace snapshot is missing activeTabId");
  if (!Number.isInteger(value.nextTabNumber) || (value.nextTabNumber ?? 0) < 1) throw new WorkspacePersistenceError("Workspace snapshot has invalid nextTabNumber");
  if (value.provider !== "scripted" && value.provider !== "groq") throw new WorkspacePersistenceError("Workspace snapshot has invalid provider");
  if (!Array.isArray(value.tabs) || value.tabs.length === 0) throw new WorkspacePersistenceError("Workspace snapshot must contain tabs");
  if (!value.tabs.some((tab) => tab.id === value.activeTabId)) throw new WorkspacePersistenceError("Workspace activeTabId does not exist");
  const tabIds = new Set<string>();
  for (const tab of value.tabs) {
    if (!tab || typeof tab.id !== "string" || !tab.id || typeof tab.name !== "string" || typeof tab.branch !== "string" || typeof tab.path !== "string" || typeof tab.draft !== "string" || !Array.isArray(tab.transcript) || !tab.session) {
      throw new WorkspacePersistenceError("Workspace snapshot contains an invalid tab");
    }
    if (tab.mode !== undefined && !["shell", "agent", "editor", "preview"].includes(tab.mode)) throw new WorkspacePersistenceError("Invalid tab mode");
    if (tab.preview && (typeof tab.preview.entry !== "string" || !tab.preview.entry.startsWith("/home/user/") || typeof tab.preview.surfaceId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(tab.preview.surfaceId))) throw new WorkspacePersistenceError("Invalid preview configuration");
    if (tab.mode === "preview" && !tab.preview) throw new WorkspacePersistenceError("Missing preview configuration");
    for (const cwd of [tab.cwd, tab.agentCwd]) if (cwd !== undefined && (typeof cwd !== "string" || (cwd !== "/home/user" && !cwd.startsWith("/home/user/")))) throw new WorkspacePersistenceError("Invalid cwd");
    if (tab.provider !== undefined && tab.provider !== "scripted" && tab.provider !== "groq") throw new WorkspacePersistenceError("Invalid tab provider");
    if (tab.pendingContext !== undefined && (!Array.isArray(tab.pendingContext) || tab.pendingContext.some((entry) => typeof entry !== "string"))) throw new WorkspacePersistenceError("Invalid pending context");
    if (tab.editor && (typeof tab.editor.path !== "string" || typeof tab.editor.content !== "string" || !Number.isInteger(tab.editor.revision))) throw new WorkspacePersistenceError("Invalid editor draft");
    if (tabIds.has(tab.id)) throw new WorkspacePersistenceError(`Workspace contains duplicate tab id: ${tab.id}`);
    tabIds.add(tab.id);
    if (tab.session.version !== 1 || typeof tab.session.sessionId !== "string" || !tab.session.sessionId || !Array.isArray(tab.session.messages)) {
      throw new WorkspacePersistenceError(`Workspace tab ${tab.id} contains an invalid session snapshot`);
    }
    validateSessionSnapshot(tab.session);
  }
  return value as WorkspaceSnapshot;
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private snapshot?: WorkspaceSnapshot;

  async load(): Promise<WorkspaceSnapshot | undefined> {
    return this.snapshot ? clone(this.snapshot) : undefined;
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    this.snapshot = clone(validateWorkspaceSnapshot(snapshot));
  }

  async remove(): Promise<void> {
    this.snapshot = undefined;
  }
}

export class LocalStorageWorkspaceStore implements WorkspaceStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, private readonly key = "agent-go-round.workspace") {}

  async load(): Promise<WorkspaceSnapshot | undefined> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (error) {
      throw new WorkspacePersistenceError("Unable to read workspace storage", { cause: error });
    }
    if (raw === null) return undefined;
    try {
      return clone(validateWorkspaceSnapshot(JSON.parse(raw)));
    } catch (error) {
      if (error instanceof WorkspacePersistenceError) throw error;
      throw new WorkspacePersistenceError("Stored workspace snapshot is not valid JSON", { cause: error });
    }
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const valid = validateWorkspaceSnapshot(snapshot);
    try {
      this.storage.setItem(this.key, JSON.stringify(valid));
    } catch (error) {
      throw new WorkspacePersistenceError("Unable to write workspace storage", { cause: error });
    }
  }

  async remove(): Promise<void> {
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      throw new WorkspacePersistenceError("Unable to remove workspace storage", { cause: error });
    }
  }
}
