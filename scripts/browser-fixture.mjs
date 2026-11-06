// Acceptance-only provider: exercises the real HTTP/SSE transport and Pi loop.
// It is never imported by product code and does not contact an external model.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const tool = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
export function sequence(steps) {
  let index = 0;
  return () => { if (index >= steps.length) throw new Error("Unexpected fixture request after final response"); return steps[index++]; };
}
export async function fixtureProvider(routes) {
  const requests = [], failures = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.url.endsWith("/models")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: [{ id: "fixture-model", context_window: 128000 }] })); return; }
    try {
      let source = ""; for await (const part of req) source += part;
      const body = JSON.parse(source); requests.push(body);
      const user = [...body.messages].reverse().find(message => message.role === "user");
      const prompt = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
      const route = Object.entries(routes).find(([match]) => prompt?.includes(match));
      if (!route) throw new Error(`No fixture for prompt: ${prompt}`);
      const step = await route[1](body);
      const tools = Array.isArray(step);
      const delta = tools ? { role: "assistant", tool_calls: step.map((call, index) => ({ index, ...call })) } : { role: "assistant", content: step };
      res.setHeader("Content-Type", "text/event-stream");
      const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      res.end(chunk(delta, null) + chunk({}, tools ? "tool_calls" : "stop") + "data: [DONE]\n\n");
    } catch (error) { failures.push(error.message); res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests, failures, close: () => new Promise(resolve => server.close(resolve)) };
}

