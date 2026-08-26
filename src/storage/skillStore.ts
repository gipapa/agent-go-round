import JSZip from "jszip";
import type { JSONSchema7 } from "json-schema";
import { SkillConfig, SkillDocItem, SkillFileItem, SkillWorkflowPolicy } from "../types";
import { errorMessage } from "../utils/errors";
import { normalizeSkillPackagePath, parseStandardSkillDocument, SKILL_PACKAGE_LIMITS, validateSkillPackage } from "../runtime/skillPackageValidation";

export type SkillSnapshot = {
  meta: SkillConfig;
  files: SkillFileItem[];
};

const DB_NAME = "agr_skills_db";
const VERSION = 1;
const META_STORE = "skills_meta";
const DOCS_STORE = "skills_docs";
const FILES_STORE = "skills_files";

const MAX_IMPORT_FILE_COUNT = 1_000;

type SkillConfigBlock = {
  name?: string;
  version?: string;
  description?: string;
  decisionHint?: string;
  inputSchema?: JSONSchema7;
  workflow?: Partial<SkillWorkflowPolicy>;
};

type ParsedFrontmatter = {
  attrs: Record<string, string>;
  body: string;
};

function idbError(label: string, error: DOMException | null) {
  return new Error(`${label}: ${error?.message ?? "unknown IndexedDB error"}`);
}

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
    req.onerror = () => reject(idbError("open skills db failed", req.error));
  });
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeWorkflow(value: unknown): SkillWorkflowPolicy {
  const input = value && typeof value === "object" ? (value as Partial<SkillWorkflowPolicy>) : {};
  const bootstrapAction =
    input.bootstrapAction &&
    typeof input.bootstrapAction === "object" &&
    (input.bootstrapAction.toolKind === "mcp" || input.bootstrapAction.toolKind === "builtin") &&
    typeof input.bootstrapAction.toolName === "string" &&
    input.bootstrapAction.toolName.trim()
      ? {
          toolKind: input.bootstrapAction.toolKind,
          toolName: input.bootstrapAction.toolName.trim(),
          input: input.bootstrapAction.input,
          reason:
            typeof input.bootstrapAction.reason === "string" && input.bootstrapAction.reason.trim()
              ? input.bootstrapAction.reason.trim()
              : undefined
        }
      : undefined;
  return {
    instructions: typeof input.instructions === "string" ? input.instructions : "",
    disableModelInvocation: input.disableModelInvocation === true,
    requiredToolIds: normalizeStringArray(input.requiredToolIds),
    useSkillDocs: input.useSkillDocs !== false,
    useAgentDocs: input.useAgentDocs === true,
    allowMcp: input.allowMcp === true,
    allowBuiltInTools: input.allowBuiltInTools === true,
    allowedMcpServerIds: normalizeStringArray(input.allowedMcpServerIds),
    allowedBuiltInToolIds: normalizeStringArray(input.allowedBuiltInToolIds),
    bootstrapAction
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

function parseSkillConfigBlock(instructions: string) {
  const configMatch = instructions.match(/```skill-config\s*([\s\S]*?)```/i);
  let config: SkillConfigBlock = {};
  if (configMatch?.[1]) {
    try {
      const parsed = JSON.parse(configMatch[1]) as unknown;
      config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SkillConfigBlock) : {};
    } catch (error) {
      throw new Error(`SKILL.md skill-config JSON invalid: ${errorMessage(error)}`);
    }
  }
  return {
    config,
    instructions: instructions.replace(/```skill-config[\s\S]*?```/gi, "").trim()
  };
}

function parseSkillMarkdown(markdown: string, rootPath: string) {
  const standard = parseStandardSkillDocument(markdown);
  if (!("code" in standard)) {
    const parsedInstructions = parseSkillConfigBlock(standard.instructions);
    const agrMetadata = standard.metadata["agent-go-round"];
    const agr = agrMetadata && typeof agrMetadata === "object" && !Array.isArray(agrMetadata)
      ? agrMetadata as Record<string, unknown>
      : {};
    const workflowMetadata = agr.workflow && typeof agr.workflow === "object" && !Array.isArray(agr.workflow)
      ? agr.workflow as Record<string, unknown>
      : {};
    return {
      id: deriveSkillId(rootPath),
      name: standard.name,
      version: standard.version ?? "1.0.0",
      description: standard.description,
      decisionHint: typeof parsedInstructions.config.decisionHint === "string" && parsedInstructions.config.decisionHint.trim()
        ? parsedInstructions.config.decisionHint.trim()
        : typeof agr.decisionHint === "string"
        ? agr.decisionHint.trim()
        : standard.description,
      inputSchema: parsedInstructions.config.inputSchema ?? (agr.inputSchema && typeof agr.inputSchema === "object" && !Array.isArray(agr.inputSchema) ? agr.inputSchema : {}),
      workflow: normalizeWorkflow({
        ...workflowMetadata,
        ...parsedInstructions.config.workflow,
        instructions: parsedInstructions.config.workflow?.instructions ?? parsedInstructions.instructions,
        disableModelInvocation: standard.disableModelInvocation || parsedInstructions.config.workflow?.disableModelInvocation === true,
        requiredToolIds: agr.requiredToolIds ?? parsedInstructions.config.workflow?.requiredToolIds ?? workflowMetadata.requiredToolIds
      }),
      skillMarkdown: markdown
    };
  }
  if (markdown.trimStart().startsWith("---")) {
    throw new Error(standard.message);
  }
  const { attrs, body } = parseYamlFrontmatter(markdown);
  const { config, instructions } = parseSkillConfigBlock(body);
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

function decodeUtf8OrKeepBytes(bytes: Uint8Array): string | Uint8Array {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
}

function zipEntryPath(entry: JSZip.JSZipObject) {
  return entry.unsafeOriginalName ?? entry.name;
}

function mediaTypeForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const mediaTypes: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    xml: "application/xml",
    csv: "text/csv",
    html: "text/html",
    js: "text/javascript",
    ts: "text/typescript",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    zip: "application/zip"
  };
  return extension ? mediaTypes[extension] : undefined;
}

