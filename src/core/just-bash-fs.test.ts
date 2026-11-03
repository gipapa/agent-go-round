// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { Bash, InMemoryFs, MountableFs } from "just-bash/browser";
import { describe, expect, it } from "vitest";
import { IndexedDbFileSystem, MemoryFileSystem } from "./fs";
import { JustBashFileSystem, decodeFileBytes, encodeFileBytes } from "./just-bash-fs";
import { mountShellFileSystem } from "./shell-filesystem";

describe.each([
  ["memory", () => new MemoryFileSystem()],
  ["indexeddb", () => new IndexedDbFileSystem(new IDBFactory())]
] as const)("%s just-bash adapter", (_name, create) => {
  it("runs the plan's representative shell script directly against the VFS", async () => {
    const vfs = create(), fs = new JustBashFileSystem(vfs);
    await vfs.mkdir("~", { recursive: true });
    const bash = new Bash({ fs, cwd: "/home/user", env: { HOME: "/home/user" } });
    const result = await bash.exec(`mkdir -p ~/docs && cd ~/docs
printf 'hello\\n世界\\n' > notes.txt
cat notes.txt | grep hello > matches.txt
printf 'more\\n' >> notes.txt
cat *.txt | wc -l
test -f matches.txt && echo ok
cat <<'EOF' > literal.txt
$HOME is literal here
EOF
for f in *.txt; do echo "$f"; done`, { rawScript: true });
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "4\nok\nliteral.txt\nmatches.txt\nnotes.txt\n", env: { PWD: "/home/user/docs" } });
    expect((await vfs.readFile("~/docs/notes.txt")).content).toBe("hello\n世界\nmore\n");
    await vfs.writeFile("~/docs/from-tool", "structured write");
    expect((await bash.exec("cat ~/docs/from-tool")).stdout).toBe("structured write");
    expect((await bash.exec("printf AP+A | base64 -d > ~/binary; cat ~/binary | base64")).stdout).toBe("AP+A\n");
    expect((await vfs.readBytes("~/binary")).content).toEqual(new Uint8Array([0, 255, 128]));
    expect(fs.getAllPaths()).toEqual([]);
    expect(bash.getCwd()).toBe("/home/user");
    expect((await bash.exec("pwd; echo ${UNSET-unset}")).stdout).toBe("/home/user\nunset\n");
  });

  it("uses native metadata, atomic primitives and symbolic links for shell commands", async () => {
    const vfs = create(), fs = new JustBashFileSystem(vfs);
    await vfs.mkdir("/tmp");
    const bash = new Bash({ fs, cwd: "/home/user", env: { HOME: "/home/user", TMPDIR: "/tmp" } });
    const result = await bash.exec(`printf 'one' > a
ln -s /home/user/a absolute
cat absolute
printf 'two' >> absolute
cp a b
mv b c
chmod 600 c
touch -d 2020-01-02 c
test -L absolute && test -f absolute && test -f c
mktemp /tmp/probe.XXXXXX`);
    expect(result.stderr).toBe(""); expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^one\/tmp\/probe\.[A-Za-z0-9]+\n$/);
    expect((await vfs.readFile("~/a")).content).toBe("onetwo");
    expect(await vfs.stat("~/c")).toMatchObject({ mode: 0o600 });
    expect((await fs.stat("/home/user/c")).mtime.getUTCFullYear()).toBe(2020);
    expect(await fs.lstat("/home/user/absolute")).toMatchObject({ isSymbolicLink: true, isFile: false });
    expect(await fs.readdirWithFileTypes("/home/user")).toContainEqual({ name: "absolute", isFile: false, isDirectory: false, isSymbolicLink: true });
    await expect(fs.link("/home/user/a", "/home/user/hard")).rejects.toThrow("ENOSYS");
    expect((await bash.exec("ln a hard")).exitCode).not.toBe(0);
    expect(await fs.exists("/home/user/hard")).toBe(false);
  });

  it("converts errors and follows links for bytes while preserving exclusive collisions", async () => {
    const fs = new JustBashFileSystem(create());
    await expect(fs.readFile("~/missing")).rejects.toThrow("ENOENT:");
    await fs.mkdir("~/directory");
    await expect(fs.mkdir("~/directory")).rejects.toThrow("EEXIST:");
    await expect(fs.readFile("~/directory")).rejects.toThrow("EISDIR:");
    await fs.writeFile("~/binary", "00ff80", "hex");
    await fs.symlink("binary", "~/link");
    expect(await fs.readFile("~/link", "base64")).toBe("AP+A");
    await expect(fs.readFile("~/binary")).rejects.toThrow("EILSEQ:");
    await expect(fs.readdir("~/binary")).rejects.toThrow("ENOTDIR:");
    await expect(fs.readlink("~/binary")).rejects.toThrow("EINVAL:");
    await expect(fs.createExclusive("~/link", { mode: 0o600 })).rejects.toThrow("EEXIST:");
    await fs.symlink("loop", "~/loop");
    await expect(fs.stat("~/loop")).rejects.toThrow("ELOOP:");
    await fs.rm("~/missing", { force: true });
  });
});

