import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { VirtualFileSystem } from "./fs";

export const BIN_DIRECTORY = "~/bin";
export const FILE_METHODS = ["stat", "readFile", "listDirectory", "writeFile", "writeFiles", "mkdir", "remove"] as const;
export type FileMethod = typeof FILE_METHODS[number];
export const BIN_CAPABILITIES = [...FILE_METHODS, "loadSkill"] as const;
export type BinCapability = typeof BIN_CAPABILITIES[number];
export type BinManifest = {
  version: 1;
  name: string;
  description: string;
  parameters: TSchema;
  capabilities: BinCapability[];
};
export type BinDefinition = BinManifest & { source: string };
const path = Type.String({ minLength: 1, maxLength: 1024 });
const revision = Type.Optional(Type.Integer({ minimum: 0 }));
const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }));
const object = (properties: Record<string, TSchema>) => Type.Object(properties, { additionalProperties: false });

const READ_V1_SOURCE = `async function main(args, api) {
  const file = await api.fs.readFile(args.path);
  const lines = file.content.split("\\n");
  const start = (args.offset || 1) - 1;
  const count = args.limit || 200;
  if (start > lines.length) throw new Error("offset exceeds file length");
  let content = lines.slice(start, start + count).join("\\n");
  if (content.length > 64000) throw new Error("Selected lines exceed 64000 characters; use a smaller line range");
  const end = Math.min(start + count, lines.length);
  return { path: file.path, revision: file.revision, content, totalLines: lines.length, ...(end < lines.length ? { nextOffset: end + 1 } : {}) };
}`;

const WRITE_V2_SOURCE = `async function main(args, api) {
  if (args.createParents) {
    const slash = args.path.lastIndexOf("/");
    if (slash > 0) await api.fs.mkdir(args.path.slice(0, slash), { recursive: true });
  }
  const file = await api.fs.writeFile(args.path, args.content, { expectedRevision: args.expectedRevision === undefined ? 0 : args.expectedRevision });
  return { path: file.path, revision: file.revision, characters: file.content.length };
}`;