function bytesForContent(content: string | Uint8Array) {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength).slice();
  }
  return content;
}

function fallbackDigest(bytes: Uint8Array) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function contentDigest(content: string | Uint8Array) {
  const bytes = bytesForContent(content);
  if (!globalThis.crypto?.subtle) return fallbackDigest(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return `sha256-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
      req.onerror = () => reject(idbError(`delete ${storeName} records failed`, req.error));
    };

    deleteBySkillId(DOCS_STORE);
    deleteBySkillId(FILES_STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(idbError("delete skill records transaction failed", tx.error));
    tx.onabort = () => reject(idbError("delete skill records transaction aborted", tx.error));
  });
}

async function getSkillMeta(db: IDBDatabase, skillId: string): Promise<SkillConfig | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get(skillId);
    req.onsuccess = () => resolve(req.result as SkillConfig | undefined);
    req.onerror = () => reject(idbError("get skill metadata failed", req.error));
    tx.onabort = () => reject(idbError("get skill metadata transaction aborted", tx.error));
  });
}

async function getSkillFilesById(db: IDBDatabase, skillId: string): Promise<SkillFileItem[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readonly");
    const req = tx.objectStore(FILES_STORE).index("bySkillId").getAll(IDBKeyRange.only(skillId));
    req.onsuccess = () => resolve((req.result as SkillFileItem[]) ?? []);
    req.onerror = () => reject(idbError("get skill files failed", req.error));
    tx.onabort = () => reject(idbError("get skill files transaction aborted", tx.error));
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

function validateStoredSkillSnapshot(meta: SkillConfig, files: SkillFileItem[]) {
  if (files.length > MAX_IMPORT_FILE_COUNT) {
    throw new Error(`Skill package contains more than ${MAX_IMPORT_FILE_COUNT} files.`);
  }
  const packageValidation = validateSkillPackage(files.map((file) => ({
    path: file.path,
    content: file.content,
    mediaType: file.mediaType
  })));
  const expectedSkillPath = `${meta.rootPath}/SKILL.md`;
  if (packageValidation.rootPath !== meta.rootPath || packageValidation.skillFilePath?.toLowerCase() !== expectedSkillPath.toLowerCase()) {
    throw new Error("Skill snapshot root or SKILL.md path is inconsistent.");
  }
  const storedSkillFile = packageValidation.files.find((file) => file.path.toLowerCase() === expectedSkillPath.toLowerCase());
  if (!storedSkillFile || typeof storedSkillFile.content !== "string" || storedSkillFile.content !== meta.skillMarkdown) {
    throw new Error("Skill snapshot metadata does not match SKILL.md content.");
  }
  const standardParse = parseStandardSkillDocument(meta.skillMarkdown);
  const legacyPackage = meta.sourceProvenance === "legacy"
    || ("code" in standardParse && standardParse.code === "malformed_frontmatter" && !meta.skillMarkdown.trimStart().startsWith("---"));
  const allowedLegacyDiagnostics = legacyPackage && packageValidation.diagnostics.every((diagnostic) => diagnostic.code === "malformed_frontmatter");
  if (!packageValidation.ok && !allowedLegacyDiagnostics) {
    throw new Error(`Invalid skill package: ${packageValidation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
  }
  return packageValidation.packageByteSize;
}

async function writeSkillSnapshot(db: IDBDatabase, meta: SkillConfig, files: SkillFileItem[]): Promise<SkillConfig> {
  const packageByteSize = validateStoredSkillSnapshot(meta, files);
  const updatedAt = Date.now();
  const nextFiles = files.map((file) => ({ ...file, updatedAt }));
  const docs = nextFiles
    .filter((file): file is SkillFileItem & { content: string } => file.kind === "reference" && typeof file.content === "string")
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
    packageByteSize,
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
    tx.onerror = () => reject(idbError("write skill snapshot failed", tx.error));
    tx.onabort = () => reject(idbError("write skill snapshot transaction aborted", tx.error));
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
    req.onerror = () => reject(idbError("list skills failed", req.error));
    tx.onabort = () => reject(idbError("list skills transaction aborted", tx.error));
  });
}

