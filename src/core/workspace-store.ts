import { validateSessionSnapshot, type SessionSnapshot } from "./persistence";

export const WORKSPACE_SNAPSHOT_VERSION = 1 as const;

export type WorkspaceTranscriptLine = {
  id: string;
  role: "system" | "input" | "assistant";
  text: string;
  streaming?: boolean;
  toolCallId?: string;
  channel?: "stdout" | "stderr" | "exit";
};

export type WorkspaceTabSnapshot = {
  id: string;
  name: string;
  branch: string;
  path: string;
  draft: string;
  transcript: WorkspaceTranscriptLine[];
  session: SessionSnapshot;
  mode?: "shell" | "agent" | "preview";
  preview?: { entry: string; surfaceId: string };
  cwd?: string;
  agentCwd?: string;
  provider?: "scripted" | "groq";
  pendingContext?: string[];
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
    // Preserve conversation history when reopening a legacy editor layout;
    // the removed editor surface/draft is not restored or executed.
    if ((tab.mode as string) === "editor") tab.mode = "shell";
    if (tab.mode !== undefined && !["shell", "agent", "preview"].includes(tab.mode)) throw new WorkspacePersistenceError("Invalid tab mode");
    if (tab.preview && (typeof tab.preview.entry !== "string" || !tab.preview.entry.startsWith("/home/user/") || typeof tab.preview.surfaceId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(tab.preview.surfaceId))) throw new WorkspacePersistenceError("Invalid preview configuration");
    if (tab.mode === "preview" && !tab.preview) throw new WorkspacePersistenceError("Missing preview configuration");
    for (const cwd of [tab.cwd, tab.agentCwd]) if (cwd !== undefined && (typeof cwd !== "string" || !cwd.startsWith("/") || cwd.includes("\0") || cwd.length > 4096 || cwd.split("/").some(part => part === "." || part === ".."))) throw new WorkspacePersistenceError("Invalid cwd");
    if (tab.provider !== undefined && tab.provider !== "scripted" && tab.provider !== "groq") throw new WorkspacePersistenceError("Invalid tab provider");
    if (tab.pendingContext !== undefined && (!Array.isArray(tab.pendingContext) || tab.pendingContext.some((entry) => typeof entry !== "string"))) throw new WorkspacePersistenceError("Invalid pending context");
    if (tabIds.has(tab.id)) throw new WorkspacePersistenceError(`Workspace contains duplicate tab id: ${tab.id}`);
    tabIds.add(tab.id);
    validateSessionSnapshot(tab.session);
  }
  return value as WorkspaceSnapshot;
}
