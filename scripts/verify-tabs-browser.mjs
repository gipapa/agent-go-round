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
  try { return (await run(command[0], [...command.slice(1), "--session", "agr-cross-tab", ...args], { maxBuffer: 8_000_000 })).stdout.trim(); }
  catch (error) { throw new Error(String(error.stderr || error.message).replaceAll(key, "[redacted]")); }
}
const evaluate = async code => JSON.parse(await call("eval", code));
async function wait(condition, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(condition)) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for browser state: " + condition);
}
const ready = "!!document.querySelector('#send')&&!document.querySelector('#send').disabled";
async function send(text, settle = true) {
  await wait(ready);
  await call("fill", "#prompt", text);
  await evaluate("(() => {document.querySelector('#terminal-form').requestSubmit();return true;})()");
  if (settle) await wait(ready, 420_000);
}
async function durable() {
  await new Promise(resolve => setTimeout(resolve, 500));
  return evaluate(`(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('agent-go-round.sessions');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    return new Promise((resolve,reject)=>{const tx=db.transaction('records'),r=tx.objectStore('records').getAll();r.onsuccess=()=>{const rows=r.result.filter(row=>row.workspace===${JSON.stringify(workspace)});resolve({layout:rows.find(row=>row.id==='layout')?.value.snapshot,events:rows.filter(row=>row.id.startsWith('event:')).map(row=>row.value)})};r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close()});
  })()`);
}
function assert(value, message) { if (!value) throw new Error(message); }
const workspace = `tabs-${Date.now()}`;
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/");
url.searchParams.set("workspace", workspace);
const report = { url: url.href, status: "running", model: process.env.AGENT_GO_ROUND_GROQ_MODEL || "openai/gpt-oss-120b", checks: [] };
const check = name => { report.checks.push(name); console.log("PASS " + name); };
await mkdir("test-results", { recursive: true });
try {
  await call("open", url.href); await call("snapshot"); await wait(ready);
  await send("AgEnTs LiSt");
  const listing = await evaluate("JSON.parse([...document.querySelectorAll('.line-content')].at(-1).textContent)");
  assert(listing.self === "main" && listing.agents.length === 1, "Shell could not discover its own tab");
  await send("agents --help");
  assert(await evaluate("document.querySelector('#terminal').textContent.includes('requestId')"), "Missing agents help");
  check("shell uses the agents bin tool and shared help");

  await call("click", "#provider-toggle");
  await evaluate(`(() => {document.querySelector('#api-key').value=${JSON.stringify(key)};document.querySelector('#model').value=${JSON.stringify(report.model)};document.querySelector('#remember-key').checked=false;document.querySelector('#provider-form').requestSubmit();return true;})()`);
  await wait("document.querySelector('#provider-label').textContent==='groq · live'");
  await send("ai");
  await call("click", "#add-tab"); await send("ai");
  assert(await evaluate("document.querySelector('#pane-type').textContent==='AI agent'&&document.querySelector('#provider-label').textContent==='groq · live'"), "Second tab did not start a live AI");
  await evaluate("(() => {document.querySelectorAll('#tab-list .tab')[0].click();return true;})()");
  check("two independent app tabs run connected AI sessions");

  await send("請使用 agents 工具列出目前的 agents，找到另一個 tab，然後只發送一次任務，請對方講一個簡短的繁體中文笑話。讀到對方的實際回覆後，將對方回覆的完整原文告訴我。不要自己編笑話；pending 時只讀取同一個 requestId。", false);
  // Keep the destination selected while the source calls tools: caller identity
  // must come from its session, never from whichever tab is visible.
  await evaluate("(() => {document.querySelectorAll('#tab-list .tab')[1].click();return true;})()");
  await wait("document.querySelector('#terminal').textContent.includes('incoming question from main')", 180_000);
  await wait(ready, 420_000);
  report.targetVisible = await evaluate("document.querySelector('#terminal').textContent.slice(-4000)");
  await call("screenshot", "test-results/cross-tab-target.png");
  await evaluate("(() => {document.querySelectorAll('#tab-list .tab')[0].click();return true;})()");
  await wait(ready, 420_000);
  const state = await durable();
  report.tabs = state.layout.tabs.map(tab => ({ id: tab.id, sessionId: tab.session.sessionId, provider: tab.provider, mode: tab.mode }));
  const source = state.layout.tabs.find(tab => tab.id === "main");
  const target = state.layout.tabs.find(tab => tab.id === "agent-2");
  const calls = source.session.messages.filter(message => message.role === "assistant").flatMap(message => message.content.filter(block => block.type === "toolCall" && block.name === "agents"));
  const results = source.session.messages.filter(message => message.role === "toolResult" && message.toolName === "agents").map(message => ({ id: message.toolCallId, error: message.isError, value: JSON.parse(message.content.filter(block => block.type === "text").map(block => block.text).join("")) }));
  report.calls = calls; report.results = results;
  const targetRuns = state.events.filter(event => event.type === "run_finished" && event.sessionId === target.session.sessionId);
  const sourceRun = state.events.filter(event => event.type === "run_finished" && event.sessionId === source.session.sessionId).at(-1);
  report.targetRuns = targetRuns; report.sourceRun = sourceRun;
  assert(calls.some(call => call.arguments.action === "list"), "Source did not discover agents");
  assert(calls.filter(call => call.arguments.action === "send").length === 1, "Source must send exactly one question");
  const instruction = calls.find(call => call.arguments.action === "send").arguments.text;
  assert(/^請.*(?:講|說).*笑話/u.test(instruction) && instruction.includes("繁體中文"), "Source did not ask the destination to tell a Chinese joke");
  const sent = results.find(result => result.value.requestId && calls.find(call => call.id === result.id)?.arguments.action === "send");
  const received = results.find(result => result.value.requestId === sent?.value.requestId && result.value.status === "success");
  assert(received && targetRuns.length === 1 && targetRuns[0].status === "success", "Source did not read one successful real target reply");
  assert(received.value.text === targetRuns[0].text, "Read result differs from target's actual response");
  assert(calls.filter(call => call.arguments.action === "read").every(call => call.arguments.requestId === sent.value.requestId), "Source polled a different request");
  const unquote = text => text.replace(/^>\s?/gm, "").replace(/[ \t]+\n/g, "\n").trim();
  assert(sourceRun?.status === "success" && unquote(sourceRun.text).includes(unquote(targetRuns[0].text)), "Source did not relay the original joke");
  assert(/[\u3400-\u9fff]/u.test(targetRuns[0].text), "Target did not answer in Chinese");
  assert(source.session.sessionId !== target.session.sessionId, "Tabs shared a session");
  check("tab1 discovers tab2, sends one prompt and reads its exact real-model joke while tab2 is selected");
  await call("screenshot", "test-results/cross-tab-source.png");

  await send("/exit");
  await send(`agents read ${sent.value.requestId}`);
  assert(await evaluate(`JSON.parse([...document.querySelectorAll('.line-content')].at(-1).textContent).text===${JSON.stringify(targetRuns[0].text)}`), "Shell could not read the AI's request");
  await call("reload"); await wait(ready);
  await send(`agents read ${sent.value.requestId}`);
  assert(await evaluate("[...document.querySelectorAll('.line-content')].at(-1).textContent.includes('Request not found')"), "Reload silently reused an expired request");
  check("shell can read the same AI request; reload keeps transcripts and explicitly expires request IDs");
  report.status = "pass";
} catch (error) {
  report.status = "fail"; report.failure = String(error.message).replaceAll(key, "[redacted]"); process.exitCode = 1;
  try { report.visible = await evaluate("document.querySelector('#terminal')?.textContent.slice(-12000)"); report.durable = await durable(); await call("screenshot", "test-results/cross-tab-failure.png"); } catch {}
} finally {
  await writeFile("test-results/cross-tab-browser.json", JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, failure: report.failure }));
  await call("close");
}