export async function listSkillDocs(skillId: string): Promise<SkillDocItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, "readonly");
    const req = tx.objectStore(DOCS_STORE).index("bySkillId").getAll(IDBKeyRange.only(skillId));
    req.onsuccess = () => resolve((req.result as SkillDocItem[]).sort((a, b) => a.path.localeCompare(b.path)));
    req.onerror = () => reject(idbError("list skill docs failed", req.error));
    tx.onabort = () => reject(idbError("list skill docs transaction aborted", tx.error));
  });
}

export async function listSkillFiles(skillId: string): Promise<SkillFileItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readonly");
    const req = tx.objectStore(FILES_STORE).index("bySkillId").getAll(IDBKeyRange.only(skillId));
    req.onsuccess = () => resolve((req.result as SkillFileItem[]).sort((a, b) => a.path.localeCompare(b.path)));
    req.onerror = () => reject(idbError("list skill files failed", req.error));
    tx.onabort = () => reject(idbError("list skill files transaction aborted", tx.error));
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
  const nextSkillBytes = new TextEncoder().encode(skillMarkdown);
  const nextSkillDigest = await contentDigest(nextSkillBytes);
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
      ? {
          ...file,
          content: skillMarkdown,
          binaryContent: nextSkillBytes,
          mediaType: "text/markdown",
          byteSize: nextSkillBytes.byteLength,
          digest: nextSkillDigest
        }
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

  const displayName = name.trim() || "New Skill";
  const description = `${displayName} skill package`;
  const skillMarkdown = [
    "---",
    `name: ${JSON.stringify(rootPath)}`,
    `description: ${JSON.stringify(description)}`,
    'version: "1.0.0"',
    "metadata:",
    "  agent-go-round:",
    "    workflow:",
    "      useSkillDocs: true",
    "      useAgentDocs: false",
    "      allowMcp: false",
    "      allowBuiltInTools: false",
    "---",
    "",
    `# ${displayName}`,
    "",
    "請在這裡描述 skill 的用途、執行方式與注意事項。",
    ""
  ].join("\n");
  const parsed = parseSkillMarkdown(skillMarkdown, rootPath);
  const skillBytes = new TextEncoder().encode(skillMarkdown);
  const skillDigest = await contentDigest(skillBytes);
  const meta: SkillConfig = {
    ...parsed,
    rootPath,
    sourcePackageName: `${rootPath}.zip`,
    fileCount: 1,
    docCount: 0,
    scriptCount: 0,
    assetCount: 0,
    updatedAt: Date.now(),
    sourceProvenance: "agentskills",
    skillDiagnostics: [],
    packageByteSize: skillBytes.byteLength
  };
  const files: SkillFileItem[] = [
    {
      id: `${meta.id}:${rootPath}/SKILL.md`,
      skillId: meta.id,
      path: `${rootPath}/SKILL.md`,
      kind: "skill",
      content: skillMarkdown,
      binaryContent: skillBytes,
      mediaType: "text/markdown",
      byteSize: skillBytes.byteLength,
      digest: skillDigest,
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
  const normalizedRelativePath = normalizeSkillPackagePath(args.path.trim());
  if (!normalizedRelativePath) {
    throw new Error("File path is required.");
  }
  const kindDir = args.kind === "reference" ? "references" : "assets";
  if (
    normalizedRelativePath.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedRelativePath) ||
    normalizedRelativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("File path must be a safe relative path.");
  }
  const rootPrefix = `${current.rootPath}/`;
  const rootedPath = normalizedRelativePath.startsWith(rootPrefix)
    ? normalizedRelativePath.slice(rootPrefix.length)
    : normalizedRelativePath;
  const relativePath = rootedPath.startsWith(`${kindDir}/`) ? rootedPath.slice(kindDir.length + 1) : rootedPath;
  if (!relativePath || relativePath.toLowerCase() === "skill.md") {
    throw new Error("Editable files must stay inside references/ or assets/.");
  }
  const fullPath = `${current.rootPath}/${kindDir}/${relativePath}`;
  const files = await getSkillFilesById(db, skillId);
  const fileId = `${current.id}:${fullPath}`;
  if (files.some((file) => file.id !== fileId && file.path.toLocaleLowerCase() === fullPath.toLocaleLowerCase())) {
    throw new Error("A file with the same path already exists.");
  }
  const nextFile: SkillFileItem = {
    id: fileId,
    skillId: current.id,
    path: fullPath,
    kind: args.kind,
    content: args.content,
    binaryContent: new TextEncoder().encode(args.content),
    mediaType: args.kind === "reference" ? "text/markdown" : "text/plain",
    byteSize: new TextEncoder().encode(args.content).byteLength,
    digest: await contentDigest(args.content),
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
  const target = files.find((file) => file.path === path);
  if (!target) throw new Error("File not found.");
  if (target.kind !== "reference" && target.kind !== "asset") {
    throw new Error("Only reference and asset files can be deleted.");
  }
  const nextFiles = files.filter((file) => file.id !== target.id);
  return writeSkillSnapshot(db, current, nextFiles);
}

export async function exportSkillZip(skillId: string): Promise<Blob> {
  const db = await openDb();
  const current = await getSkillMeta(db, skillId);
  if (!current) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  const files = await getSkillFilesById(db, skillId);
  validateStoredSkillSnapshot(current, files);
  const zip = new JSZip();
  zip.folder(`${current.rootPath}/scripts`);
  zip.folder(`${current.rootPath}/references`);
  zip.folder(`${current.rootPath}/assets`);
  files.forEach((file) => {
    zip.file(file.path, bytesForContent(file.binaryContent ?? file.content));
  });
  return zip.generateAsync({ type: "blob" });
}

export async function importSkillZip(file: File): Promise<SkillConfig> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_IMPORT_FILE_COUNT) {
    throw new Error(`Skill package contains more than ${MAX_IMPORT_FILE_COUNT} files.`);
  }
  let declaredPackageBytes = 0;
  for (const entry of entries) {
    const declaredSize = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declaredSize !== "number" || !Number.isFinite(declaredSize) || declaredSize < 0) continue;
    if (declaredSize > SKILL_PACKAGE_LIMITS.maxFileBytes) {
      throw new Error(`Skill package file exceeds ${SKILL_PACKAGE_LIMITS.maxFileBytes} bytes.`);
    }
    declaredPackageBytes += declaredSize;
    if (declaredPackageBytes > SKILL_PACKAGE_LIMITS.maxPackageBytes) {
      throw new Error(`Skill package exceeds ${SKILL_PACKAGE_LIMITS.maxPackageBytes} bytes.`);
    }
  }
  const skillEntry = entries.find((entry) => /(^|\/)SKILL\.md$/i.test(normalizeSkillPackagePath(zipEntryPath(entry))));
  if (!skillEntry) {
    throw new Error("Zip package must include skill-name/SKILL.md.");
  }

  const normalizedSkillEntryPath = normalizeSkillPackagePath(zipEntryPath(skillEntry));
  const rootPath = normalizedSkillEntryPath.includes("/")
    ? normalizedSkillEntryPath.split("/")[0]
    : file.name.replace(/\.zip$/i, "");
  const rawEntryBytes = new Map<string, Uint8Array>();
  const packageFiles = await Promise.all(
    entries.map(async (entry) => {
      const bytes = await entry.async("uint8array");
      const path = zipEntryPath(entry);
      rawEntryBytes.set(normalizeSkillPackagePath(path), bytes);
      return {
        path,
        mediaType: mediaTypeForPath(path),
        byteSize: bytes.byteLength,
        content: isTextLikePath(path) ? decodeUtf8OrKeepBytes(bytes) : bytes
      };
    })
  );
  const packageValidation = validateSkillPackage(packageFiles);
  const skillBytes = rawEntryBytes.get(normalizedSkillEntryPath);
  const skillMarkdown = skillBytes ? new TextDecoder().decode(skillBytes) : await skillEntry.async("text");
  const standardParse = parseStandardSkillDocument(skillMarkdown);
  const legacyPackage = "code" in standardParse && standardParse.code === "malformed_frontmatter" && !skillMarkdown.trimStart().startsWith("---");
  if (!packageValidation.ok && (!legacyPackage || packageValidation.diagnostics.some((diagnostic) => diagnostic.code !== "malformed_frontmatter"))) {
    throw new Error(`Invalid skill package: ${packageValidation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
  }
  const validatedRootPath = packageValidation.rootPath ?? rootPath;
  const parsed = parseSkillMarkdown(skillMarkdown, validatedRootPath);
  const updatedAt = Date.now();

  const docs: SkillDocItem[] = [];
  const files: SkillFileItem[] = [];
  let scriptCount = 0;
  let assetCount = 0;

  for (const entry of packageValidation.files) {
    const path = entry.path;
    const kind = classifyFile(path, validatedRootPath);
    const originalContent = entry.content;
    const textContent = typeof originalContent === "string" ? originalContent : undefined;
    const isText = textContent !== undefined;
    const content = originalContent;
    const rawBytes = rawEntryBytes.get(path) ?? bytesForContent(originalContent);
    const binaryContent = rawBytes;

    files.push({
      id: `${parsed.id}:${path}`,
      skillId: parsed.id,
      path,
      kind,
      content,
      binaryContent,
      mediaType: entry.mediaType ?? mediaTypeForPath(path),
      byteSize: rawBytes.byteLength,
      digest: await contentDigest(rawBytes),
      updatedAt
    });

    if (kind === "reference" && isText) {
      docs.push({
        id: `${parsed.id}:${path}`,
        skillId: parsed.id,
        path,
        title: getTitleFromPath(path),
        content: textContent!,
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
    rootPath: validatedRootPath,
    sourcePackageName: file.name,
    fileCount: files.length,
    docCount: docs.length,
    scriptCount,
    assetCount,
    updatedAt,
    sourceProvenance: legacyPackage ? "legacy" : "agentskills",
    skillDiagnostics: packageValidation.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    packageByteSize: packageValidation.packageByteSize
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
    tx.onerror = () => reject(idbError("import skill zip failed", tx.error));
    tx.onabort = () => reject(idbError("import skill zip transaction aborted", tx.error));
  });

  return meta;
}

export async function restoreSkillSnapshots(snapshots: SkillSnapshot[]): Promise<void> {
  const db = await openDb();
  const existing = await listSkills();

  for (const skill of existing) {
    await deleteSkillRecords(db, skill.id);
  }

  for (const snapshot of snapshots) {
    await writeSkillSnapshot(db, snapshot.meta, snapshot.files);
  }
}
