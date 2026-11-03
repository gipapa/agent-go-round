import { InMemoryFs, MountableFs, type IFileSystem } from "just-bash/browser";

/** Resolve links in the combined virtual namespace, before selecting a mount.
 * MountableFs 3.6.0 otherwise follows an absolute link inside its own backend.
 */
export function mountShellFileSystem(workspace: IFileSystem): IFileSystem {
  const fs = new MountableFs({ base: workspace, mounts: ["/bin", "/usr/bin", "/dev", "/proc"].map(mountPoint => ({ mountPoint, filesystem: new InMemoryFs() })) });
  const resolve = async (path: string, followFinal: boolean, missingFinal = false): Promise<string> => {
    const trailingSlash = path.endsWith("/");
    let parts = (path.startsWith("/") ? path : workspace.resolvePath("/", path)).split("/").filter(Boolean);
    let current = "/", links = 0;
    while (parts.length) {
      const component = parts.shift()!;
      const directory = await fs.lstat(current);
      if (!directory.isDirectory) throw new Error(`ENOTDIR: ${current}`);
      if (component === ".") continue;
      if (component === "..") { current = current.slice(0, current.lastIndexOf("/")) || "/"; continue; }
      const next = (current === "/" ? "" : current) + "/" + component;
      let entry;
      try { entry = await fs.lstat(next); }
      catch (error) { if (missingFinal && !parts.length && !trailingSlash && error instanceof Error && error.message.startsWith("ENOENT:")) return next; throw error; }
      if (entry.isSymbolicLink && (followFinal || parts.length || trailingSlash)) {
        if (++links > 40) throw new Error(`ELOOP: ${path}`);
        const target = await fs.readlink(next);
        parts = [...target.split("/").filter(Boolean), ...parts];
        if (target.startsWith("/")) current = "/";
      } else current = next;
    }
    if (trailingSlash && !(await fs.lstat(current)).isDirectory) throw new Error(`ENOTDIR: ${current}`);
    return current;
  };
  const read = new Set(["readFile", "readFileBuffer", "readFileBytes", "stat", "readdir", "chmod", "utimes"]);
  return new Proxy(fs, {
    get(target, key) {
      if (key === "realpath") return (path: string) => resolve(path, true);
      if (key === "exists") return async (path: string) => {
        try { await resolve(path, true); return true; }
        catch (error) { if (error instanceof Error && /^(ENOENT|ENOTDIR):/.test(error.message)) return false; throw error; }
      };
      if (key === "lstat" || key === "readlink") return async (path: string) => target[key](await resolve(path, false));
      if (key === "readdirWithFileTypes") return async (path: string) => {
        const resolved = await resolve(path, true);
        return Promise.all((await target.readdir(resolved)).map(async name => {
          const entry = await target.lstat((resolved === "/" ? "" : resolved) + "/" + name);
          return { name, isFile: entry.isFile, isDirectory: entry.isDirectory, isSymbolicLink: entry.isSymbolicLink };
        }));
      };
      if (typeof key === "string" && read.has(key)) return async (path: string, ...args: unknown[]) => {
        const resolved = await resolve(path, true);
        const method = Reflect.get(target, key);
        return method.apply(target, [resolved, ...args]);
      };
      if (key === "writeFile" || key === "appendFile") return async (path: string, content: string | Uint8Array, options?: Parameters<IFileSystem["writeFile"]>[2]) => target[key](await resolve(path, true, true), content, options);
      if (key === "mkdir") return async (path: string, options?: { recursive?: boolean }) => {
        if (!options?.recursive) return target.mkdir(await resolve(path, false, true), options);
        // Create each missing ancestor through the owning backend. Existing
        // cross-mount symlinks resolve globally, just as read/write do.
        const segments = workspace.resolvePath("/", path).split("/").filter(Boolean);
        let current = "/";
        for (const segment of segments) {
          const next = await resolve((current === "/" ? "" : current) + "/" + segment, true, true);
          await target.mkdir(next, { recursive: true }); current = next;
        }
      };
      if (key === "createExclusive") return async (path: string, options: Parameters<NonNullable<IFileSystem["createExclusive"]>>[1]) => target.createExclusive(await resolve(options.directory ? path.replace(/\/+$/, "") || "/" : path, false, true), options);
      if (key === "symlink") return async (destination: string, path: string) => target.symlink(destination, await resolve(path, false, true));
      if (key === "link") return () => Promise.reject(new Error("ENOSYS: Hard links are not supported by the workspace shell"));
      if (key === "cp" || key === "mv") return async (from: string, to: string, options?: Parameters<IFileSystem["cp"]>[2]) => target[key](await resolve(from, false), await resolve(to, false, true), options);
      if (key === "rm") return async (path: string, options?: Parameters<IFileSystem["rm"]>[1]) => {
        try { await target.rm(await resolve(path, false), options); }
        catch (error) { if (options?.force && error instanceof Error && error.message.startsWith("ENOENT:")) return; throw error; }
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
