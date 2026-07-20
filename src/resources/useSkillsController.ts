import { useEffect, useState } from "react";
import { SkillConfig, SkillDocItem, SkillFileItem } from "../types";
import {
  createEmptySkill,
  deleteSkill,
  deleteSkillTextFile,
  exportSkillZip,
  importSkillZip,
  listSkillDocs,
  listSkillFiles,
  listSkills,
  updateSkillMarkdown,
  upsertSkillTextFile
} from "../storage/skillStore";
import { PendingLogEntry } from "../runtime/logging";
import { errorMessage } from "../utils/errors";

type SkillTextFileInput = { path: string; kind: "reference" | "asset"; content: string };

type SkillsStore = {
  list: () => Promise<SkillConfig[]>;
  listDocs: (skillId: string) => Promise<SkillDocItem[]>;
  listFiles: (skillId: string) => Promise<SkillFileItem[]>;
  importZip: (file: File) => Promise<SkillConfig>;
  createEmpty: (name: string) => Promise<SkillConfig>;
  remove: (skillId: string) => Promise<void>;
  updateMarkdown: (skillId: string, markdown: string) => Promise<SkillConfig>;
  upsertTextFile: (skillId: string, input: SkillTextFileInput) => Promise<SkillConfig>;
  deleteTextFile: (skillId: string, path: string) => Promise<SkillConfig>;
  exportZip: (skillId: string) => Promise<Blob>;
};

type UseSkillsControllerArgs = {
  pushLog: (entry: PendingLogEntry) => void;
  store?: SkillsStore;
  download?: (filename: string, blob: Blob) => void;
};

const defaultStore: SkillsStore = {
  list: listSkills,
  listDocs: listSkillDocs,
  listFiles: listSkillFiles,
  importZip: importSkillZip,
  createEmpty: createEmptySkill,
  remove: deleteSkill,
  updateMarkdown: updateSkillMarkdown,
  upsertTextFile: upsertSkillTextFile,
  deleteTextFile: deleteSkillTextFile,
  exportZip: exportSkillZip
};

export function useSkillsController({ pushLog, store = defaultStore, download = downloadBlob }: UseSkillsControllerArgs) {
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillPanelSelectedId, setSkillPanelSelectedId] = useState<string | null>(null);
  const [skillPanelDocs, setSkillPanelDocs] = useState<SkillDocItem[]>([]);
  const [skillPanelFiles, setSkillPanelFiles] = useState<SkillFileItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await store.list();
        if (cancelled) return;
        setSkills(list);
        setSkillsLoaded(true);
        setSkillPanelSelectedId((current) => current ?? list[0]?.id ?? null);
        pushLog({ category: "skills", ok: true, message: `Skills loaded: ${list.length}` });
      } catch (error) {
        if (!cancelled) {
          pushLog({ category: "skills", ok: false, message: "Skills load failed", details: errorMessage(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushLog, store]);

  useEffect(() => {
    if (!skillPanelSelectedId) {
      setSkillPanelDocs([]);
      setSkillPanelFiles([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [docs, files] = await Promise.all([
          store.listDocs(skillPanelSelectedId),
          store.listFiles(skillPanelSelectedId)
        ]);
        if (!cancelled) {
          setSkillPanelDocs(docs);
          setSkillPanelFiles(files);
        }
      } catch (error) {
        if (!cancelled) {
          setSkillPanelDocs([]);
          setSkillPanelFiles([]);
          pushLog({ category: "skills", ok: false, message: "Skill docs load failed", details: errorMessage(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushLog, skillPanelSelectedId, store]);

  useEffect(() => {
    if (skillsLoaded && skillPanelSelectedId && !skills.some((skill) => skill.id === skillPanelSelectedId)) {
      setSkillPanelSelectedId(skills[0]?.id ?? null);
    }
  }, [skillPanelSelectedId, skills, skillsLoaded]);

  async function reloadSkillsFromStore(preferredId?: string | null) {
    const next = await store.list();
    setSkills(next);
    const nextSelectedId = preferredId && next.some((skill) => skill.id === preferredId)
      ? preferredId
      : next[0]?.id ?? null;
    setSkillPanelSelectedId(nextSelectedId);
    await loadSelectedSkill(nextSelectedId);
    return next;
  }

  async function loadSelectedSkill(skillId: string | null) {
    if (!skillId) {
      setSkillPanelDocs([]);
      setSkillPanelFiles([]);
      return;
    }
    const [docs, files] = await Promise.all([store.listDocs(skillId), store.listFiles(skillId)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
  }

  async function importSkill(file: File) {
    const skill = await store.importZip(file);
    await reloadSkillsFromStore(skill.id);
    pushLog({
      category: "skills",
      ok: true,
      message: `Skill imported: ${skill.name}`,
      details: `${skill.id}\n${skill.sourcePackageName ?? ""}`.trim()
    });
  }

  async function createEmpty(name: string) {
    const skill = await store.createEmpty(name);
    await reloadSkillsFromStore(skill.id);
    pushLog({ category: "skills", ok: true, message: `Empty skill created: ${skill.name}`, details: skill.id });
  }

  async function removeSkill(skillId: string) {
    const target = skills.find((skill) => skill.id === skillId);
    await store.remove(skillId);
    const preferredId = skillPanelSelectedId === skillId ? null : skillPanelSelectedId;
    await reloadSkillsFromStore(preferredId);
    pushLog({ category: "skills", ok: true, message: `Skill deleted: ${target?.name ?? skillId}` });
  }

  async function updateMarkdown(skillId: string, markdown: string) {
    const updated = await store.updateMarkdown(skillId, markdown);
    await reloadSkillsFromStore(updated.id);
    pushLog({ category: "skills", ok: true, message: `Skill updated: ${updated.name}`, details: updated.id });
  }

  async function upsertTextFile(skillId: string, path: string, kind: "reference" | "asset", content: string) {
    const updated = await store.upsertTextFile(skillId, { path, kind, content });
    await reloadSkillsFromStore(updated.id);
    pushLog({ category: "skills", ok: true, message: `Skill file saved: ${path}`, details: `${updated.name}\n${kind}` });
  }

  async function removeTextFile(skillId: string, path: string) {
    const updated = await store.deleteTextFile(skillId, path);
    await reloadSkillsFromStore(updated.id);
    pushLog({ category: "skills", ok: true, message: `Skill file deleted: ${path}`, details: updated.name });
  }

  async function exportSkill(skillId: string) {
    const target = skills.find((skill) => skill.id === skillId);
    const blob = await store.exportZip(skillId);
    download(`${target?.rootPath ?? skillId}.zip`, blob);
    pushLog({
      category: "skills",
      ok: true,
      message: `Skill exported: ${target?.name ?? skillId}`,
      details: target?.rootPath ?? skillId
    });
  }

  return {
    skills,
    setSkills,
    skillsLoaded,
    skillPanelSelectedId,
    setSkillPanelSelectedId,
    skillPanelDocs,
    skillPanelFiles,
    reloadSkillsFromStore,
    importSkill,
    createEmpty,
    removeSkill,
    updateMarkdown,
    upsertTextFile,
    removeTextFile,
    exportSkill
  };
}

function downloadBlob(filename: string, blob: Blob) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
