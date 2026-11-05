// Native IndexedDB and incremental terminal smoke; no model credentials required.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const prefix = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const run = promisify(execFile), session = "agr-vfs-terminal";
async function call(...args) { return (await run(prefix[0], [...prefix.slice(1), "--session", session, ...args], { maxBuffer: 5_000_000 })).stdout.trim(); }
const evaluate = async code => JSON.parse(await call("eval", code));
async function ready() {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await evaluate('Boolean(document.querySelector("#send")&&!document.querySelector("#send").disabled)')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Workspace did not become ready");
}
async function command(text) {
  await ready(); await evaluate('(()=>{window.__vfsStart=document.querySelectorAll("#terminal .terminal-line").length;return true})()'); await call("fill", "#prompt", text); await call("click", "#send"); await ready();
  const result = await evaluate(`(()=>{const rows=[...document.querySelectorAll("#terminal .terminal-line")].slice(window.__vfsStart);return {out:rows.filter(r=>r.dataset.channel==='stdout').map(r=>r.querySelector('.line-content').textContent).join(''),exit:rows.find(r=>r.dataset.channel==='exit')?.textContent,err:rows.filter(r=>r.dataset.channel==='stderr').map(r=>r.textContent).join('')}})()`);
  if (result.exit && !result.exit.endsWith('exitCode: 0')) throw new Error(JSON.stringify(result));
  return result.out;
}
function assert(value, message) { if (!value) throw new Error(message); }
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"); url.searchParams.set("workspace", `vfs-${Date.now()}`);
const report = { url: url.href, status: "running", checks: [] };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await call("open", url.href); await ready(); await call("snapshot");
  await call("click", "#mode-toggle"); await ready();
  assert((await command("cat ~/agents.md")).includes("請回覆繁體中文"), "Default rules missing");
  await command("mkdir -p ~/probe");
  for(let start=0;start<100;start+=25) await command(`for i in {${start}..${start+24}}; do printf %4096s x > ~/probe/file$i; done`);
  await evaluate(`(()=>{window.__reads={bodies:0,workspaceScans:0};const get=IDBObjectStore.prototype.get,all=IDBIndex.prototype.getAll;IDBObjectStore.prototype.get=function(...args){if(this.name==='contents')window.__reads.bodies++;return get.apply(this,args)};IDBIndex.prototype.getAll=function(...args){if(this.objectStore.name==='nodes'&&this.name==='workspace')window.__reads.workspaceScans++;return all.apply(this,args)};return true})()`);
  await command("printf x > ~/probe/file0");
  report.overwrite = await evaluate("({...window.__reads})");
  assert(report.overwrite.bodies === 0 && report.overwrite.workspaceScans === 0, "Write read unrelated bodies or scanned workspace"); check("native write reads no file bodies or workspace scan");
  await command("ls -l ~/probe"); report.listing = await evaluate("({...window.__reads})");
  assert(report.listing.bodies === 0 && report.listing.workspaceScans === 0, "Metadata listing read file contents"); check("ls -l uses metadata only");
  await call("click", ".workspace-menu > summary"); await call("click", "#install-demo");
  const demoDeadline=Date.now()+15000;while(Date.now()<demoDeadline){if(await evaluate('document.querySelector("#terminal").textContent.includes("Joke demo:")'))break;await new Promise(r=>setTimeout(r,100))} assert((await command("cat ~/skills/joke-master/SKILL.md")).includes("name: joke-master"), "Skill path broke"); check("skill is readable from ~/skills");
  await call("click", "#mode-toggle");
  // Submit first, then emulate selecting history while the response is streaming.
  const selected = await evaluate(`(()=>{document.querySelector('#prompt').value='Remember refactor-native-check';document.querySelector('#terminal-form').requestSubmit();document.querySelector('#prompt').blur();const node=document.querySelector('#terminal .terminal-line .line-content');window.__oldLine=node;const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);return getSelection().toString()})()`);
  await ready();
  assert(await evaluate('window.__oldLine.isConnected&&document.querySelector("#terminal .terminal-line .line-content")===window.__oldLine'), "Streaming replaced history DOM");
  assert(await evaluate("getSelection().toString()") === selected, "Streaming or completion lost text selection"); check("streaming preserves historical DOM and text selection");
  await command("/exit"); await new Promise(resolve => setTimeout(resolve, 500)); await call("reload"); await ready();
  assert(await evaluate('document.querySelector("#terminal").textContent.includes("Remember refactor-native-check")'), "Reload lost conversation");
  assert((await command("cat ~/probe/file0")) === "x", "Reload lost file content");
  const revision = await evaluate(`(async()=>{const opening=indexedDB.open("agent-go-round.vfs.bytes-v2");const db=await new Promise(r=>opening.onsuccess=()=>r(opening.result));const request=db.transaction("nodes").objectStore("nodes").get(JSON.stringify([new URL(location.href).searchParams.get("workspace"),"/home/user/probe/file0"]));const row=await new Promise(r=>request.onsuccess=()=>r(request.result));db.close();return row.node.revision})()`); assert(revision === 4, "Reload lost file revision"); check("reload preserves conversation and file revision");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true }); await writeFile("test-results/vfs-terminal-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await call("close");
}
