// Run against the dev server: AGENT_BROWSER_CLI=/path/to/agent-browser.js npm run test:jokes:browser
import { loadEnvFile } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { jokeContextFromFiles, validateJokeAnswer } from "../src/acceptance/joke-validation.ts";

try { loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const key = process.env.AGENT_GO_ROUND_GROQ_API_KEY || process.env.GROQ_API_KEY;
if (!key) throw new Error("Set AGENT_GO_ROUND_GROQ_API_KEY in .env.local");
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const prefix = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const run = promisify(execFile);
const sessionName = "agr-jokes-acceptance";
async function call(...args) {
  try { const result = await run(prefix[0], [...prefix.slice(1), "--session", sessionName, ...args], { maxBuffer: 8 * 1024 * 1024 }); return result.stdout.trim(); }
  catch (error) { throw new Error(String(error.stderr || error.message).replaceAll(key, "[redacted]")); }
}
async function evaluate(code) { return JSON.parse(await call("eval", code)); }
async function waitReady(timeout = 420_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate('Boolean(document.querySelector("#send") && !document.querySelector("#send").disabled)')) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Browser run did not settle within its deadline");
}
async function command(text) {
  await waitReady();
  await call("fill", "#prompt", text);
  await evaluate('(() => { document.querySelector("#terminal-form").requestSubmit(); return true; })()');
  await waitReady();
  return evaluate('({status:document.querySelector("#run-status").textContent,last:[...document.querySelectorAll("#terminal .line-content")].at(-1)?.textContent})');
}
async function connect() {
  await call("click", "#provider-toggle");
  await call("fill", "#api-key", key);
  if (process.env.AGENT_GO_ROUND_GROQ_MODEL) await call("fill", "#model", process.env.AGENT_GO_ROUND_GROQ_MODEL);
  await call("uncheck", "#remember-key");
  await call("click", 'button[form="provider-form"]');
  const connected = await evaluate('document.querySelector("#provider-label").textContent');
  if (connected !== "groq · live") throw new Error("Provider did not connect");
}
async function persisted() {
  // Wait for the product's debounced commit, then inspect actual durable state.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return evaluate(`(async () => {
    const open=(name)=>new Promise((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
    const rows=async(name,store)=>{const db=await open(name);return new Promise((resolve,reject)=>{const tx=db.transaction(store);const q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close()})};
    const records=await rows('agent-go-round.sessions','records');
    const contents=new Map((await rows('agent-go-round.vfs','contents')).map(row=>[row.key,row.content]));
    const layout=records.find(row=>row.id==='layout'&&row.workspace===${JSON.stringify(workspaceId)})?.value.snapshot;
    const tab=layout?.tabs.find(tab=>tab.id===layout.activeTabId);
    return {tab,events:records.filter(row=>row.workspace===${JSON.stringify(workspaceId)}&&row.id.startsWith('event:')).map(row=>row.value),files:(await rows('agent-go-round.vfs','nodes')).filter(row=>row.workspace===${JSON.stringify(workspaceId)}).map(row=>({...row.node,...(row.node.kind==='file'?{content:contents.get(row.key)}:{})}))};
  })()`);
}
async function grade(id, result, directory) {
  const state = await persisted();
  if (result.status !== "done") {
    report.tasks.push({ id, status: "fail", model: state.tab?.session.model.id, failure: result.last, trace: state.events.filter((event) => event.sessionId === state.tab?.session.sessionId && ["file_access", "context_loaded", "tool_finished", "run_finished"].includes(event.type)), finalAssistant: state.tab?.session.messages.filter((message) => message.role === "assistant").at(-1) });
    throw new Error(`${id}: ${result.last}`);
  }
  const input = state.events.filter((event) => event.sessionId === state.tab.session.sessionId && event.type === "run_finished").at(-1);
  if (!input) throw new Error("No durable run_finished event");
  const files = Object.fromEntries(state.files.filter((file) => file.kind === "file" && file.path.slice(0, file.path.lastIndexOf("/")) === directory && file.path.endsWith(".md")).map((file) => [file.path, { content: file.content, revision: file.revision }]));
  if (Object.keys(files).length !== 5) throw new Error(`${id}: expected five persisted files`);
  const trace = state.events.filter((event) => event.runId === input.runId && ["file_access", "context_loaded", "tool_finished"].includes(event.type));
  let answer;
  try { answer = validateJokeAnswer(input.text, files, state.events, input.runId, jokeContextFromFiles(state.files.filter(file => file.kind === "file"))); }
  catch (error) { report.tasks.push({ id, status: "fail", model: state.tab.session.model.id, text: input.text, files, trace, failure: error.message }); throw error; }
  return { id, status: "pass", model: state.tab.session.model.id, answer, text: input.text, trace, sessionId: state.tab.session.sessionId, messageCount: state.tab.session.messages.length };
}

const workspaceId = `jokes-${Date.now()}`;
const languageOnly = process.env.AGENT_GO_ROUND_LANGUAGE_ONLY === "1";
const appUrl = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:5173/");
appUrl.searchParams.set("workspace", workspaceId);
const report = { startedAt: new Date().toISOString(), url: appUrl.href, workspaceId, tasks: [], status: "running" };
try {
  await call("open", report.url); await waitReady();
  await call("snapshot");
  if (languageOnly) {
    const rules = await command("read ~/agents.md");
    if (!rules.last.includes("請回覆繁體中文")) throw new Error("Default workspace language rule is missing");
    await connect(); await command("ai");
    const result = await command("Explain a virtual filesystem in one short sentence.");
    const state = await persisted();
    const last = state.events.filter(event => event.type === "run_finished").at(-1);
    const sources = state.events.filter(event => event.runId === last?.runId && event.type === "context_loaded");
    if (result.status !== "done" || !/[\u3400-\u9fff]/u.test(last?.text ?? "")) throw new Error("English question did not receive Chinese answer");
    if (!sources.some(event => event.source.kind === "agents") || sources.some(event => event.source.kind === "skill") || state.tab.session.activeSkill) throw new Error("Language rule was not isolated from skills");
    report.tasks.push({ id: "agents-only-english-to-chinese", status: "pass", model: state.tab.session.model.id, text: last.text, sources });
  } else {
  await command("demo jokes");
  await connect(); await command("ai");
  const first = await command("Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.");
  report.tasks.push(await grade("browser-five-existing-jokes", first, "/home/user/jokes"));
  const previous = report.tasks[0];
  await command("/exit"); await command("edit ~/jokes/笑話1.md");
  await call("fill", "#editor-content", "今天的更新笑話：我跟電腦說想休息，電腦說它每天都在等我按睡眠模式。");
  await call("click", "#editor-save");
  const saved = await evaluate('document.querySelector("#editor-status").textContent');
  if (!saved.includes("Saved")) throw new Error("Editor failed to save changed joke");
  await call("click", "#editor-cancel");
  await persisted(); await call("reload"); await waitReady();
  await connect(); await command("ai");
  const next = await command("I edited a joke file. Use joke-master again, reread all five current files in ~/jokes, score each, and choose the funniest one.");
  const second = await grade("browser-reload-reconnect-rescore", next, "/home/user/jokes");
  if (second.sessionId !== previous.sessionId || second.messageCount <= previous.messageCount) throw new Error("Reload did not preserve conversation identity/history");
  const state = await persisted();
  if (!state.tab.session.messages.some((message) => message.role === "assistant" && (Array.isArray(message.content) ? message.content.filter((block) => block.type === "text").map((block) => block.text).join("") : String(message.content)).includes(previous.answer.winner.text))) throw new Error("Previous model answer was lost during reload");
  report.tasks.push(second);
  // History continuation is covered above. Start a distinct creation task so
  // free-tier per-request input-token limits do not conflate the two gates.
  await command("/exit"); await command("ai --new");
  const created = await command("Use joke-master. First create exactly five original short jokes as separate .md files in ~/new-jokes using write with createParents true, then actually read each file back, score all five, and select the funniest one.");
  report.tasks.push(await grade("browser-agent-create-read-back", created, "/home/user/new-jokes"));
  await command("/exit");
  const listed = await command("ls ~/new-jokes");
  if (!listed.last.includes(".md")) throw new Error("Shell could not inspect agent-created files");
  await call("set", "viewport", "390", "844");
  const width = await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})');
  if (width.document > width.viewport) throw new Error("Mobile view overflows horizontally");
  await call("screenshot", "test-results/jokes-browser-mobile.png");
  }
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = String(error.message).replaceAll(key, "[redacted]"); process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true });
  await writeFile(process.env.AGENT_GO_ROUND_JOKE_BROWSER_REPORT || `test-results/${languageOnly ? "language-browser" : "jokes-browser"}.json`, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ status: report.status, tasks: report.tasks.map(({ id, status }) => ({ id, status })), failure: report.failure }));
  await call("close");
}
