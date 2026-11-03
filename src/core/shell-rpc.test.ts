// @vitest-environment node
import { expect, it } from "vitest";
import { MemoryFileSystem } from "./fs";
import { JustBashFileSystem } from "./just-bash-fs";
import { executeShellRpc } from "./shell-rpc";
import { runShellScript } from "./shell-execution";

it("rejects untrusted capabilities, paths, encoding, options and malformed metadata before mutation", async () => {
  const fs = new MemoryFileSystem(), adapter = new JustBashFileSystem(fs);
  const bad: [unknown, unknown][] = [
    ["constructor", ["/home/user"]], ["writeFile", ["relative", "bad"]], ["writeFile", ["/home/user/file", "bad", "bogus"]],
    ["mkdir", ["/home/user/new", { recursive: "true" }]], ["createExclusive", ["/home/user/new", { directory: true }]],
    ["chmod", ["/home/user/file", -1]], ["utimes", ["/home/user/file", "today", "today"]],
    ["cp", ["/home/user/a", "relative"]], ["symlink", ["target", "/home/user/with\0nul"]]
  ];
  for (const [method, args] of bad) await expect(executeShellRpc(adapter, method, args)).rejects.toThrow("EINVAL");
  expect(await fs.listDirectory("~")).toEqual([]);
  await executeShellRpc(adapter, "writeFile", ["/home/user/file", new Uint8Array([0, 255])]);
  await executeShellRpc(adapter, "symlink", ["file", "/home/user/link"]);
  expect(await executeShellRpc(adapter, "readFileBuffer", ["/home/user/link"])).toEqual(new Uint8Array([0, 255]));
});

it("uses independent scripts, actual cwd and bounded commands in the formal execution path", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/usr"); await fs.mkdir("/tmp");
  const adapter = new JustBashFileSystem(fs);
  const first = await runShellScript("mkdir -p ~/docs; cd ~/docs; export VALUE=one; PWD=/tmp; printf hi > file; exit 7", adapter, { cwd: "/home/user" });
  expect(first).toMatchObject({ exitCode: 7, cwd: "/home/user/docs" });
  expect((await fs.readFile("~/docs/file")).content).toBe("hi");
  const next = await runShellScript('echo ${VALUE-unset}; cat file', adapter, { cwd: first.cwd });
  expect(next).toMatchObject({ stdout: "unset\nhi", exitCode: 0 });
  for (const command of ["curl example.com", "node -e '1'", "python3 -c '1'", "gzip file", "sqlite3 :memory:"]) expect((await runShellScript(command, adapter, { cwd: first.cwd })).exitCode).not.toBe(0);
  const limited = await runShellScript("while true; do :; done", adapter, { cwd: first.cwd, maxSteps: 20 });
  expect(limited.exitCode).not.toBe(0); expect(limited.stderr).toMatch(/limit|iterations/i);
});
