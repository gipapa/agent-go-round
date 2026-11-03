import { build } from "esbuild";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** A single self-contained program can be given to a blob Worker in an opaque
 * iframe. It needs no imports, origin credentials, network or app globals.
 */
export function shellWorkerPlugin(projectRoot: string): Plugin {
  const id = "virtual:agent-go-round-shell-worker";
  return {
    name: "agent-go-round-shell-worker",
    resolveId(source) { if (source === id) return "\0" + id; },
    async load(source) {
      if (source !== "\0" + id) return;
      const result = await build({ entryPoints: [resolve(projectRoot, "src/core/shell.worker.ts")], bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, legalComments: "inline", alias: { "node:zlib": resolve(projectRoot, "src/core/browser-zlib.ts") } });
      for (const file of ["src/core/shell.worker.ts", "src/core/shell-execution.ts", "src/core/shell-engine.ts", "src/core/shell-rpc.ts", "src/core/shell-filesystem.ts"]) this.addWatchFile(resolve(projectRoot, file));
      return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
    }
  };
}
