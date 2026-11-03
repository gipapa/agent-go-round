// Cross-origin HTTP embed + native IndexedDB/Worker regression; no API key needed.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { preview } from "vite";

const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const prefix = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const run = promisify(execFile), session = `agr-embed-vfs-${process.pid}`;
async function call(...args) {
  return (await run(prefix[0], [...prefix.slice(1), "--session", session, ...args], { maxBuffer: 5_000_000, timeout: 45_000 })).stdout.trim();
}
const evaluate = async code => JSON.parse(await call("eval", code));
function assert(value, message) { if (!value) throw new Error(message); }
async function wait(condition) {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await evaluate(condition)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${condition}`);
}
const state = () => evaluate("window.probe()");
const ready = () => wait('window.probe().then(state=>state.ready)');
async function command(text) {
  await ready(); await evaluate(`window.probe({command:${JSON.stringify(text)}})`); await ready();
  const result = await state();
  assert(result.status !== "error", `${text}: ${result.text}`);
  return result.text;
}
async function enterWidget() {
  await wait("Boolean(window.__embedReady)");
  const tree = await call("snapshot", "-i");
  assert(tree.includes('Iframe "AgentGoRound"'), `Missing embed iframe: ${tree}`);
  await ready();
}

// Test-only diagnostics are injected into fixture HTML; production code has no probe.
function installProbe(hostOrigin) {
  window.addEventListener("message", async event => {
    if (event.source !== parent || event.origin !== hostOrigin || event.data?.source !== "embed-vfs-test") return;
    const { id, command, shellTab, previewEntry, stop, queryStop } = event.data;
    let committed;
    if (queryStop) {
      const opening = indexedDB.open("agent-go-round.vfs.bytes-v2", 1);
      const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
      const key = JSON.stringify([new URL(location.href).searchParams.get("workspace"), "/home/user/popup-stop"]);
      const request = db.transaction("contents").objectStore("contents").get(key);
      const row = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      committed = !!row && new TextDecoder().decode(row.content) === "popup-committed"; db.close();
    }
    if (stop) document.querySelector("#stop").click();
    if (previewEntry) { document.querySelector("#preview-entry").value = previewEntry; document.querySelector("#open-preview-form").requestSubmit(); }
    if (shellTab) document.querySelector("#agent-list .agent-row").click();
    if (command !== undefined) {
      document.querySelector("#prompt").value = command;
      document.querySelector("#terminal-form").requestSubmit();
    }
    const rows = [...document.querySelectorAll("#terminal .terminal-line")];
    const lastInput = rows.findLastIndex(row => row.classList.contains("input"));
    const output = rows.slice(lastInput + 1);
    const content = channel => output.filter(row => row.dataset.channel === channel).map(row => row.querySelector(".line-content").textContent).join("");
    parent.postMessage({ source: "embed-vfs-test", id, state: {
      ready: !!document.querySelector("#send") && !document.querySelector("#send").disabled,
      status: document.querySelector("#run-status")?.textContent,
      text: content("stdout"), stderr: content("stderr"), exitCode: content("exit"),
      committed,
      worker: !!document.querySelector('iframe[data-shell-isolation="opaque-worker"]'),
      hasWorker: !!document.querySelector("iframe[data-shell-owner]"),
      saved: document.querySelector("#workspace-status")?.textContent.includes("saved"),
      preview: document.querySelector(".preview-surface > iframe")?.srcdoc.includes("Embedded preview") ?? false,
      crypto: { randomUUID: typeof globalThis.crypto?.randomUUID, getRandomValues: typeof globalThis.crypto?.getRandomValues }
    } }, event.origin);
  });
}

let app, host;
let hostOrigin;
const basePath = process.env.VITE_BASE_PATH || "/";
const report = { status: "running", checks: [] };
try {
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  app = await preview({
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
    plugins: [{
      name: "embed-vfs-compatibility-fixture",
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url, "http://localhost");
          if (url.pathname !== basePath && url.pathname !== "/") return next();
          const disableUUID = url.searchParams.has("without-random-uuid") ? 'Object.defineProperty(Crypto.prototype,"randomUUID",{configurable:true,value:undefined});' : "";
          response.setHeader("Content-Type", "text/html");
          response.end(index.replace("<head>", `<head><script>${disableUUID}(${installProbe.toString()})(${JSON.stringify(hostOrigin)});</script>`));
        });
      }
    }]
  });
  const appUrl = `http://127.0.0.1:${app.httpServer.address().port}${basePath}`;
  host = createServer((request, response) => {
    const compat = new URL(request.url, "http://localhost").searchParams.has("compat");
    const options = { appUrl: appUrl + (compat ? "?without-random-uuid" : ""), workspaceId: `embed-${process.pid}-${compat ? "compat" : "native"}`, surfaceId: "embed-test", initiallyOpen: true };
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><title>Embed VFS regression</title></head><body><h1>HTTP embed host</h1><script type="module">
      import "${appUrl}embed.js";
      window.widget=window.AgentGoRound.mount(${JSON.stringify(options)});
      window.widget.on("ready",()=>window.__embedReady=true);
      let nextId=0;
      window.probe=(options={})=>new Promise((resolve,reject)=>{
        const id=++nextId;
        const cleanup=()=>{clearTimeout(timer);window.removeEventListener("message",receive)};
        const receive=event=>{if(event.source===window.widget.iframe.contentWindow&&event.origin===${JSON.stringify(new URL(appUrl).origin)}&&event.data?.source==="embed-vfs-test"&&event.data.id===id){cleanup();resolve(event.data.state)}};
        const timer=setTimeout(()=>{cleanup();reject(new Error("Embed probe timed out"))},5000);
        window.addEventListener("message",receive);
        window.widget.iframe.contentWindow.postMessage({source:"embed-vfs-test",id,...options},${JSON.stringify(new URL(appUrl).origin)});
      });
    </script></body></html>`);
  });
  await new Promise((resolve, reject) => { host.once("error", reject); host.listen(0, "127.0.0.1", resolve); });
  const hostUrl = `http://127.0.0.1:${host.address().port}/`;
  hostOrigin = new URL(hostUrl).origin;
  assert(new URL(hostUrl).origin !== new URL(appUrl).origin, "Fixture must use a cross-origin host");
  report.hostUrl = hostUrl; report.appUrl = appUrl;
  await mkdir("test-results", { recursive: true });
  for (const compat of [false, true]) {
    const mode = compat ? "without-randomUUID" : "native";
    await call("open", hostUrl + (compat ? "?compat" : "")); await enterWidget();
    const { crypto } = await state();
    assert(crypto.randomUUID === (compat ? "undefined" : "function") && crypto.getRandomValues === "function", "Unexpected crypto fixture");
    assert(await command("cat ~/agents.md") === "請回覆繁體中文", `${mode}: VFS failed to initialize or sandbox read failed`);
    await command("printf 'embedded file' > notes.md");
    assert(await command("cat notes.md") === "embedded file", `${mode}: file read did not match write`);
    assert((await command("ls")).includes("notes.md"), `${mode}: missing file in listing`);
    await evaluate('window.probe({command:"printf popup-committed > ~/popup-stop; sleep 30; printf late > ~/popup-late"})');
    await wait("window.probe().then(state=>state.worker)");
    await wait("window.probe({queryStop:true}).then(state=>state.committed)");
    await evaluate("window.probe({stop:true})"); await ready();
    assert(!(await state()).hasWorker, `${mode}: Stop did not revoke popup Worker`);
    assert(await command("cat ~/popup-stop; test ! -e ~/popup-late") === "popup-committed", `${mode}: popup Stop corrupted committed files or accepted late writes`);
    await command("printf '<h1>Embedded preview</h1>' > main.html");
    await evaluate('window.probe({previewEntry:"main.html"})');
    await wait("window.probe().then(state=>state.preview&&state.saved)");
    await call("screenshot", `test-results/embed-vfs-${mode}.png`);
    await call("reload"); await enterWidget();
    await wait("window.probe().then(state=>state.preview)");
    await evaluate("window.probe({shellTab:true})");
    assert(await command("cat notes.md") === "embedded file", `${mode}: reload lost VFS content`);
    report.checks.push({ mode, crypto, status: "pass", behavior: "cross-origin embed initializes, lists, writes, reads, previews and reloads files" });
  }
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; }
finally {
  await call("close").catch(() => {});
  if (host) await new Promise(resolve => host.close(resolve));
  if (app) await new Promise(resolve => app.httpServer.close(resolve));
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/embed-vfs-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
