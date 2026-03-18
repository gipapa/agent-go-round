import JSZip from "jszip";
import { SkillConfig, SkillDocItem, SkillFileItem, SkillWorkflowPolicy } from "../types";

const DB_NAME = "agr_skills_db";
const VERSION = 1;
const META_STORE = "skills_meta";
const DOCS_STORE = "skills_docs";
const FILES_STORE = "skills_files";

type SkillConfigBlock = {
  name?: string;
  version?: string;
  description?: string;
  decisionHint?: string;
  inputSchema?: any;
  workflow?: Partial<SkillWorkflowPolicy>;
};

type ParsedFrontmatter = {
  attrs: Record<string, string>;
  body: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DOCS_STORE)) {
        const store = db.createObjectStore(DOCS_STORE, { keyPath: "id" });
        store.createIndex("bySkillId", "skillId", { unique: false });
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        const store = db.createObjectStore(FILES_STORE, { keyPath: "id" });
        store.createIndex("bySkillId", "skillId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeWorkflow(value: unknown): SkillWorkflowPolicy {
  const input = value && typeof value === "object" ? (value as Partial<SkillWorkflowPolicy>) : {};
  return {
    instructions: typeof input.instructions === "string" ? input.instructions : "",
    useSkillDocs: input.useSkillDocs !== false,
    useAgentDocs: input.useAgentDocs === true,
    allowMcp: input.allowMcp === true,
    allowBuiltInTools: input.allowBuiltInTools === true,
    allowedMcpServerIds: normalizeStringArray(input.allowedMcpServerIds),
    allowedBuiltInToolIds: normalizeStringArray(input.allowedBuiltInToolIds)
  };
}

function getTitleFromPath(path: string) {
  const filename = path.split("/").pop() ?? path;
  return filename.replace(/\.[^.]+$/, "") || filename;
}

function deriveSkillId(rootPath: string) {
  const source = rootPath.replace(/\/+$/, "").trim() || "skill";
  return source.replace(/[^\w.-]+/g, "_");
}

function slugifyRootPath(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "skill"
  );
}

function inferDescription(markdown: string) {
  const stripped = markdown
    .replace(/```skill-config[\s\S]*?```/gi, "")
    .replace(/^#\s+.*$/gm, "")
    .trim();
  const paragraph = stripped.split(/\n\s*\n/).map((block) => block.trim()).find(Boolean);
  return paragraph ?? "";
}

function stripQuotes(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith("---")) {
    return { attrs: {}, body: markdown };
  }
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { attrs: {}, body: markdown };
  }

  const attrs: Record<string, string> = {};
  match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!pair) return;
      attrs[pair[1]] = stripQuotes(pair[2]);
    });

  return {
    attrs,
    body: markdown.slice(match[0].length)
  };
}

function parseSkillMarkdown(markdown: string, rootPath: string) {
  const { attrs, body } = parseYamlFrontmatter(markdown);
  const configMatch = body.match(/```skill-config\s*([\s\S]*?)```/i);
  let config: SkillConfigBlock = {};
  if (configMatch?.[1]) {
    try {
      config = JSON.parse(configMatch[1]);
    } catch (error: any) {
      throw new Error(`SKILL.md skill-config JSON invalid: ${String(error?.message ?? error)}`);
    }
  }

  const instructions = body.replace(/```skill-config[\s\S]*?```/gi, "").trim();
  const heading = instructions.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description =
    (typeof config.description === "string" && config.description.trim()) || attrs.description?.trim() || inferDescription(instructions);

  return {
    id: deriveSkillId(rootPath),
    name: (typeof config.name === "string" && config.name.trim()) || attrs.name?.trim() || heading || rootPath,
    version: typeof config.version === "string" && config.version.trim() ? config.version.trim() : "1.0.0",
    description: description || `${rootPath} skill package`,
    decisionHint: typeof config.decisionHint === "string" ? config.decisionHint.trim() : description || heading || rootPath,
    inputSchema: config.inputSchema ?? {},
    workflow: normalizeWorkflow({
      ...config.workflow,
      instructions: config.workflow?.instructions ?? instructions
    }),
    skillMarkdown: markdown
  };
}

