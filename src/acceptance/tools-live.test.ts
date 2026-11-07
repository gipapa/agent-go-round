// @vitest-environment node
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { BinRegistry } from "../core/bin";
import { DEFAULT_BIN_TOOLS, FILE_METHODS, installDefaultBin } from "../core/bin-defaults";
import { MemoryFileSystem } from "../core/fs";
import { configureFileAgent } from "../core/file-context";
import { JustBashFileSystem } from "../core/just-bash-fs";
import { runShellScript } from "../core/shell-execution";
import { initializeWorkspace } from "../core/workspace-bootstrap";
import { createGroqRuntime, DEFAULT_GROQ_MODEL } from "../core/provider";
import { AgentSession, MemorySessionEventStore } from "../core/session";

try { loadEnvFile(".env.local"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }

const prompts: Record<string, string> = {
  bash: "用 bash 在 ~/audit.txt 寫入字串 audit-ok，再讀回確認。",
  help: "用 help 查詢 write 的參數，簡述如何覆寫既有檔案。",
  read: "用 read 分頁讀取 ~/Project/sample.txt，每次只讀一行，讀完兩行後回覆完整內容。",
  write: "用 write 將 ~/Project/sample.txt 覆寫為 revised。先 read 取得 revision，寫完再讀回確認。",
  edit: "先 read ~/Project/sample.txt，再用 edit 將其中 alpha 精確替換為 gamma，保留 beta，最後讀回確認。",
  skill_load: "請使用 skill_load 載入 probe 技能，依照內容讀取引用檔並回覆驗證碼。",
  read_host_page: "請使用 read_host_page 讀取已連接的宿主頁面，回覆頁面標題。",
  install_joke_demo: "請使用 install_joke_demo 安裝笑話範例，簡短回報新增結果。",
  reload_tools: "請使用 reload_tools 重新載入目前的自訂工具 catalog，回報是否成功。",
  reset_workspace: "請使用 reset_workspace 把整個虛擬工作區還原初始狀態，確認所有自訂檔案都可以刪除。完成後簡短回報。",
  agents: "用 agents list 找出可用的 audit-target 分頁，發送『請回覆 audit-reply』，用回傳 requestId 讀取實際結果後回覆。pending 時讀同一 requestId，不要重送。"
};

it("audits every exposed tool with a real model and records actual calls, arguments and results", async () => {
  const apiKey = process.env.AGENT_GO_ROUND_GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set AGENT_GO_ROUND_GROQ_API_KEY in .env.local");
  const runtime = await createGroqRuntime({ apiKey, model: process.env.AGENT_GO_ROUND_GROQ_MODEL || DEFAULT_GROQ_MODEL });
  const names = ["bash", ...DEFAULT_BIN_TOOLS.map(tool => tool.name)];
  expect(names.every(name => prompts[name])).toBe(true);
  const tasks = names.map(name => ({ name, expectedTools: [name], prompt: prompts[name] }));
  tasks.push(
    { name: "bash-navigation-search", expectedTools: ["bash"], prompt: "請先回到家目錄，再列出 Project 內的 txt 檔案，找出包含 alpha 的檔名與行號。不要修改檔案。" },
    { name: "html-story", expectedTools: ["bash", "write"], prompt: "寫一篇約 600 字的繁體中文雨夜短篇小說到 ~/main.html，包含完整 HTML 與簡單排版，寫完讀回確認即可。" }
  );
  const selected = process.env.AGENT_GO_ROUND_AUDIT_TOOLS?.split(",");
  expect(selected?.every(name => tasks.some(task => task.name === name)) ?? true).toBe(true);
  const report = { provider: "groq", model: runtime.model.id, transport: "real model; Node VFS/bin executor; host/other-tab responses are fixtures", startedAt: new Date().toISOString(), status: "running", tools: [] as Array<Record<string, unknown>> };
  const reportPath = process.env.AGENT_GO_ROUND_AUDIT_REPORT || "test-results/tools-live.json";
  await mkdir("test-results", { recursive: true });
  for (const { name, expectedTools, prompt } of tasks.filter(task => !selected || selected.includes(task.name))) {
    const fs = new MemoryFileSystem();
    await initializeWorkspace(fs); await installDefaultBin(fs);
    await fs.mkdir("~/Project"); await fs.mkdir("/usr"); await fs.mkdir("/tmp");
    await fs.writeFile("~/Project/sample.txt", "alpha\nbeta");
    await fs.writeFile("~/Project/main.html", "<h1>Audit preview</h1>");
    await fs.mkdir("~/skills/probe/references", { recursive: true });
    await fs.writeFile("~/skills/probe/SKILL.md", "---\nname: probe\ndescription: Tool audit procedure; use only when asked for probe.\n---\nRead references/code.txt and report its exact code.");
    await fs.writeFile("~/skills/probe/references/code.txt", "audit-skill-42");
    const sideEffects: Array<{ kind: string; value: unknown }> = [];
    let sends = 0;
    const bin = new BinRegistry(fs, { async execute(source, args, rpc) {
      return structuredClone(await runInNewContext(`(${source})`, {}, { timeout: 1000 })(args, {
        fs: Object.fromEntries(FILE_METHODS.map(method => [method, (...values: unknown[]) => rpc(method, values)])),
        skills: { load: (name: string) => rpc("loadSkill", [name]) },
        tools: { help: (name?: string) => rpc("commandHelp", [name]), reload: () => rpc("reloadTools", []) },
        workspace: { home: () => rpc("home", []), reset: () => rpc("resetWorkspace", []) },
        host: { readPage: (options: unknown) => rpc("readHostPage", [options]) },
        agents: { execute: (options: unknown) => rpc("tabAgents", [options]) }
      }));
    } }, {
      readHostPage: async () => ({ html: "<html><title>Audit host</title></html>" }),
      tabAgents: async args => {
        const value = args as { action: string; target?: string; text?: string; requestId?: string };
        sideEffects.push({ kind: "agents", value });
        if (value.action === "list") return { self: "audit-source", agents: [{ id: "audit-target", name: "audit-target", available: true }] };
        if (value.action === "send") { if (value.target !== "audit-target") throw new Error("Unknown audit target"); sends++; return { requestId: "audit-request", status: "pending" }; }
        if (value.requestId !== "audit-request" || sends !== 1) throw new Error("Read the one existing audit-request");
        return { requestId: "audit-request", status: "success", text: "audit-reply" };
      }
    });
    await bin.reload();
    const events = new MemorySessionEventStore();
    const session = new AgentSession({ sessionId: `tool-audit-${name}`, model: runtime.model, streamFn: runtime.streamFn, eventStore: events, maxToolCalls: 12, deadlineMs: 120_000 });
    let cwd = "/home/user/Project";
    await configureFileAgent(session, fs, cwd, bin, undefined, [], { onCwd: value => { cwd = value; }, shell: { execute: (script, options) => runShellScript(script, new JustBashFileSystem(fs.withAccessRecorder(options.onAccess ?? (() => {}))), options) } });
    const started = Date.now();
    let failure: string | undefined;
    const answerWarnings: string[] = [];
    let result: unknown;
    try {
      const run = await session.prompt(prompt); result = run;
      expect(run.status).toBe("success");
      expect(events.list().some(event => event.type === "tool_finished" && expectedTools.includes(event.toolName) && !event.isError)).toBe(true);
      if (name === "bash") expect((await fs.readFile("~/audit.txt")).content).toContain("audit-ok");
      if (name === "bash-navigation-search") { expect(cwd).toBe("/home/user"); expect(run.text).toContain("sample.txt"); expect(run.text).toContain("alpha"); }
      if (name === "html-story") {
        const file = await fs.readFile("~/main.html");
        expect(file.content).toMatch(/<!doctype html>/i);
        expect(file.content).toMatch(/<html[\s>][\s\S]*<body[\s>][\s\S]*<\/html>/i);
        expect(file.content.length).toBeGreaterThan(600);
        expect(events.list().some(event => event.type === "file_access" && event.path === "/home/user/main.html" && (event.method === "readBytes" || !!event.readRange))).toBe(true);
      }
      if (name === "write") expect((await fs.readFile("~/Project/sample.txt")).content.trim()).toBe("revised");
      if (name === "edit") expect((await fs.readFile("~/Project/sample.txt")).content).toBe("gamma\nbeta");
      if (name === "read") expect(run.text).toMatch(/alpha[\s\S]*beta/);
      if (name === "skill_load") {
        expect(session.agent.state.messages.some(message => message.role === "toolResult" && message.toolName === "read" && !message.isError && JSON.stringify(message.content).includes("audit-skill-42"))).toBe(true);
        expect(run.text.replace(/[\u2010-\u2015\u2212]/g, "-")).toContain("audit-skill-42");
        if (!run.text.includes("audit-skill-42")) answerWarnings.push("Model changed ASCII hyphens in the displayed code; the tool delivered the exact original code.");
      }
      if (name === "read_host_page") expect(run.text).toContain("Audit host");
      if (name === "install_joke_demo") expect((await fs.listDirectory("~/jokes")).length).toBe(5);
      if (name === "agents") { expect(sends).toBe(1); expect(run.text).toContain("audit-reply"); }
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    const calls = session.agent.state.messages.filter(message => message.role === "assistant").flatMap(message => message.content.filter(block => block.type === "toolCall"));
    const results = session.agent.state.messages.filter(message => message.role === "toolResult");
    const usage = session.agent.state.messages.filter(message => message.role === "assistant").reduce((total, message) => ({ input: total.input + message.usage.input, output: total.output + message.usage.output }), { input: 0, output: 0 });
    report.tools.push({ name, usage, answerWarnings, toolErrors: results.filter(result => result.isError).length, status: failure ? "fail" : "pass", elapsedMs: Date.now() - started, result, calls, results, sideEffects, ...(failure ? { failure } : {}) });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ tool: name, status: failure ? "fail" : "pass", elapsedMs: Date.now() - started, calls: calls.map(call => call.name), ...(failure ? { failure } : {}) }));
  }
  report.status = report.tools.every(tool => tool.status === "pass") ? "pass" : "fail";
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  expect(report.tools.every(tool => tool.status === "pass"), report.tools.filter(tool => tool.status !== "pass").map(tool => tool.name).join(", ")).toBe(true);
}, 2_400_000);
