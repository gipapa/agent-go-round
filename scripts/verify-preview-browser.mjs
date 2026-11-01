import { loadEnvFile } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
try { loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const key = process.env.AGENT_GO_ROUND_GROQ_API_KEY || process.env.GROQ_API_KEY;
if (!key) throw new Error("Set AGENT_GO_ROUND_GROQ_API_KEY in .env.local");
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const command = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const run = promisify(execFile);
async function call(...args) {
  try { return (await run(command[0], [...command.slice(1), "--session", "agr-preview-acceptance", ...args], { maxBuffer: 8_000_000 })).stdout.trim(); }
  catch (error) { throw new Error(String(error.stderr || error.message).replaceAll(key, "[redacted]")); }
}
const evaluate = async code => { new Function(code); return JSON.parse(await call("eval", code)); };
const wait = async (condition, timeout = 30_000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(condition)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out: ${condition}`);
};
function assert(value, message) { if (!value) throw new Error(message); }
const p = 'document.querySelector(".preview-surface:not([hidden]) > div:last-child")?.shadowRoot?.querySelector("iframe")';
const d = `(${p})?.contentDocument`;
const w = `(${p}).contentWindow`;
async function send(text, popup = false, settle = true) {
  const doc = popup ? d : "document";
  await wait(`Boolean(${doc}?.querySelector('#send') && !${doc}.querySelector('#send').disabled)`);
  await evaluate(`(() => { const doc=${doc};doc.querySelector('#prompt').value=${JSON.stringify(text)};doc.querySelector('#terminal-form').requestSubmit();return true;})()`);
  if (settle) await wait(`!${doc}.querySelector('#send').disabled`, 420_000);
}
async function connect() {
  await evaluate(`(() => {const doc=${d};doc.querySelector('#provider-toggle').click();doc.querySelector('#api-key').value=${JSON.stringify(key)};doc.querySelector('#model').value=${JSON.stringify(process.env.AGENT_GO_ROUND_GROQ_MODEL || "qwen/qwen3.8-27b")};doc.querySelector('#remember-key').checked=false;doc.querySelector('#provider-form').requestSubmit();return true;})()`);
  await wait(`${d}.querySelector('#provider-label').textContent==='groq · live'`);
}
async function durable(workspace = workspaceId) {
  await new Promise(resolve => setTimeout(resolve, 500));
  return evaluate(`(async()=>{const rows=async(name,store)=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return new Promise((resolve,reject)=>{const t=db.transaction(store),r=t.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>db.close()})};return {files:(await rows('agent-go-round.files.v1','nodes')).filter(r=>r.workspace===${JSON.stringify(workspace)}).map(r=>r.node),records:(await rows('agent-go-round.conversations.v1','records')).filter(r=>r.workspace===${JSON.stringify(workspace)})}})()`);
}
const workspaceId = `preview-${Date.now()}`;
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"); url.searchParams.set("workspace", workspaceId);
const report = { startedAt: new Date().toISOString(), url: url.href, workspaceId, model: process.env.AGENT_GO_ROUND_GROQ_MODEL || "qwen/qwen3.8-27b", checks: [], status: "running" };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await call("open", url.href); await wait("Boolean(document.querySelector('#send') && !document.querySelector('#send').disabled)"); await call("snapshot");
  await send('write ' + JSON.stringify({ files: [
    { path: "~/AGENTS.md", content: "即使使用者使用英文提問，也必須使用繁體中文回答。" },
    { path: "~/main.html", content: '<!doctype html><html lang="zh-Hant"><head><title>Preview acceptance</title><link rel="stylesheet" href="styles.css"></head><body><h1 id="headline">Original title</h1><p>這個頁面來自 IndexedDB。</p><img src="logo.svg" alt="VFS mark"><script>parent.__pageScriptRan=true</script></body></html>' },
    { path: "~/styles.css", content: 'body{background:#f6f3ed;padding:40px;font-family:system-ui}h1{color:rgb(17,34,51)}img{width:48px;height:48px}' },
    { path: "~/logo.svg", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#8360af"/></svg>' }
  ] }));
  await send("preview main.html");
  await wait("document.querySelector('.preview-surface > iframe')?.srcdoc.includes('Original title')");
  await wait(`Boolean(${d}?.querySelector('#send') && !${d}.querySelector('#send').disabled)`);
  const surface = await evaluate(`new URL((${p}).src).searchParams.get('surface')`);
  assert(await evaluate(`new URL((${p}).src).searchParams.get('workspace')===${JSON.stringify(workspaceId)}`), "Popup workspace mismatch");
  assert(await evaluate("document.querySelector('.preview-surface > iframe').getAttribute('sandbox')==='' && !window.__pageScriptRan"), "Preview isolation failed");
  assert(await evaluate("document.querySelector('.preview-surface > iframe').srcdoc.includes('data:image/svg+xml;') && document.querySelector('.preview-surface > iframe').srcdoc.includes('rgb(17,34,51)')"), "VFS resources unresolved");
  check("HTML/CSS/SVG and sandbox isolation");
  await evaluate("(() => {document.querySelector('.preview-surface > div:last-child').shadowRoot.querySelector('.launcher').click();return true;})()");
  await connect(); await send("ai", true);
  const task = 'Read ~/main.html, then use a file tool to change only the h1 text from "Original title" to "Updated by Pi". Preserve the stylesheet and image. Briefly report what you changed.';
  await evaluate(`(() => {${w}.__previewToken='preserve-popup';return true;})()`);
  await send(task, true, false);
  await wait(`${d}.querySelector('#run-status').textContent==='working'`);
  await evaluate("(() => {[...document.querySelectorAll('.preview-toolbar button')].find(n=>n.textContent==='重新載入預覽').click();return true;})()");
  assert(await evaluate(`${w}.__previewToken==='preserve-popup'`), "Refresh recreated running Pi iframe");
  await wait(`!${d}.querySelector('#send').disabled`, 420_000);
  assert(await evaluate(`${d}.querySelector('#run-status').textContent==='done'`), await evaluate(`${d}.querySelector('#terminal').textContent.slice(-3000)`));
  let state = await durable();
  let layout = state.records.find(r => r.id === `layout:${surface}`).value.snapshot;
  const session = layout.tabs.find(t => t.id === layout.activeTabId).session;
  report.sessionId = session.sessionId;
  const finish = state.records.map(r => r.value).filter(r => r.type === "run_finished" && r.sessionId === session.sessionId).at(-1);
  const trace = state.records.map(r => r.value).filter(r => r.runId === finish.runId && ["context_loaded", "file_access"].includes(r.type));
  const main = state.files.find(f => f.path === "/home/user/main.html");
  assert(main.content.includes("Updated by Pi") && main.revision === 2, "Model did not commit the heading edit");
  assert(trace.some(e => e.type === "file_access" && e.method === "writeFile" && e.path === main.path), "No real VFS write trace");
  assert(trace.some(e => e.type === "context_loaded" && e.source.kind === "agents"), "Popup did not load shared AGENTS.md");
  assert(/[\u3400-\u9fff]/u.test(finish.text), "Popup did not answer in Chinese");
  report.firstRun = { text: finish.text, trace, revision: main.revision };
  check("real Groq popup reads shared rules and edits main.html; refresh preserves active run");
  await wait("document.querySelector('.preview-status').textContent.includes('更新')");
  await evaluate("(() => {[...document.querySelectorAll('.preview-toolbar button')].find(n=>n.textContent==='重新載入預覽').click();return true;})()");
  await wait("document.querySelector('.preview-surface > iframe').srcdoc.includes('Updated by Pi')");
  assert(await evaluate(`${w}.__previewToken==='preserve-popup'`), "Refresh discarded popup conversation");
  check("committed page edit is visible after explicit refresh");
  await call("screenshot", "test-results/preview-popup-desktop.png");
  await evaluate("(() => {document.querySelector('.preview-surface > div:last-child').shadowRoot.querySelector('.close').click();document.querySelector('#tab-list .tab').click();return true;})()");
  await send("read main.html");
  assert(await evaluate("document.querySelector('#terminal').textContent.includes('Updated by Pi')"), "Shell cannot inspect popup edit");
  await send('write ' + JSON.stringify({ path: "~/styles.css", content: 'body{background:#edf5ed;padding:40px;font-family:system-ui}h1{color:rgb(40,80,40)}img{width:48px;height:48px}', expectedRevision: 1 }));
  await send("preview main.html");
  assert(await evaluate(`${w}.__previewToken==='preserve-popup'`), "Switching tabs remounted popup");
  await wait("document.querySelector('.preview-status').textContent.includes('更新')");
  await evaluate("(() => {[...document.querySelectorAll('.preview-toolbar button')].find(n=>n.textContent==='重新載入預覽').click();return true;})()");
  await wait("document.querySelector('.preview-surface > iframe').srcdoc.includes('rgb(40,80,40)')");
  check("shell sees agent edits; CSS dependency updates; tab switching preserves popup");
  await durable(); await call("reload");
  await wait(`Boolean(${d}?.querySelector('#send') && !${d}.querySelector('#send').disabled)`);
  state = await durable(); layout = state.records.find(r => r.id === `layout:${surface}`).value.snapshot;
  const restored = layout.tabs.find(t => t.id === layout.activeTabId).session;
  assert(restored.sessionId === session.sessionId && restored.messages.length === session.messages.length, "Reload lost popup history");
  await evaluate(`(() => {const win=${w};win.__requests=[];const original=win.fetch.bind(win);win.fetch=(input,init)=>{if(init?.body)win.__requests.push(JSON.parse(init.body));return original(input,init)};document.querySelector('.preview-surface > div:last-child').shadowRoot.querySelector('.launcher').click();return true;})()`);
  await connect(); await send("What exact heading did you set earlier? Answer one sentence without changing files.", true);
  assert(await evaluate(`${d}.querySelector('#run-status').textContent==='done'`), "Follow-up run failed");
  const history = await evaluate(`${w}.__requests[0]?.messages`);
  const content = message => Array.isArray(message.content) ? message.content.map(block => block.text || "").join("") : message.content || "";
  assert(history.some(message => message.role === "user" && content(message) === task) && history.some(message => message.role === "assistant" && content(message).includes(finish.text)), "Provider request did not retain prior question and answer");
  report.history = { sessionId: restored.sessionId, messagesBeforeReload: session.messages.length, previousQuestionAndAnswerInRequest: true };
  check("page reload and reconnect preserve popup session and real request history");
  await evaluate("(() => {document.querySelector('.preview-surface > div:last-child').shadowRoot.querySelector('.close').click();return true;})()");
  const pageUrl = await evaluate("[...document.querySelectorAll('.preview-toolbar a')].find(a=>a.textContent==='開啟主頁').href");
  await call("open", pageUrl);
  await wait("document.querySelector('.preview-surface > iframe')?.srcdoc.includes('Updated by Pi')");
  assert(await evaluate("document.body.classList.contains('page-view') && getComputedStyle(document.querySelector('.tab-bar')).display==='none'"), "Page view chrome not hidden");
  const pageSurface = await evaluate(`new URL((${p}).src).searchParams.get('surface')`);
  await durable(); await call("reload");
  await wait("document.querySelector('.preview-surface > iframe')?.srcdoc.includes('Updated by Pi')");
  assert(await evaluate(`new URL((${p}).src).searchParams.get('surface')===${JSON.stringify(pageSurface)}`), "Page view did not restore entry/popup binding");
  check("standalone page entry and popup binding survive reload");
  await call("screenshot", "test-results/preview-page-desktop.png");
  await call("set", "viewport", "390", "844");
  assert(await evaluate("document.documentElement.scrollWidth<=innerWidth"), "Mobile page overflow");
  await call("screenshot", "test-results/preview-page-mobile.png");
  const other = new URL(pageUrl); other.searchParams.set("workspace", workspaceId + "-other");
  await call("open", other.href);
  await wait("[...document.querySelectorAll('.preview-toolbar button')].some(b=>b.textContent==='建立主頁範本'&&!b.hidden)");
  let isolated = await durable(workspaceId + "-other");
  assert(!isolated.files.some(f => f.path === "/home/user/main.html"), "Missing entry was auto-created or leaked from another workspace");
  await evaluate("(() => {[...document.querySelectorAll('.preview-toolbar button')].find(b=>b.textContent==='建立主頁範本').click();return true;})()");
  await wait("document.querySelector('.preview-surface > iframe')?.srcdoc.includes('我的 Pi 主頁')");
  state = await durable(); assert(state.files.find(f => f.path === "/home/user/main.html").content.includes("Updated by Pi"), "Template creation overwrote another workspace");
  check("workspace isolation and explicit missing-page template creation");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = String(error.message).replaceAll(key, "[redacted]"); process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/preview-browser.json", JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, failure: report.failure }));
  await call("close");
}