it("supports explicit encodings with byte-preserving binary and strict UTF-8", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (const format of ["hex", "base64", "latin1", "binary"] as const) expect(encodeFileBytes(decodeFileBytes(bytes, format), format)).toEqual(bytes);
  expect(encodeFileBytes("😀", "latin1")).toEqual(new Uint8Array([61, 0]));
  expect(decodeFileBytes(new Uint8Array([0xff]), "ascii")).toBe("\x7f");
  expect(encodeFileBytes("AP-A", "base64")).toEqual(new Uint8Array([0, 255, 128]));
  expect(() => encodeFileBytes("f", "hex")).toThrow("EINVAL");
  expect(() => encodeFileBytes("!", "base64")).toThrow("EINVAL");
});

it("moves byte files across a runtime mount and reloads the persisted side", async () => {
  const factory = new IDBFactory(), vfs = new IndexedDbFileSystem(factory, "mounted");
  await vfs.mkdir("~", { recursive: true });
  const fs = new MountableFs({ base: new JustBashFileSystem(vfs), mounts: [{ mountPoint: "/scratch", filesystem: new InMemoryFs() }] });
  await fs.writeFile("/scratch/raw", new Uint8Array([0, 255]));
  await fs.cp("/scratch/raw", "/home/user/copied");
  await fs.mv("/home/user/copied", "/scratch/moved");
  expect(await fs.readFileBuffer("/scratch/moved")).toEqual(new Uint8Array([0, 255]));
  expect(await fs.exists("/home/user/copied")).toBe(false);
  await fs.cp("/scratch/moved", "/home/user/saved");
  expect((await new IndexedDbFileSystem(factory, "mounted").readBytes("~/saved")).content).toEqual(new Uint8Array([0, 255]));
});

it("resolves links across runtime mounts without treating absolute targets as mount-relative", async () => {
  const vfs = new MemoryFileSystem();
  await vfs.mkdir("/usr"); await vfs.mkdir("/tmp");
  const fs = mountShellFileSystem(new JustBashFileSystem(vfs));
  const bash = new Bash({ fs, cwd: "/home/user", env: { HOME: "/home/user" } });
  const result = await bash.exec(`printf persistent > /tmp/from
ln -s /bin ~/system
ln -s /home/user /bin/home
mkdir -p ~/system/home/docs
printf across > /bin/home/docs/from-mount
cat ~/docs/from-mount
ln -s /bin/cat ~/command
test -f ~/command && echo stub
cp /tmp/from /bin/temporary
mv /bin/temporary ~/returned
cat ~/returned`);
  expect(result).toMatchObject({ stdout: "acrossstub\npersistent", stderr: "", exitCode: 0 });
  expect(await fs.realpath("/bin/home/docs")).toBe("/home/user/docs");
  expect(await fs.readFile("/home/user/command")).toContain("Built-in command: cat");
  expect((await vfs.readFile("~/docs/from-mount")).content).toBe("across");
  await fs.symlink("/home/user/loop", "/bin/loop"); await vfs.symlink("/bin/loop", "~/loop");
  await expect(fs.stat("/home/user/loop")).rejects.toThrow("ELOOP:");
  await expect(fs.link("/bin/cat", "/bin/hard")).rejects.toThrow("ENOSYS:");
  await fs.rm("/missing/parent/file", { force: true });
  await expect(fs.stat("/home/user/docs/from-mount/")).rejects.toThrow("ENOTDIR:");
  expect(await fs.readdirWithFileTypes!("/home/user")).toContainEqual({ name: "command", isSymbolicLink: true, isDirectory: false, isFile: false });
});
