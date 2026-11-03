// Deterministic transport; real Pi sessions, structured sandbox and tab router.
import { mkdir, writeFile } from "node:fs/promises";
import { assert, browser, fixtureProvider, sequence, tool } from "./browser-fixture.mjs";
const { call, evaluate, wait, ready, send, connect, durable } = browser("agr-cross-tab");
const joke = "工程師說：我不是拖延，我在等背景工作完成。";
let sourceStep = 0, requestId;
const reader = id => async body => {
  const last = body.messages.at(-1);
  return last.role === "user" ? [tool(id, "agents", { action: "read", requestId, waitMs: 0 })] : "request inspected";
};
const routes = {
  "Cross-tab source": async body => {
    const last = body.messages.filter(message => message.role === "tool").at(-1);
    const value = last && JSON.parse(last.content);
    switch (sourceStep++) {
      case 0: await new Promise(r => setTimeout(r, 700)); return [tool("discover", "agents", { action: "list" })];
      case 1: return [tool("send-once", "agents", { action: "send", target: value.agents.find(agent => agent.available).id, text: "Target fixture: 請講一個簡短繁體中文笑話，並將它寫入 ~/target.txt。" })];
      default: requestId = value.requestId; if (!["success", "pending"].includes(value.status)) return `Target failed: ${JSON.stringify(value)}`; return value.status === "success" ? value.text : [tool(`poll-${sourceStep}`, "agents", { action: "read", requestId, waitMs: 5000 })];
    }
  },
  "Target fixture": sequence([[tool("target-bash", "bash", { script: "printf '%s' '" + joke + "' > ~/target.txt" })], joke]),
  "Read same request": reader("same"), "Expired request": reader("expired")
};
const fixture = await fixtureProvider(routes);
const workspace = `tabs-${Date.now()}`, url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"); url.searchParams.set("workspace", workspace);
const report = { url: url.href, provider: "local HTTP/SSE fixture", status: "running", checks: [] };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await mkdir("test-results", { recursive: true }); await call("open", url.href); await ready(); await call("snapshot");
  await connect(fixture.baseUrl); await call("click", "#mode-toggle");
  await call("click", "#add-tab"); await ready(); await call("click", "#mode-toggle");
  await evaluate("document.querySelectorAll('#tab-list .tab')[0].click();return true");
  await send("Cross-tab source: discover the other tab, send one task and relay its exact answer", "document", false);
  await evaluate("document.querySelectorAll('#tab-list .tab')[1].click();return true");
  await wait("document.querySelector('#terminal').textContent.includes('incoming question from main')"); await ready();
  await call("screenshot", "test-results/cross-tab-target.png");
  await evaluate("document.querySelectorAll('#tab-list .tab')[0].click();return true"); await ready();
  let state = await durable(workspace), layout = state.records.find(row => row.id === "layout").value.snapshot;
  const source = layout.tabs[0], target = layout.tabs[1];
  const calls = source.session.messages.filter(message => message.role === "assistant").flatMap(message => message.content.filter(block => block.type === "toolCall"));
  const results = source.session.messages.filter(message => message.role === "toolResult" && message.toolName === "agents").map(message => JSON.parse(message.content.map(block => block.text || "").join("")));
  const targetRun = state.events.filter(event => event.type === "run_finished" && event.sessionId === target.session.sessionId);
  const sourceRun = state.events.filter(event => event.type === "run_finished" && event.sessionId === source.session.sessionId).at(-1);
  assert(source.session.sessionId !== target.session.sessionId && targetRun.length === 1 && targetRun[0].status === "success", "Target did not execute exactly once in its own session");
  assert(calls.filter(call => call.name === "agents" && call.arguments.action === "send").length === 1 && results.some(value => value.self === source.id), "Selected tab replaced source identity or task was resent");
  assert(calls.filter(call => call.arguments.action === "read").every(call => call.arguments.requestId === requestId), "Source changed request IDs while polling");
  assert(results.some(value => value.status === "success" && value.text === targetRun[0].text) && sourceRun?.text === targetRun[0].text && sourceRun.status === "success", "Source did not relay actual target reply");
  assert(state.files.find(file => file.path === "/home/user/target.txt")?.content === joke, "Target bash did not write shared workspace");
  check("two sessions preserve source identity while target tab is selected; one send, same-ID reads and exact reply");
  await send("Read same request"); state = await durable(workspace);
  assert(state.events.some(event => event.type === "tool_finished" && event.toolCallId === "same" && !event.isError), "Original session could not read accepted request");
  const count = fixture.requests.length; await call("reload"); await ready(); await connect(fixture.baseUrl);
  assert(fixture.requests.length === count, "Reload/reconnect replayed a routed task");
  await send("Expired request"); state = await durable(workspace);
  assert(state.events.some(event => event.type === "tool_finished" && event.toolCallId === "expired" && event.isError), "Reload reused an expired request");
  assert(state.files.find(file => file.path === "/home/user/target.txt")?.content === joke, "Reload lost target file");
  check("reload preserves transcripts/files, does not resend, and expires page-local request IDs");
  assert(fixture.failures.length === 0, fixture.failures.join("; ")); report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; try { report.visible = await evaluate("return document.querySelector('#terminal')?.textContent.slice(-6000)"); report.durable = await durable(workspace); } catch {} }
finally { await writeFile("test-results/cross-tab-browser.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await call("close"); await fixture.close(); }
