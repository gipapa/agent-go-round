import type { BinCapability } from "./file-capabilities";
import type { TSchema } from "@earendil-works/pi-ai";
import { FileSystemError, resolvePath, type VirtualFileSystem } from "./fs";
import { INITIAL_WORKSPACE_FILES } from "./workspace-template";
import { LEGACY_FILE_TOOL_MANIFESTS } from "./bin-defaults-legacy";
import { RETIRED_DEFAULT_BIN_TOOLS } from "./bin-retired";

export const BIN_DIRECTORY = "~/bin";
export const BIN_MANIFEST_DIRECTORY = "~/bin/manifests";
export { FILE_METHODS, BIN_CAPABILITIES } from "./file-capabilities";
export type { FileMethod, BinCapability } from "./file-capabilities";
export type BinManifest = {
  version: 1;
  name: string;
  description: string;
  parameters: TSchema;
  capabilities: BinCapability[];
};
export type BinDefinition = BinManifest & { source: string };
/** The checked-in workspace is the source of truth for editable bin files. */
export const DEFAULT_BIN_TOOLS: readonly BinDefinition[] = INITIAL_WORKSPACE_FILES
  .filter(file => file.path.startsWith("/home/user/bin/manifests/") && file.path.endsWith(".tool.json"))
  .map(file => {
    const manifest = JSON.parse(file.content) as BinManifest;
    const source = INITIAL_WORKSPACE_FILES.find(file => file.path === `/home/user/bin/${manifest.name}.js`);
    if (!source) throw new Error(`Missing initial tool source: ${manifest.name}`);
    return { ...manifest, source: source.content };
  });

/** Seed missing files; upgrade known default guidance only when both files are unmodified. */
export async function installDefaultBin(fs: VirtualFileSystem): Promise<void> {
  await fs.mkdir(BIN_MANIFEST_DIRECTORY, { recursive: true });
  for (const { source, ...manifest } of RETIRED_DEFAULT_BIN_TOOLS) {
    const jsPath = `${BIN_DIRECTORY}/${manifest.name}.js`;
    const jsonPath = `${BIN_MANIFEST_DIRECTORY}/${manifest.name}.tool.json`;
    try {
      const js = await fs.readFile(jsPath), json = await fs.readFile(jsonPath);
      if (js.path !== resolvePath(jsPath) || json.path !== resolvePath(jsonPath)) continue;
      if (js.content !== source || json.content !== JSON.stringify(manifest, null, 2)) continue;
      await fs.removeFiles([
        { path: js.path, expectedRevision: js.revision, expectedContent: js.content },
        { path: json.path, expectedRevision: json.revision, expectedContent: json.content }
      ]);
    } catch (error) {
      if (!(error instanceof FileSystemError) || !["not_found", "conflict", "wrong_kind", "invalid_encoding"].includes(error.code)) throw error;
    }
  }
  for (const { source, ...manifest } of DEFAULT_BIN_TOOLS) {
    const manifestContent = INITIAL_WORKSPACE_FILES.find(file => file.path === resolvePath(`${BIN_MANIFEST_DIRECTORY}/${manifest.name}.tool.json`))!.content;
    const legacy = LEGACY_FILE_TOOL_MANIFESTS.find(tool => tool.name === manifest.name);
    if (legacy) {
      try {
        const js = await fs.readFile(`${BIN_DIRECTORY}/${manifest.name}.js`);
        const json = await fs.readFile(`${BIN_MANIFEST_DIRECTORY}/${manifest.name}.tool.json`);
        // Compare exact old definitions, never infer ownership from a tool name.
        if (js.content === source && json.content === JSON.stringify(legacy, null, 2)) {
          await fs.writeFiles([
            { path: js.path, content: source, expectedRevision: js.revision },
            { path: json.path, content: manifestContent, expectedRevision: json.revision }
          ]);
        }
      } catch (error) {
        if (!(error instanceof FileSystemError) || !["not_found", "conflict"].includes(error.code)) throw error;
      }
    }
    for (const [path, content] of [[`${BIN_DIRECTORY}/${manifest.name}.js`, source], [`${BIN_MANIFEST_DIRECTORY}/${manifest.name}.tool.json`, manifestContent]]) {
      try { await fs.writeFile(path, content, { expectedRevision: 0 }); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "conflict")) throw error; }
    }
  }
}