export const DEFAULT_BIN_TOOLS: readonly BinDefinition[] = [
  {
    version: 1, name: "skill_load", description: "Read a skill's SKILL.md from the available skill catalog. Follow its instructions and use absolute paths to read its resources.",
    parameters: object({ name: Type.String({ minLength: 1 }) }), capabilities: ["loadSkill"],
    source: "async function main(args, api) { return api.skills.load(args.name); }"
  },
  {
    version: 1, name: "read", description: "Read UTF-8 files with revisions. path accepts one path string or an array of up to 32 paths; use an array to read independent files together. offset is a 1-based line number and limit defaults to 200. Follow nextOffset for more.",
    parameters: object({ path: Type.Union([path, Type.Array(path, { minItems: 1, maxItems: 32 })]), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit }), capabilities: ["readFile"],
    source: `async function main(args, api) {
  const readOne = ${READ_V1_SOURCE};
  if (!Array.isArray(args.path)) return readOne(args, api);
  const files = [];
  for (const path of args.path) files.push(await readOne({ ...args, path }, api));
  return { files };
}`
  },
  {
    version: 1, name: "write", description: "Write UTF-8 files. Use path/content for one file or files:[{path,content,expectedRevision?}] to create several files atomically in one call. Existing files require expectedRevision. createParents=true creates missing parent directories.",
    parameters: Type.Object({ path: Type.Optional(path), content: Type.Optional(Type.String({ maxLength: 524288 })), expectedRevision: revision, createParents: Type.Optional(Type.Boolean()), files: Type.Optional(Type.Array(object({ path, content: Type.String({ maxLength: 524288 }), expectedRevision: revision }), { minItems: 1, maxItems: 32 })) }, { additionalProperties: false, anyOf: [{ required: ["path", "content"] }, { required: ["files"] }] }), capabilities: ["writeFile", "writeFiles", "mkdir"],
    source: `async function main(args, api) {
  const writeOne = ${WRITE_V2_SOURCE};
  if (!args.files) return writeOne(args, api);
  if (args.path !== undefined || args.content !== undefined) throw new Error("Use files or path/content, not both");
  if (args.createParents) {
    for (const file of args.files) {
      const slash = file.path.lastIndexOf("/");
      if (slash > 0) await api.fs.mkdir(file.path.slice(0, slash), { recursive: true });
    }
  }
  const files = await api.fs.writeFiles(args.files.map(file => ({ ...file, expectedRevision: file.expectedRevision === undefined ? 0 : file.expectedRevision })));
  return { files: files.map(file => ({ path: file.path, revision: file.revision, characters: file.content.length })) };
}`
  },
  {
    version: 1, name: "edit", description: "Replace exact oldText in a file with newText. Ambiguous matches fail unless replaceAll is true. Uses revision conflict detection.",
    parameters: object({ path, oldText: Type.String({ minLength: 1 }), newText: Type.String(), replaceAll: Type.Optional(Type.Boolean()), expectedRevision: revision }), capabilities: ["readFile", "writeFile"],
    source: `async function main(args, api) {
  const file = await api.fs.readFile(args.path);
  if (args.expectedRevision !== undefined && args.expectedRevision !== file.revision) throw new Error("File changed; read it again");
  const parts = file.content.split(args.oldText);
  const matches = parts.length - 1;
  if (!matches) throw new Error("oldText was not found; no changes made");
  if (matches > 1 && !args.replaceAll) throw new Error("oldText is ambiguous; include more context or set replaceAll");
  const content = parts.join(args.newText);
  const updated = await api.fs.writeFile(args.path, content, { expectedRevision: file.revision });
  return { path: updated.path, revision: updated.revision, replacements: matches };
}`
  },
  {
    version: 1, name: "ls", description: "List immediate children of a directory, including hidden files. Default path is the current working directory.",
    parameters: object({ path: Type.Optional(path) }), capabilities: ["listDirectory"],
    source: `async function main(args, api) {
  const entries = await api.fs.listDirectory(args.path || ".");
  return { entries: entries.map(({path, kind, revision}) => ({path, kind, revision})) };
}`
  },
  {
    version: 1, name: "find", description: "Find files and directories recursively. name is an optional basename glob (* and ?); type can be file or directory. Results are bounded.",
    parameters: object({ path: Type.Optional(path), name: Type.Optional(Type.String({ maxLength: 256 })), type: Type.Optional(Type.Union([Type.Literal("file"), Type.Literal("directory")])), limit }), capabilities: ["stat", "listDirectory"],
    source: `async function main(args, api) {
  const pattern = args.name;
  const match = (name) => {
    if (pattern === undefined) return true;
    let expression = "^";
    for (const c of pattern) expression += c === "*" ? ".*" : c === "?" ? "." : "\\\\^$+.[(){}]|".includes(c) ? "\\\\" + c : c;
    return new RegExp(expression + "$", "u").test(name);
  };
  const queue = [await api.fs.stat(args.path || ".")];
  const entries = [];
  const maximum = args.limit || 100;
  while (queue.length) {
    const node = queue.shift();
    if ((!args.type || node.kind === args.type) && match(node.path.split("/").pop())) {
      if (entries.length >= maximum) return { entries, truncated: true };
      entries.push({ path: node.path, kind: node.kind, revision: node.revision });
    }
    if (node.kind === "directory") queue.push(...await api.fs.listDirectory(node.path));
  }
  return { entries, truncated: false };
}`
  },
  {
    version: 1, name: "grep", description: "Search file contents recursively and return matching lines with paths and 1-based line numbers. Literal search by default; regex and ignoreCase are optional.",
    parameters: object({ pattern: Type.String({ minLength: 1, maxLength: 1024 }), path: Type.Optional(path), regex: Type.Optional(Type.Boolean()), ignoreCase: Type.Optional(Type.Boolean()), limit }), capabilities: ["stat", "listDirectory", "readFile"],
    source: `async function main(args, api) {
  const expression = args.regex ? new RegExp(args.pattern, args.ignoreCase ? "iu" : "u") : undefined;
  const needle = args.ignoreCase ? args.pattern.toLowerCase() : args.pattern;
  const queue = [await api.fs.stat(args.path || ".")];
  const matches = [];
  const maximum = args.limit || 100;
  while (queue.length) {
    const node = queue.shift();
    if (node.kind === "directory") { queue.push(...await api.fs.listDirectory(node.path)); continue; }
    const file = await api.fs.readFile(node.path);
    const lines = file.content.split("\\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (expression ? expression.test(line) : (args.ignoreCase ? line.toLowerCase() : line).includes(needle)) {
        if (matches.length >= maximum) return { matches, truncated: true };
        if (line.length > 16000) throw new Error("Matching line exceeds 16000 characters");
        matches.push({ path: file.path, revision: file.revision, line: index + 1, text: line });
      }
    }
  }
  return { matches, truncated: false };
}`
  }
];

