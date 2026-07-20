import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSkillsController } from "../resources/useSkillsController";
import { SkillConfig, SkillDocItem, SkillFileItem } from "../types";

function skill(id: string, name = id): SkillConfig {
  return {
    id,
    name,
    version: "1.0.0",
    description: "",
    workflow: {},
    skillMarkdown: `# ${name}`,
    rootPath: name,
    fileCount: 1,
    docCount: 0,
    scriptCount: 0,
    assetCount: 0,
    updatedAt: 1
  };
}

function createStore(initial: SkillConfig[] = []) {
  let skills = initial.slice();
  const docs = new Map<string, SkillDocItem[]>();
  const files = new Map<string, SkillFileItem[]>();
  return {
    list: vi.fn(async () => skills.slice()),
    listDocs: vi.fn(async (skillId: string) => docs.get(skillId) ?? []),
    listFiles: vi.fn(async (skillId: string) => files.get(skillId) ?? []),
    importZip: vi.fn(async () => {
      const imported = { ...skill("imported", "Imported"), sourcePackageName: "imported.zip" };
      skills = [...skills, imported];
      return imported;
    }),
    createEmpty: vi.fn(async (name: string) => {
      const created = skill(`created-${name}`, name);
      skills = [...skills, created];
      return created;
    }),
    remove: vi.fn(async (skillId: string) => {
      skills = skills.filter((entry) => entry.id !== skillId);
    }),
    updateMarkdown: vi.fn(async (skillId: string, markdown: string) => {
      const updated = { ...skills.find((entry) => entry.id === skillId)!, skillMarkdown: markdown };
      skills = skills.map((entry) => entry.id === skillId ? updated : entry);
      return updated;
    }),
    upsertTextFile: vi.fn(async (skillId: string) => skills.find((entry) => entry.id === skillId)!),
    deleteTextFile: vi.fn(async (skillId: string) => skills.find((entry) => entry.id === skillId)!),
    exportZip: vi.fn(async () => new Blob(["zip"])),
    docs,
    files
  };
}

describe("skills controller", () => {
  it("loads skills, selects the first item, and loads its resources", async () => {
    const first = skill("first", "First");
    const store = createStore([first]);
    const doc: SkillDocItem = { id: "doc", skillId: first.id, path: "SKILL.md", title: "Skill", content: "text", updatedAt: 1 };
    const file: SkillFileItem = { id: "file", skillId: first.id, path: "asset.txt", kind: "asset", content: "asset", updatedAt: 1 };
    store.docs.set(first.id, [doc]);
    store.files.set(first.id, [file]);
    const pushLog = vi.fn();
    const { result } = renderHook(() => useSkillsController({ pushLog, store }));

    await waitFor(() => expect(result.current.skillPanelSelectedId).toBe(first.id));
    await waitFor(() => expect(result.current.skillPanelDocs).toEqual([doc]));
    expect(result.current.skillPanelFiles).toEqual([file]);
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ message: "Skills loaded: 1", ok: true }));
  });

  it("creates, updates, edits files, and removes skills through one reload path", async () => {
    const existing = skill("existing", "Existing");
    const store = createStore([existing]);
    const pushLog = vi.fn();
    const { result } = renderHook(() => useSkillsController({ pushLog, store }));
    await waitFor(() => expect(result.current.skillPanelSelectedId).toBe(existing.id));

    await act(async () => result.current.createEmpty("New Skill"));
    expect(result.current.skillPanelSelectedId).toBe("created-New Skill");

    await act(async () => result.current.updateMarkdown("created-New Skill", "# Updated"));
    expect(result.current.skills.find((entry) => entry.id === "created-New Skill")?.skillMarkdown).toBe("# Updated");

    await act(async () => result.current.upsertTextFile("created-New Skill", "refs/a.md", "reference", "content"));
    await act(async () => result.current.removeTextFile("created-New Skill", "refs/a.md"));
    expect(store.upsertTextFile).toHaveBeenCalledWith("created-New Skill", {
      path: "refs/a.md",
      kind: "reference",
      content: "content"
    });
    expect(store.deleteTextFile).toHaveBeenCalledWith("created-New Skill", "refs/a.md");

    await act(async () => result.current.removeSkill("created-New Skill"));
    expect(result.current.skills.map((entry) => entry.id)).toEqual([existing.id]);
    expect(result.current.skillPanelSelectedId).toBe(existing.id);
  });

  it("imports and exports using injected browser boundaries", async () => {
    const store = createStore();
    const download = vi.fn();
    const pushLog = vi.fn();
    const { result } = renderHook(() => useSkillsController({ pushLog, store, download }));
    await waitFor(() => expect(result.current.skillsLoaded).toBe(true));

    await act(async () => result.current.importSkill({} as File));
    expect(result.current.skillPanelSelectedId).toBe("imported");

    await act(async () => result.current.exportSkill("imported"));
    expect(download).toHaveBeenCalledWith("Imported.zip", expect.any(Blob));
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ message: "Skill exported: Imported", ok: true }));
  });

  it("logs selected-resource load failures and clears stale content", async () => {
    const existing = skill("existing", "Existing");
    const store = createStore([existing]);
    store.listDocs.mockRejectedValueOnce(new Error("read failed"));
    const pushLog = vi.fn();
    const { result } = renderHook(() => useSkillsController({ pushLog, store }));

    await waitFor(() => expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({
      message: "Skill docs load failed",
      details: "read failed"
    })));
    expect(result.current.skillPanelDocs).toEqual([]);
    expect(result.current.skillPanelFiles).toEqual([]);
  });
});
