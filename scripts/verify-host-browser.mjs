// Host bridge acceptance without external model credentials.
import { mkdir, writeFile } from "node:fs/promises";
import { assert, browser, fixtureProvider, sequence, tool } from "./browser-fixture.mjs";
const { call, evaluate, wait, ready, send, connect, durable } = browser("agr-host-page");
const steps = sequence([[tool("host-full", "read_host_page", {})], [tool("host-page", "read_host_page", { limit: 20 })], [tool("host-help", "help", { command: "read_host_page" })], "這一頁的作者是gipapa。"]);
const fixture = await fixtureProvider({
  "Read actual host": async body => { await new Promise(r => setTimeout(r, 700)); return steps(body); },
  "No host connected": sequence([[tool("no-host", "read_host_page", {})], "宿主未連接。"])
});
const url = new URL("embed-example.html", process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"); url.searchParams.set("acceptance", String(Date.now()));
const frame = "window.AgentGoRound.defaultWidget.iframe", doc = `(${frame}).contentDocument`;
const report = { url: url.href, provider: "local HTTP/SSE fixture", status: "running", checks: [] };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await mkdir("test-results", { recursive: true }); await call("open", url.href); await call("snapshot"); await ready(doc);
  await evaluate("window.AgentGoRound.defaultWidget.open();window.__hostTrace=[];window.__hostCalls=[];window.addEventListener('message',event=>{if(event.source===window.AgentGoRound.defaultWidget.iframe.contentWindow&&event.data?.type==='host_tool_call')window.__hostCalls.push(event.data.payload)});window.AgentGoRound.defaultWidget.on('message',message=>{if(message.type==='host_tool_result')window.__hostTrace.push(message.payload)});return true");
  const workspace = await evaluate(`return new URL((${frame}).src).searchParams.get('workspace')`);
  assert(workspace?.startsWith("popup-"), "Popup uses default workspace");
  await send("ls ~/bin; ls ~/bin/manifests; printf 'popup file' > ~/host-only.txt", doc);
  assert(await evaluate(`return ${doc}.querySelector('#terminal').textContent.includes('read_host_page.tool.json')`), "Host manifest missing");
  await connect(fixture.baseUrl, doc); await evaluate(`${doc}.querySelector('#mode-toggle').click();return true`);
  await evaluate(`${doc}.querySelector('#add-tab').click();return true`); await ready(doc);
  await evaluate(`${doc}.querySelectorAll('#tab-list .tab')[0].click();return true`);
  await send("Read actual host and paginated HTML", doc, false);
  await evaluate(`${doc}.querySelectorAll('#tab-list .tab')[1].click();return true`);
  await wait("window.__hostTrace.filter(value=>value.status==='success').length>=2");
  await evaluate(`${doc}.querySelectorAll('#tab-list .tab')[0].click();return true`); await ready(doc);
  const state = await durable(workspace), reads = await evaluate("return window.__hostTrace.filter(value=>value.status==='success')");
  const finish = state.events.filter(event => event.type === "run_finished").at(-1);
  assert(finish?.status === "success" && finish.text.includes("gipapa"), "Host run failed");
  assert(reads.some(value => value.result?.html.includes("這一頁的作者是gipapa")) && reads.some(value => value.result?.html.length === 20), "Actual/paginated HTML not returned");
  const calls=await evaluate("return window.__hostCalls");
  assert(calls.every(value => value.sessionId === finish.sessionId) && calls.some(value => value.toolCallId === "host-full") && calls.some(value => value.toolCallId === "host-page") && reads.every(value=>calls.some(call=>call.requestId===value.requestId)), "Host source identity followed selected tab");
  check("sandboxed structured host tool reads actual/paginated HTML with original source identity while another tab is selected");
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{source:(${frame}).contentWindow,origin:location.origin,data:{source:'agent-go-round',type:'host_tool_call',payload:{version:2,instanceId:'invalid-instance',requestId:'invalid',sessionId:'test',toolCallId:'test',toolName:'read_host_page',args:{}}}}));return true`);
  await wait("window.__hostTrace.some(value=>value.requestId==='invalid')");
  assert(await evaluate("return window.__hostTrace.find(value=>value.requestId==='invalid').status==='error'"), "Mismatched instance accepted");
  check("host bridge rejects mismatched identity");
  await evaluate("window.__second=window.AgentGoRound.mount({appUrl:new URL('./',location.href).href});return true");
  await ready("window.__second.iframe.contentDocument");
  const second = await evaluate("return new URL(window.__second.iframe.src).searchParams.get('workspace')");
  assert(second !== workspace && second !== "default" && !(await durable(second)).files.some(file => file.path === "/home/user/host-only.txt"), "File leaked between popup workspaces");
  await evaluate("window.__second.destroy();return true"); check("distinct popup workspaces isolate native IDB files");
  const count = fixture.requests.length; await call("reload"); await ready(doc);
  assert(await evaluate(`return new URL((${frame}).src).searchParams.get('workspace')===${JSON.stringify(workspace)}`), "Reload changed popup workspace");
  await send("/exit", doc); await send("cat ~/host-only.txt", doc);
  assert(await evaluate(`return [...${doc}.querySelectorAll('[data-channel=stdout] .line-content')].at(-1).textContent==='popup file'`), "Reload lost popup files");
  assert(fixture.requests.length === count, "Reload replayed host calls"); check("reload preserves popup workspace/files without replay");
  await call("screenshot", "test-results/host-popup.png");
  const direct = new URL("./", url); direct.searchParams.set("workspace", `no-host-${Date.now()}`);
  await call("open", direct.href); await ready(); await call("snapshot"); await connect(fixture.baseUrl); await call("click", "#mode-toggle"); await send("No host connected");
  const isolated = await durable(direct.searchParams.get("workspace"));
  assert(isolated.events.some(event => event.type === "tool_finished" && event.toolCallId === "no-host" && event.isError) && await evaluate("return document.querySelector('#terminal').textContent.includes('目前沒有連接宿主頁')"), "Direct app lacks explicit no-host error");
  check("direct app structured tool reports missing host");
  assert(fixture.failures.length === 0, fixture.failures.join("; ")); report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; try { report.visible = await evaluate(`return ${doc}?.querySelector('#terminal')?.textContent.slice(-5000)`); } catch {} }
finally { await writeFile("test-results/host-browser.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await call("close"); await fixture.close(); }