/** Seed only missing files. User edits and new bin tools survive upgrades and reloads. */
export async function installDefaultBin(fs: VirtualFileSystem): Promise<void> {
  await fs.mkdir(BIN_DIRECTORY, { recursive: true });
  for (const { source, ...manifest } of DEFAULT_BIN_TOOLS) {
    if (manifest.name === "read") {
      try {
        const oldSource = await fs.readFile(`${BIN_DIRECTORY}/read.js`);
        const oldMetadata = await fs.readFile(`${BIN_DIRECTORY}/read.tool.json`);
        const expected = { ...manifest, description: "Read UTF-8 file content and its revision. offset is a 1-based line number; limit defaults to 200. Follow nextOffset to read more.", parameters: object({ path, offset: Type.Optional(Type.Integer({ minimum: 1 })), limit }) };
        if (oldSource.content === READ_V1_SOURCE && JSON.stringify(JSON.parse(oldMetadata.content)) === JSON.stringify(expected)) {
          await fs.writeFiles([{ path: `${BIN_DIRECTORY}/read.js`, content: source, expectedRevision: oldSource.revision }, { path: `${BIN_DIRECTORY}/read.tool.json`, content: JSON.stringify(manifest, null, 2), expectedRevision: oldMetadata.revision }]);
        }
      } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "not_found")) throw error; }
    }
    if (manifest.name === "write") {
      try {
        const oldSource = await fs.readFile(`${BIN_DIRECTORY}/write.js`);
        const oldMetadata = await fs.readFile(`${BIN_DIRECTORY}/write.tool.json`);
        const v2 = { ...manifest, description: "Create or replace a UTF-8 file. For an existing file read it first and supply expectedRevision. Set createParents=true to create missing parent directories.", parameters: object({ path, content: Type.String({ maxLength: 524288 }), expectedRevision: revision, createParents: Type.Optional(Type.Boolean()) }), capabilities: ["writeFile", "mkdir"] };
        const v1 = { ...manifest, description: "Create or replace a UTF-8 file. For an existing file read it first and supply expectedRevision. Parent directories must exist.", parameters: object({ path, content: Type.String({ maxLength: 524288 }), expectedRevision: revision }), capabilities: ["writeFile"] };
        const parents = '  if (args.createParents) {\n    const slash = args.path.lastIndexOf("/");\n    if (slash > 0) await api.fs.mkdir(args.path.slice(0, slash), { recursive: true });\n  }\n';
        const exactV2 = oldSource.content === WRITE_V2_SOURCE && JSON.stringify(JSON.parse(oldMetadata.content)) === JSON.stringify(v2);
        const exactV1 = oldSource.content === WRITE_V2_SOURCE.replace(parents, "") && JSON.stringify(JSON.parse(oldMetadata.content)) === JSON.stringify(v1);
        if (exactV1 || exactV2) await fs.writeFiles([{ path: `${BIN_DIRECTORY}/write.js`, content: source, expectedRevision: oldSource.revision }, { path: `${BIN_DIRECTORY}/write.tool.json`, content: JSON.stringify(manifest, null, 2), expectedRevision: oldMetadata.revision }]);
      } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "not_found")) throw error; }
    }
    for (const [path, content] of [[`${BIN_DIRECTORY}/${manifest.name}.js`, source], [`${BIN_DIRECTORY}/${manifest.name}.tool.json`, JSON.stringify(manifest, null, 2)]]) {
      try { await fs.writeFile(path, content, { expectedRevision: 0 }); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "conflict")) throw error; }
    }
  }
}