export function browser(session) {
  const cli = process.env.AGENT_BROWSER_CLI || "agent-browser", command = cli.endsWith(".js") ? [process.execPath, cli] : [cli], exec = promisify(execFile);
  const call = async (...args) => (await exec(command[0], [...command.slice(1), "--session", session, ...args], { maxBuffer: 8_000_000, timeout: 45_000 })).stdout.trim();
  const evaluate = async source => JSON.parse(await call("eval", `(async()=>{${source}})()`));
  const wait = async (expression, timeout = 35000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await evaluate(`return ${expression}`)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out: ${expression}`);
  };
  const ready = (doc = "document", timeout = 35000) => wait(`Boolean(${doc}?.querySelector('#send')&&!${doc}.querySelector('#send').disabled)`, timeout);
  const send = async (text, doc = "document", settle = true) => {
    await ready(doc);
    await evaluate(`const d=${doc};d.querySelector('#prompt').value=${JSON.stringify(text)};d.querySelector('#terminal-form').requestSubmit();return true`);
    if (settle) await ready(doc, 120000);
  };
  const connect = async (baseUrl, doc = "document") => {
    await ready(doc);
    await evaluate(`const d=${doc};d.querySelector('#provider-toggle').click();d.querySelector('#base-url').value=${JSON.stringify(baseUrl)};d.querySelector('#api-key').value='acceptance-fixture';d.querySelector('#model').value='fixture-model';d.querySelector('#context-window').value='128000';d.querySelector('#remember-key').checked=false;d.querySelector('#provider-form').requestSubmit();return true`);
    await wait(`${doc}.querySelector('#provider-label').textContent==='groq · live'`);
  };
  const durable = async workspace => {
    await new Promise(resolve => setTimeout(resolve, 350));
    return evaluate(`const rows=async(name,store)=>{const opening=indexedDB.open(name);const db=await new Promise((resolve,reject)=>{opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error)});try{return await new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}finally{db.close()}};
      const workspace=${JSON.stringify(workspace)},records=(await rows('agent-go-round.sessions','records')).filter(row=>row.workspace===workspace);
      const contents=new Map((await rows('agent-go-round.vfs.bytes-v2','contents')).map(row=>[row.key,row.content]));
      return {records,events:records.filter(row=>row.id.startsWith('event:')).map(row=>row.value),files:(await rows('agent-go-round.vfs.bytes-v2','nodes')).filter(row=>row.workspace===workspace).map(row=>({...row.node,...(row.node.kind==='file'?{content:new TextDecoder().decode(contents.get(row.key))}:{})}))}`);
  };
  return { call, evaluate, wait, ready, send, connect, durable };
}
export function assert(value, message) { if (!value) throw new Error(message); }
export const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
export const writeFiles = files => files.map(({ path, content }) => `printf '%s' ${shellQuote(content)} > ${shellQuote(path.replace(/^~(?=\/|$)/, "/home/user"))}`).join("; ");

// Shared acceptance path for operations that used to have Workspace buttons.
export async function workspaceToolFixture() {
  let nextToolId = 0;
  return fixtureProvider({
    "Workspace tool fixture: ": body => {
      if (body.messages.at(-1).role === "tool") return "工具操作完成。";
      const content = [...body.messages].reverse().find(message => message.role === "user").content;
      const prompt = typeof content === "string" ? content : content.map(block => block.text || "").join("");
      const { name, args } = JSON.parse(prompt.slice(prompt.indexOf("{")));
      return [tool(`workspace-tool-${++nextToolId}`, name, args)];
    },
    "": () => "工作區測試回覆。"
  });
}

// Serialized into a fixture page or evaluated through agent-browser.
export async function runWorkspaceToolInPage(baseUrl, name, args = {}, doc = document) {
  const until = async test => {
    const start = Date.now();
    while (!test()) {
      if (Date.now() - start > 25000) throw new Error(`Workspace tool timed out: ${name}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  await until(() => doc.querySelector("#send") && !doc.querySelector("#send").disabled);
  doc.querySelector("#provider-toggle").click();
  doc.querySelector("#base-url").value = baseUrl;
  doc.querySelector("#api-key").value = "acceptance-fixture";
  doc.querySelector("#model").value = "fixture-model";
  doc.querySelector("#context-window").value = "128000";
  doc.querySelector("#remember-key").checked = false;
  doc.querySelector("#provider-form").requestSubmit();
  await until(() => doc.querySelector("#settings-drawer").hidden);
  if (doc.querySelector("#mode-toggle").getAttribute("aria-checked") !== "true") {
    doc.querySelector("#mode-toggle").click();
    await until(() => doc.querySelector("#mode-toggle").getAttribute("aria-checked") === "true");
  }
  const sourceIndex = [...doc.querySelectorAll("#tab-list .tab")].findIndex(tab => tab.getAttribute("aria-selected") === "true");
  doc.querySelector("#prompt").value = `Workspace tool fixture: ${JSON.stringify({ name, args })}`;
  doc.querySelector("#terminal-form").requestSubmit();
  await until(() => !doc.querySelector("#tab-list .status-dot.working") && !doc.querySelector("#send").disabled);
  const finalIndex = [...doc.querySelectorAll("#tab-list .tab")].findIndex(tab => tab.getAttribute("aria-selected") === "true");
  if (sourceIndex !== finalIndex) {
    doc.querySelectorAll("#tab-list .tab")[sourceIndex].click();
    await until(() => !doc.querySelector("#send").disabled);
    doc.querySelectorAll("#tab-list .tab")[finalIndex].click();
  }
  if (doc.querySelector("#tab-list .status-dot.error")) throw new Error(`Workspace tool failed: ${name}: ${doc.querySelector("#terminal").textContent.slice(-2000)}`);
  return true;
}

export const workspaceToolScript = (baseUrl, name, args = {}) => `(${runWorkspaceToolInPage.toString()})(${JSON.stringify(baseUrl)},${JSON.stringify(name)},${JSON.stringify(args)})`;

// Human-only Preview is opened by UI controls, without a model or provider connection.
export async function openHumanPreviewInPage(path = "~/main.html", doc = document) {
  const until = async test => {
    const start = Date.now();
    while (!test()) { if (Date.now() - start > 25000) throw new Error("Human preview timed out"); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  await until(() => doc.querySelector("#human-preview") && !doc.querySelector("#human-preview").disabled);
  doc.querySelector("#human-preview").click();
  doc.querySelector("#human-preview-path").value = path;
  doc.querySelector("#human-preview-form").requestSubmit();
  await until(() => doc.querySelector("#human-preview-dialog").hidden && doc.querySelector("#pane-type").textContent === "頁面預覽");
  return true;
}
export const humanPreviewScript = (path = "~/main.html") => `(${openHumanPreviewInPage.toString()})(${JSON.stringify(path)})`;
