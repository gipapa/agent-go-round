import { parse as parseYaml } from "yaml";
import { errorMessage } from "../utils/errors";

export type SkillPackageFile = {
  path: string;
  content: string | Uint8Array;
  mediaType?: string;
  byteSize?: number;
};

export type SkillPackageDiagnostic = {
  code:
    | "empty_package"
    | "invalid_path"
    | "path_too_long"
    | "absolute_path"
    | "root_escape"
    | "duplicate_path"
    | "multiple_roots"
    | "missing_skill_file"
    | "duplicate_skill_file"
    | "invalid_file_content"
    | "binary_skill_file"
    | "package_too_large"
    | "too_many_files"
    | "file_too_large"
    | "malformed_frontmatter"
    | "missing_name"
    | "invalid_name"
    | "missing_description"
    | "description_too_long"
    | "instructions_too_large";
  path?: string;
  message: string;
};

export type ParsedSkillFrontmatter = {
  name: string;
  description: string;
  version?: string;
  disableModelInvocation: boolean;
  metadata: Record<string, unknown>;
  instructions: string;
};

export type ValidatedSkillPackage = {
  ok: boolean;
  rootPath?: string;
  skillFilePath?: string;
  manifest?: ParsedSkillFrontmatter;
  files: SkillPackageFile[];
  packageByteSize: number;
  diagnostics: SkillPackageDiagnostic[];
};

export const SKILL_PACKAGE_LIMITS = {
  maxFiles: 1_000,
  maxPackageBytes: 2 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxPathChars: 1_024,
  maxInstructionsChars: 16_000,
  maxDescriptionChars: 1_024
};

function normalizedBinaryContent(content: unknown): Uint8Array | null {
  if (content instanceof Uint8Array) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength).slice();
  }
  if (content instanceof ArrayBuffer) return new Uint8Array(content).slice();
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength).slice();
  }
  return null;
}

function add(diagnostics: SkillPackageDiagnostic[], diagnostic: SkillPackageDiagnostic) {
  diagnostics.push(diagnostic);
}

export function normalizeSkillPackagePath(path: string) {
  return typeof path === "string" ? path.replaceAll("\\", "/").replace(/^\.\//, "") : "";
}

export function parseStandardSkillDocument(markdown: string): ParsedSkillFrontmatter | SkillPackageDiagnostic {
  if (typeof markdown !== "string") {
    return { code: "malformed_frontmatter", message: "SKILL.md must be a UTF-8 text file." };
  }
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { code: "malformed_frontmatter", message: "SKILL.md must start with a YAML frontmatter block." };
  }
  let document: unknown;
  try {
    document = parseYaml(match[1]);
  } catch (error) {
    return { code: "malformed_frontmatter", message: `SKILL.md frontmatter is invalid: ${errorMessage(error)}` };
  }
  const record = document && typeof document === "object" && !Array.isArray(document) ? document as Record<string, unknown> : {};
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!name) return { code: "missing_name", message: "SKILL.md frontmatter requires name." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    return { code: "invalid_name", message: "Skill name must be lowercase hyphenated text up to 64 characters." };
  }
  if (!description) return { code: "missing_description", message: "SKILL.md frontmatter requires description." };
  if (description.length > SKILL_PACKAGE_LIMITS.maxDescriptionChars) {
    return { code: "description_too_long", message: `Skill description exceeds ${SKILL_PACKAGE_LIMITS.maxDescriptionChars} characters.` };
  }
  const instructions = markdown.slice(match[0].length).trim();
  if (instructions.length > SKILL_PACKAGE_LIMITS.maxInstructionsChars) {
    return { code: "instructions_too_large", message: `Skill instructions exceed ${SKILL_PACKAGE_LIMITS.maxInstructionsChars} characters.` };
  }
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : {};
  return {
    name,
    description,
    version: typeof record.version === "string" ? record.version.trim() || undefined : undefined,
    disableModelInvocation: record["disable-model-invocation"] === true,
    metadata,
    instructions
  };
}