function classifyFile(path: string, rootPath: string): SkillFileItem["kind"] {
  const normalized = path.replace(/^\.?\//, "");
  const relative = normalized.startsWith(`${rootPath}/`) ? normalized.slice(rootPath.length + 1) : normalized;
  if (relative === "SKILL.md") return "skill";
  if (/^references\//i.test(relative)) return "reference";
  if (/^scripts\//i.test(relative)) return "script";
  if (/^assets\//i.test(relative)) return "asset";
  return "other";
}

function isTextLikePath(path: string) {
  return /\.(md|markdown|txt|json|ya?ml|xml|csv|html|js|ts|prompt|svg)$/i.test(path);
}

async function deleteSkillRecords(db: IDBDatabase, skillId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, DOCS_STORE, FILES_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(skillId);

    const deleteBySkillId = (storeName: string) => {
      const store = tx.objectStore(storeName);
      const index = store.index("bySkillId");
      const req = index.openKeyCursor(IDBKeyRange.only(skillId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    };

    deleteBySkillId(DOCS_STORE);
    deleteBySkillId(FILES_STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSkillMeta(db: IDBDatabase, skillId: string): Promise<SkillConfig | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get(skillId);
    req.onsuccess = () => resolve(req.result as SkillConfig | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function getSkillFilesById(db: IDBDatabase, skillId: string): Promise<SkillFileItem[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readonly");
    const req = tx.objectStore(FILES_STORE).index("bySkillId").getAll(IDBKeyRange.only(skillId));
    req.onsuccess = () => resolve((req.result as SkillFileItem[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function countByKind(files: SkillFileItem[]) {
  return {
    fileCount: files.length,
    docCount: files.filter((item) => item.kind === "reference").length,
    scriptCount: files.filter((item) => item.kind === "script").length,
    assetCount: files.filter((item) => item.kind === "asset").length
  };
}

async function writeSkillSnapshot(db: IDBDatabase, meta: SkillConfig, files: SkillFileItem[]): Promise<SkillConfig> {
  const updatedAt = Date.now();
  const nextFiles = files.map((file) => ({ ...file, updatedAt }));
  const docs = nextFiles
    .filter((file) => file.kind === "reference")
    .map(
      (file) =>
        ({
          id: `${meta.id}:${file.path}`,
          skillId: meta.id,
          path: file.path,
          title: getTitleFromPath(file.path),
          content: file.content,
          updatedAt
        }) satisfies SkillDocItem
    );
  const counts = countByKind(nextFiles);
  const nextMeta: SkillConfig = {
    ...meta,
    ...counts,
    updatedAt
  };

  await deleteSkillRecords(db, meta.id);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, DOCS_STORE, FILES_STORE], "readwrite");
    tx.objectStore(META_STORE).put(nextMeta);
    const docStore = tx.objectStore(DOCS_STORE);
    docs.forEach((doc) => docStore.put(doc));
    const fileStore = tx.objectStore(FILES_STORE);
    nextFiles.forEach((file) => fileStore.put(file));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return nextMeta;
}

export async function listSkills(): Promise<SkillConfig[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as SkillConfig[])
          .map((skill) => {
            try {
              const parsed = parseSkillMarkdown(skill.skillMarkdown, skill.rootPath);
              return {
                ...skill,
                name: parsed.name,
                version: parsed.version,
                description: parsed.description,
                decisionHint: parsed.decisionHint,
                inputSchema: parsed.inputSchema,
                workflow: parsed.workflow,
                skillMarkdown: parsed.skillMarkdown
              };
            } catch {
              return skill;
            }
          })
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    req.onerror = () => reject(req.error);
  });
}

export async function listSkillDocs(skillId: string): Promise<SkillDocItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, "readonly");
    const req = tx.objectStore(DOCS_STORE).index("bySkillId").getAll(IDBKeyRange.only(skillId));
    req.onsuccess = () => resolve((req.result as SkillDocItem[]).sort((a, b) => a.path.localeCompare(b.path)));
    req.onerror = () => reject(req.error);
  });
}

export async function listSkillFiles(skillId: string): Promise<SkillFileItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readonly");
    const req = tx.objectStore(FILES_STORE).index("bySkillId").getAll(IDBKeyRange.only(skillId));
    req.onsuccess = () => resolve((req.result as SkillFileItem[]).sort((a, b) => a.path.localeCompare(b.path)));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSkill(skillId: string): Promise<void> {
  const db = await openDb();
  await deleteSkillRecords(db, skillId);
}

export async function updateSkillMarkdown(skillId: string, skillMarkdown: string): Promise<SkillConfig> {
  const db = await openDb();
  const current = await getSkillMeta(db, skillId);

  if (!current) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  const parsed = parseSkillMarkdown(skillMarkdown, current.rootPath);
  const files = await getSkillFilesById(db, skillId);
  const nextMeta: SkillConfig = {
    ...current,
    name: parsed.name,
    version: parsed.version,
    description: parsed.description,
    decisionHint: parsed.decisionHint,
    inputSchema: parsed.inputSchema,
    workflow: parsed.workflow,
    skillMarkdown: parsed.skillMarkdown,
    updatedAt: Date.now()
  };
  const nextFiles = files.map((file) =>
    file.kind === "skill" && file.path === `${current.rootPath}/SKILL.md`
      ? { ...file, content: skillMarkdown }
      : file
  );
  return writeSkillSnapshot(db, nextMeta, nextFiles);
}

export async function createEmptySkill(name: string): Promise<SkillConfig> {
  const db = await openDb();
  const existing = await listSkills();
  const usedIds = new Set(existing.map((skill) => skill.id));
  const usedRoots = new Set(existing.map((skill) => skill.rootPath));
  const baseRoot = slugifyRootPath(name);
  let rootPath = baseRoot;
  let suffix = 2;
  while (usedRoots.has(rootPath) || usedIds.has(deriveSkillId(rootPath))) {
    rootPath = `${baseRoot}-${suffix++}`;
  }

  const skillMarkdown = `# ${name.trim() || "New Skill"}

請在這裡描述 skill 的用途、執行方式與注意事項。

\`\`\`skill-config
{
  "version": "1.0.0",
  "decisionHint": "",
  "inputSchema": {},
  "workflow": {
    "useSkillDocs": true,
    "useAgentDocs": false,
    "allowMcp": false,
    "allowBuiltInTools": false
  }
}
\`\`\`
`;
  const parsed = parseSkillMarkdown(skillMarkdown, rootPath);
  const meta: SkillConfig = {
    ...parsed,
    rootPath,
    sourcePackageName: `${rootPath}.zip`,
    fileCount: 1,
    docCount: 0,
    scriptCount: 0,
    assetCount: 0,
    updatedAt: Date.now()
  };
  const files: SkillFileItem[] = [
    {
      id: `${meta.id}:${rootPath}/SKILL.md`,
      skillId: meta.id,
      path: `${rootPath}/SKILL.md`,
      kind: "skill",
      content: skillMarkdown,
      updatedAt: meta.updatedAt
    }
  ];
  return writeSkillSnapshot(db, meta, files);
}

export async function upsertSkillTextFile(
  skillId: string,
  args: { path: string; kind: "reference" | "asset"; content: string }
): Promise<SkillConfig> {
  const db = await openDb();
  const current = await getSkillMeta(db, skillId);
  if (!current) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  const normalizedRelativePath = args.path.replace(/^\/+/, "").trim();
  if (!normalizedRelativePath) {
    throw new Error("File path is required.");
  }
  const kindDir = args.kind === "reference" ? "references" : "assets";
  const fullPath = normalizedRelativePath.startsWith(`${current.rootPath}/`)
    ? normalizedRelativePath
    : `${current.rootPath}/${normalizedRelativePath.startsWith(`${kindDir}/`) ? normalizedRelativePath : `${kindDir}/${normalizedRelativePath}`}`;
  const files = await getSkillFilesById(db, skillId);
  const fileId = `${current.id}:${fullPath}`;
  const nextFile: SkillFileItem = {
    id: fileId,
    skillId: current.id,
    path: fullPath,
    kind: args.kind,
    content: args.content,
    updatedAt: Date.now()
  };
  const nextFiles = [...files.filter((file) => file.id !== fileId), nextFile].sort((a, b) => a.path.localeCompare(b.path));
  return writeSkillSnapshot(db, current, nextFiles);
}

export async function deleteSkillTextFile(skillId: string, path: string): Promise<SkillConfig> {
  const db = await openDb();
  const current = await getSkillMeta(db, skillId);
  if (!current) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  const files = await getSkillFilesById(db, skillId);
  const nextFiles = files.filter((file) => file.path !== path);
  return writeSkillSnapshot(db, current, nextFiles);
}

export async function exportSkillZip(skillId: string): Promise<Blob> {
  const db = await openDb();
  const current = await getSkillMeta(db, skillId);
  if (!current) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  const files = await getSkillFilesById(db, skillId);
  const zip = new JSZip();
  zip.folder(`${current.rootPath}/scripts`);
  zip.folder(`${current.rootPath}/references`);
  zip.folder(`${current.rootPath}/assets`);
  files.forEach((file) => {
    zip.file(file.path, file.content);
  });
  return zip.generateAsync({ type: "blob" });
}

export async function importSkillZip(file: File): Promise<SkillConfig> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const skillEntry = entries.find((entry) => /(^|\/)SKILL\.md$/i.test(entry.name));
  if (!skillEntry) {
    throw new Error("Zip package must include skill-name/SKILL.md.");
  }

  const rootPath = skillEntry.name.includes("/") ? skillEntry.name.split("/")[0] : file.name.replace(/\.zip$/i, "");
  const skillMarkdown = await skillEntry.async("text");
  const parsed = parseSkillMarkdown(skillMarkdown, rootPath);
  const updatedAt = Date.now();

  const docs: SkillDocItem[] = [];
  const files: SkillFileItem[] = [];
  let scriptCount = 0;
  let assetCount = 0;

  for (const entry of entries) {
    const path = entry.name.replace(/^\.?\//, "");
    const kind = classifyFile(path, rootPath);
    if (!isTextLikePath(path) && kind !== "asset") continue;
    const content = isTextLikePath(path) ? await entry.async("text") : "";

    files.push({
      id: `${parsed.id}:${path}`,
      skillId: parsed.id,
      path,
      kind,
      content,
      updatedAt
    });

    if (kind === "reference") {
      docs.push({
        id: `${parsed.id}:${path}`,
        skillId: parsed.id,
        path,
        title: getTitleFromPath(path),
        content,
        updatedAt
      });
    }
    if (kind === "script") scriptCount += 1;
    if (kind === "asset") assetCount += 1;
  }

  const meta: SkillConfig = {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    description: parsed.description,
    decisionHint: parsed.decisionHint,
    inputSchema: parsed.inputSchema,
    workflow: parsed.workflow,
    skillMarkdown: parsed.skillMarkdown,
    rootPath,
    sourcePackageName: file.name,
    fileCount: files.length,
    docCount: docs.length,
    scriptCount,
    assetCount,
    updatedAt
  };

  const db = await openDb();
  await deleteSkillRecords(db, meta.id);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, DOCS_STORE, FILES_STORE], "readwrite");
    tx.objectStore(META_STORE).put(meta);
    const docStore = tx.objectStore(DOCS_STORE);
    docs.forEach((doc) => docStore.put(doc));
    const fileStore = tx.objectStore(FILES_STORE);
    files.forEach((stored) => fileStore.put(stored));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return meta;
}
