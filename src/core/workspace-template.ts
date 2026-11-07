/** Paths under workspace/ mirror the virtual root. .gitkeep retains empty directories only. */
const sources = import.meta.glob<string>("../../workspace/**/*", { eager: true, query: "?raw", import: "default", exhaustive: true });
export const INITIAL_WORKSPACE_FILES = Object.entries(sources)
  .filter(([path]) => !path.endsWith("/.gitkeep"))
  .map(([path, content]) => ({ path: path.slice("../../workspace".length), content }));

const directories = new Set<string>();
for (const path of Object.keys(sources)) {
  let directory = path.slice("../../workspace".length);
  while ((directory = directory.slice(0, directory.lastIndexOf("/")))) directories.add(directory);
}
export const INITIAL_WORKSPACE_DIRECTORIES = [...directories].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