export function validateSkillPackage(files: SkillPackageFile[], limits = SKILL_PACKAGE_LIMITS): ValidatedSkillPackage {
  const diagnostics: SkillPackageDiagnostic[] = [];
  const inputFiles = Array.isArray(files) ? files : [];
  if (!inputFiles.length) {
    add(diagnostics, { code: "empty_package", message: "Skill package is empty." });
    return { ok: false, files: [], packageByteSize: 0, diagnostics };
  }
  if (inputFiles.length > limits.maxFiles) {
    add(diagnostics, { code: "too_many_files", message: `Skill package contains more than ${limits.maxFiles} files.` });
  }
  let totalBytes = 0;
  const normalizedFiles: SkillPackageFile[] = [];
  const seen = new Set<string>();
  const seenCaseInsensitive = new Set<string>();
  const roots = new Set<string>();
  for (const file of inputFiles) {
    if (!file || typeof file !== "object") {
      add(diagnostics, { code: "invalid_file_content", message: "Skill package contains an invalid file entry." });
      continue;
    }
    const rawPath = file.path;
    const path = normalizeSkillPackagePath(rawPath);
    if (path.length > limits.maxPathChars) {
      add(diagnostics, { code: "path_too_long", path: path.slice(0, 256), message: `Skill package paths cannot exceed ${limits.maxPathChars} characters.` });
      continue;
    }
    const parts = path.split("/");
    if (!path || path.includes("\0") || parts.some((part) => !part || part === ".")) {
      add(diagnostics, { code: "invalid_path", path: typeof rawPath === "string" ? rawPath : undefined, message: "Skill package paths must be non-empty relative paths." });
      continue;
    }
    if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
      add(diagnostics, { code: "absolute_path", path, message: "Absolute skill package paths are not allowed." });
      continue;
    }
    if (parts.includes("..")) {
      add(diagnostics, { code: "root_escape", path, message: "Skill package paths cannot escape their root." });
      continue;
    }
    if (seen.has(path) || seenCaseInsensitive.has(path.toLocaleLowerCase())) {
      add(diagnostics, { code: "duplicate_path", path, message: "Duplicate skill package path." });
      continue;
    }
    seen.add(path);
    seenCaseInsensitive.add(path.toLocaleLowerCase());
    roots.add(parts[0]);
    // Never trust a caller-provided byteSize for containment decisions. It is
    // metadata only; the actual payload determines package/file limits.
    const normalizedContent = typeof file.content === "string" ? file.content : normalizedBinaryContent(file.content);
    if (normalizedContent === null) {
      add(diagnostics, { code: "invalid_file_content", path, message: "Skill package file content must be text or binary bytes." });
      continue;
    }
    const bytes = typeof normalizedContent === "string" ? new TextEncoder().encode(normalizedContent).byteLength : normalizedContent.byteLength;
    totalBytes += bytes;
    if (bytes > limits.maxFileBytes) add(diagnostics, { code: "file_too_large", path, message: `File exceeds ${limits.maxFileBytes} bytes.` });
    normalizedFiles.push({ ...file, path, content: normalizedContent });
  }
  if (roots.size !== 1) add(diagnostics, { code: "multiple_roots", message: "A skill package must contain exactly one root directory." });
  if (totalBytes > limits.maxPackageBytes) add(diagnostics, { code: "package_too_large", message: `Package exceeds ${limits.maxPackageBytes} bytes.` });

  const skillFiles = normalizedFiles.filter((file) => file.path.split("/").slice(1).join("/").toLowerCase() === "skill.md");
  if (!skillFiles.length) add(diagnostics, { code: "missing_skill_file", message: "Package must contain exactly one root/SKILL.md." });
  if (skillFiles.length > 1) add(diagnostics, { code: "duplicate_skill_file", message: "Package contains more than one SKILL.md." });
  const skillFile = skillFiles[0];
  let manifest: ParsedSkillFrontmatter | undefined;
  const skillFileContent = skillFile?.content;
  if (skillFile && typeof skillFileContent !== "string") {
    add(diagnostics, { code: "binary_skill_file", path: skillFile.path, message: "SKILL.md must be a UTF-8 text file." });
  } else if (skillFile && typeof skillFileContent === "string") {
    const parsed = parseStandardSkillDocument(skillFileContent);
    if ("code" in parsed) add(diagnostics, { ...parsed, path: skillFile.path });
    else manifest = parsed;
  }
  return {
    ok: diagnostics.length === 0,
    rootPath: roots.size === 1 ? Array.from(roots)[0] : undefined,
    skillFilePath: skillFile?.path,
    manifest,
    files: normalizedFiles,
    packageByteSize: totalBytes,
    diagnostics
  };
}
