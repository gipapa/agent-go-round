// @vitest-environment node
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { BinRegistry } from "../core/bin";
import { installDefaultBin } from "../core/bin-defaults";
import { FILE_METHODS } from "../core/file-capabilities";
import { MemoryFileSystem } from "../core/fs";
import { executeTerminalInput, type TerminalContext } from "./controller";

async function setup() {
  const fs = new MemoryFileSystem(); await installDefaultBin(fs); await fs.mkdir("~/project");
  const bin = new BinRegistry(fs, { async execute(source, args, rpc) {
    return structuredClone(await runInNewContext(`(${source})`, {}, { timeout: 1000 })(args, { fs: Object.fromEntries(FILE_METHODS.map(method => [method, (...values: unknown[]) => rpc(method, values)])) }));
  } }); await bin.reload();
  const context: TerminalContext = { fs, bin, cwd: "/home/user/project", history: vi.fn(async () => []), openPreview: vi.fn(), openEditor: vi.fn(async () => {}), enterAgent: vi.fn(async () => {}) };
  return { fs, context, send: (input: string) => executeTerminalInput(input, context) };
}
it("routes workspace actions with quoted paths and case-sensitive arguments", async () => {
  const { context, send } = await setup();
  await send('PrEvIeW "Mixed Page.html"'); expect(context.openPreview).toHaveBeenCalledWith("/home/user/project/Mixed Page.html");
  await send('EdIt "Mixed File.md"'); expect(context.openEditor).toHaveBeenCalledWith("Mixed File.md");
  await send("edit"); expect(context.openEditor).toHaveBeenCalledWith("/home/user/project");
  await send("AI --ReSuMe History-MiXeD42"); expect(context.enterAgent).toHaveBeenCalledWith({ kind: "resume", sessionId: "History-MiXeD42" });
  expect((await send("HiStOrY")).text).toBe("No saved conversations");
});
it("preserves literal JSON data and sends edit replacements to the file tool", async () => {
  const { fs, context, send } = await setup();
  const content = '$(pwd); | > "quote"\n你好';
  await send('WRITE ' + JSON.stringify({ path: "data.md", content }));
  expect((await fs.readFile("~/project/data.md")).content).toBe(content);
  await send('edit data.md "你好" "更新"');
  expect(context.openEditor).not.toHaveBeenCalled();
  expect((await fs.readFile("~/project/data.md")).content).toContain("更新");
});
it("shows command help without performing the associated UI action", async () => {
  const { context, send } = await setup();
  expect((await send("ai --help")).text).toContain("--resume SESSION_ID");
  expect((await send("edit --help")).text).toContain("OLD");
  expect(context.enterAgent).not.toHaveBeenCalled(); expect(context.openEditor).not.toHaveBeenCalled();
  await expect(send("preview one two")).rejects.toThrow(/Usage/);
  await expect(send("ai --resume")).rejects.toThrow(/Usage/);
});
