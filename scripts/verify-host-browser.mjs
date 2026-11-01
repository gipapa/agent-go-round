import { loadEnvFile } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
try { loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const key = process.env.AGENT_GO_ROUND_GROQ_API_KEY || process.env.GROQ_API_KEY;
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const command = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const run = promisify(execFile);
async function call(...args) {
  try { return (await run(command[0], [...command.slice(1), "--session", "agr-host-page", ...args], { maxBuffer: 8_000_000 })).stdout.trim(); }
  catch (error) { throw new Error(String(error.stderr || error.message).replaceAll(key || "unused-secret", "[redacted]")); }
}
const evaluate = async code => JSON.parse(await call("eval", code));
async function wait(condition, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(condition)) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for browser state");
}
const frame = "window.AgentGoRound.defaultWidget.iframe";
const doc = `(${frame}).contentDocument`;
async function send(text) {
  await wait(`!!${doc}?.querySelector('#send')&&!${doc}.querySelector('#send').disabled`);
  await evaluate(`(() => {const d=${doc};d.querySelector('#prompt').value=${JSON.stringify(text)};d.querySelector('#terminal-form').requestSubmit();return true;})()`);
  await wait(`!${doc}.querySelector('#send').disabled`, 420_000);
}
function assert(value, message) { if (!value) throw new Error(message); }
const url = new URL("embed-example.html", process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/");
const report = { url: url.href, checks: [], status: "running", live: key ? "pending" : "skipped: no API key" };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await call("open", url.href); await call("snapshot");
  await wait(`!!${doc}?.querySelector('#send')&&!${doc}.querySelector('#send').disabled`);
  await evaluate("(() => {window.AgentGoRound.defaultWidget.open();window.__hostTrace=[];window.AgentGoRound.defaultWidget.on('message',message=>{if(message.type==='host_tool_result')window.__hostTrace.push(message.payload)});return true;})()");
  const workspace = await evaluate(`new URL((${frame}).src).searchParams.get('workspace')`);
  assert(workspace?.startsWith("popup-"), "Popup is using the default workspace");
  await send("ls ~/bin");
  assert(await evaluate(`(() => {const text=[...${doc}.querySelectorAll('.line-content')].at(-1).textContent;return text.includes('read_host_page.js')&&text.includes('manifests')&&!text.includes('.tool.json');})()`), "Bin root is cluttered with manifests");
  await send("ls ~/bin/manifests");
  assert(await evaluate(`${doc}.querySelector('#terminal').textContent.includes('read_host_page.tool.json')`), "Host tool manifest is not in bin/manifests");
  await send("read_host_page --help");
  await send("read_host_page");
  assert(await evaluate(`JSON.parse([...${doc}.querySelectorAll('.line-content')].at(-1).textContent).html.includes('這一頁的作者是gipapa')`), "Shell host read did not run through bin");
  await send('read_host_page {"limit":20}');
  assert(await evaluate(`JSON.parse([...${doc}.querySelectorAll('.line-content')].at(-1).textContent).html.length===20`), "Shell host read ignored pagination");
  await evaluate(`(() => {${doc}.querySelector('#terminal').scrollTop=0;return true;})()`);
  await send("read_host_page");
  await wait(`(() => {const t=${doc}.querySelector('#terminal');return t.scrollHeight-t.scrollTop-t.clientHeight<3;})()`);
  check("shell host tool and manifest live in bin; paginated reads and new-message auto-scroll work");
  await send('write host-only.txt "popup file"');
  await evaluate("(() => {window.__second=window.AgentGoRound.mount({appUrl:new URL('./',location.href).href});return true;})()");
  const second = await evaluate("new URL(window.__second.iframe.src).searchParams.get('workspace')");
  assert(workspace !== second && second !== "default", "Popup workspaces are not distinct");
  await wait("!!window.__second.iframe.contentDocument?.querySelector('#send')&&!window.__second.iframe.contentDocument.querySelector('#send').disabled");
  const markers = await evaluate("(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('agent-go-round.files.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return new Promise((resolve,reject)=>{const tx=db.transaction('nodes'),r=tx.objectStore('nodes').getAll();r.onsuccess=()=>resolve(r.result.filter(row=>row.node.path.endsWith('/host-only.txt')).map(row=>row.workspace));r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close()})})()");
  assert(markers.includes(workspace) && !markers.includes(second) && !markers.includes("default"), "File leaked between workspaces");
  await evaluate("(() => {window.__second.destroy();return true;})()");
  check("separate popup workspaces isolate files from each other and the direct app");
  // Call the actual advertised tool through the iframe bridge, without a model.
  await evaluate(`(() => {window.dispatchEvent(new MessageEvent('message',{source:(${frame}).contentWindow,origin:location.origin,data:{source:'agent-go-round',type:'host_tool_call',payload:{version:2,instanceId:'invalid-instance',requestId:'invalid',sessionId:'test',toolCallId:'test',toolName:'read_host_page',args:{}}}}));return true;})()`);
  await wait("window.__hostTrace.length>0");
  assert(await evaluate("window.__hostTrace.at(-1).status==='error'"), "Invalid instance was accepted");
  check("host page tool rejects mismatched bridge identities");
  if (key) {
    await evaluate("(() => {window.__hostTrace=[];return true;})()");
    await evaluate(`(() => {const d=${doc};d.querySelector('#sidebar-provider-toggle').click();d.querySelector('#api-key').value=${JSON.stringify(key)};d.querySelector('#model').value=${JSON.stringify(process.env.AGENT_GO_ROUND_GROQ_MODEL || "openai/gpt-oss-20b")};d.querySelector('#remember-key').checked=false;d.querySelector('#provider-form').requestSubmit();return true;})()`);
    await wait(`${doc}.querySelector('#provider-label').textContent==='groq · live'`);
    await send("ai");
    await send("請實際讀取呼叫這個 popup 的 Host page HTML，告訴我這一頁的作者是誰，並引用頁面上的那句原文。");
    const answer = await evaluate(`[...${doc}.querySelectorAll('.terminal-line.assistant .line-content')].at(-1)?.textContent || ''`);
    const reads = await evaluate("window.__hostTrace.filter(result=>result.status==='success'&&typeof result.result?.html==='string')");
    assert(reads.some(result => result.result.html.includes("這一頁的作者是gipapa")), "AI did not read actual host HTML");
    assert(answer.includes("gipapa") && await evaluate(`${doc}.querySelector('#run-status').textContent==='done'`), "AI did not identify the author successfully");
    report.live = "pass"; report.answer = answer; report.hostReads = reads.length;
    check("real Groq AI reads host HTML through the bridge and identifies gipapa");
  }
  await call("screenshot", "test-results/host-popup.png");
  await call("reload");
  await wait(`!!${doc}?.querySelector('#send')&&!${doc}.querySelector('#send').disabled`);
  assert(await evaluate(`new URL((${frame}).src).searchParams.get('workspace')===${JSON.stringify(workspace)}`), "Reload changed popup workspace");
  // Restored AI conversations may require reconnect; the shell file read needs no key.
  if (key) await send("/exit");
  await send("cat host-only.txt");
  assert(await evaluate(`${doc}.querySelector('#terminal').textContent.includes('popup file')`), "Reload lost popup files");
  check("host reload restores the popup workspace and files");
  await call("open", new URL("./", url).href);
  await wait("!!document.querySelector('#send')&&!document.querySelector('#send').disabled");
  await evaluate("(() => {document.querySelector('#prompt').value='read_host_page';document.querySelector('#terminal-form').requestSubmit();return true;})()");
  await wait("!document.querySelector('#send').disabled");
  assert(await evaluate("[...document.querySelectorAll('.line-content')].at(-1).textContent.includes('目前沒有連接宿主頁')"), "Direct app did not explain missing host page");
  check("direct app returns an explicit no-host-page error through bin");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = String(error.message).replaceAll(key || "unused-secret", "[redacted]"); process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/host-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await call("close");
}
