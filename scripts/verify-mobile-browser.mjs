// Geometry regression: simulates the visual viewport above an on-screen keyboard.
// Does not claim to exercise a physical iOS keyboard. No model credentials needed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const command = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const run = promisify(execFile);
async function call(...args) { return (await run(command[0], [...command.slice(1), "--session", "agr-mobile-keyboard", ...args], { maxBuffer: 8_000_000 })).stdout.trim(); }
const evaluate = async code => JSON.parse(await call("eval", code));
async function wait(condition, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(condition)) return; await new Promise(resolve => setTimeout(resolve, 300)); }
  throw new Error(`Timed out: ${condition}`);
}
function assert(value, message) { if (!value) throw new Error(message); }
async function send(text) {
  await wait("!!document.querySelector('#send')&&!document.querySelector('#send').disabled");
  await call("fill", "#prompt", text);
  await evaluate("(() => {document.querySelector('#terminal-form').requestSubmit();return true;})()");
  await wait("!document.querySelector('#send').disabled");
}
async function viewport(height, offsetTop = 0, width = 390, offsetLeft = 0) {
  await evaluate(`(() => {Object.assign(window.__keyboardViewport,{height:${height},offsetTop:${offsetTop},width:${width},offsetLeft:${offsetLeft}});window.dispatchEvent(new Event('resize'));return true;})()`);
  await new Promise(resolve => setTimeout(resolve, 200));
}
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"); url.searchParams.set("workspace", `keyboard-${Date.now()}`);
const report = { url: url.href, simulatedVisualViewport: true, checks: [], status: "running" };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await call("open", url.href); await call("set", "viewport", "1280", "900");
  await wait("!!document.querySelector('#send')&&!document.querySelector('#send').disabled"); await call("snapshot");
  assert(await evaluate("getComputedStyle(document.querySelector('.sidebar')).display==='none'&&getComputedStyle(document.querySelector('.tab-bar')).display!=='none'&&document.querySelector('#provider-toggle').getBoundingClientRect().width>0"), "Desktop should show horizontal tabs and accessible settings only");
  await call("screenshot", "test-results/tabs-desktop.png");
  check("desktop shows horizontal tabs only with accessible provider settings");
  await call("set", "viewport", "390", "844");
  assert(await evaluate("getComputedStyle(document.querySelector('.sidebar')).display!=='none'&&getComputedStyle(document.querySelector('.tab-bar')).display==='none'"), "Mobile should show vertical tabs only");
  const initialTabs = await evaluate("document.querySelectorAll('#agent-list .agent-row').length");
  await call("click", "#add-vertical-tab");
  await wait(`document.querySelectorAll('#agent-list .agent-row').length===${initialTabs+1}`);
  await call("click", "#agent-list .vertical-tab:last-child .vertical-close");
  await wait(`document.querySelectorAll('#agent-list .agent-row').length===${initialTabs}`);
  await call("click", "#agent-list .agent-row");
  await call("screenshot", "test-results/tabs-mobile.png");
  check("mobile has one vertical tab rail with working add, close and switch controls");
  await wait("!!document.querySelector('#send')&&!document.querySelector('#send').disabled"); await call("snapshot");
  assert(await evaluate("document.querySelector('.shell-notice').textContent.includes('簡易 bash')&&document.querySelector('.shell-notice').textContent.includes('read／cat、write、edit、grep、find、ls')"), "Missing shell capabilities");
  await send('WrItE ' + JSON.stringify({ path: "Case.MD", content: "MiXeD" }));
  await send("ReAd Case.MD");
  assert(await evaluate("(() => {const result=JSON.parse([...document.querySelectorAll('#terminal .line-content')].at(-1).textContent);return result.path==='/home/user/Case.MD'&&result.content==='MiXeD';})()"), "Mixed-case commands changed path or content");
  check("mixed-case file commands preserve path and content case");
  await send("ls");
  assert(await evaluate("[...document.querySelectorAll('#terminal .line-content')].at(-1).textContent.split(String.fromCharCode(10)).join(',')==='Case.MD,agents.md,bin,skills'"), "ls did not list current directory names");
  await send("cat Case.MD");
  assert(await evaluate("[...document.querySelectorAll('#terminal .line-content')].at(-1).textContent==='MiXeD'"), "cat did not display raw content");
  for (const command of ["ls", "ai", "edit", "preview", "history", "demo"]) {
    await send(`${command} --help`);
    assert(await evaluate("document.querySelector('#pane-type').textContent==='簡易 bash'&&[...document.querySelectorAll('#terminal .line-content')].at(-1).textContent.length>40"), `${command} help performed an action or was empty`);
  }
  check("ls and cat show readable file data; UI command help does not trigger actions");
  await send("HELP"); await send("hElP");
  await call("focus", "#prompt");
  await evaluate("(() => {window.__nativeVisualViewport=Object.getOwnPropertyDescriptor(window,'visualViewport');window.__keyboardViewport=Object.assign(new EventTarget(),{width:390,height:844,offsetTop:0,offsetLeft:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__keyboardViewport});return true;})()");
  await viewport(360, 60);
  const compact = await evaluate("(() => {const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};return {shell:box(document.querySelector('.app-shell')),form:box(document.querySelector('#terminal-form')),send:box(document.querySelector('#send')),terminal:box(document.querySelector('#terminal')),font:getComputedStyle(document.querySelector('#prompt')).fontSize,compact:document.documentElement.classList.contains('keyboard-open'),sidebar:getComputedStyle(document.querySelector('.sidebar')).display};})()");
  assert(compact.compact && compact.sidebar !== "none", "Keyboard chrome did not compact or vertical tabs disappeared");
  assert(compact.font === "16px", "Mobile prompt could trigger focus zoom");
  assert(compact.form.bottom <= 420 && compact.send.bottom <= 420 && compact.form.height < 70 && compact.terminal.height >= 180, "Keyboard covers composer or leaves too little transcript space");
  assert(await evaluate("(() => {const t=document.querySelector('#terminal');t.scrollTop=0;const first=t.scrollTop;t.scrollTop=t.scrollHeight;return t.scrollTop>first;})()"), "Transcript cannot scroll with keyboard open");
  report.compact = compact; check("360px visible viewport keeps composer visible and transcript scrollable");
  await call("screenshot", "test-results/mobile-keyboard-simulated.png");
  await send("AI"); assert(await evaluate("document.querySelector('#pane-type').textContent==='AI agent'"), "ai did not enter agent mode");
  const mobileEnter = await evaluate("(() => {const prompt=document.querySelector('#prompt');prompt.value='line';const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});prompt.dispatchEvent(event);return {defaultPrevented:event.defaultPrevented,pane:document.querySelector('#pane-type').textContent};})()");
  assert(!mobileEnter.defaultPrevented && mobileEnter.pane === "AI agent", "mobile AI Enter should insert a newline instead of submitting");
  check("mobile AI composer keeps Enter for newlines");
  await send("/ExIt"); await send("Ai --NeW"); await send("/EXIT");
  check("ai, ai --new and /exit work with compact composer");
  await viewport(844);
  assert(await evaluate("!document.documentElement.classList.contains('keyboard-open')&&getComputedStyle(document.querySelector('.sidebar')).display!=='none'"), "Keyboard close did not restore layout");
  check("closing keyboard restores normal chrome");
  await call("click", "#sidebar-provider-toggle"); await viewport(360, 60);
  assert(await evaluate("(() => {const input=document.querySelector('#api-key'),button=document.querySelector('button[form=provider-form]'),a=input.getBoundingClientRect(),b=button.getBoundingClientRect();return getComputedStyle(input).fontSize==='16px'&&a.top>=60&&a.bottom<=420&&b.bottom<=420;})()"), "Settings controls covered by keyboard");
  await call("click", "#close-settings"); await viewport(844);
  check("provider inputs and connect action fit the visible viewport");
  await send("PrEvIeW");
  await wait("[...document.querySelectorAll('.preview-toolbar button')].some(b=>b.textContent==='建立主頁範本'&&!b.hidden)");
  await evaluate("(() => {[...document.querySelectorAll('.preview-toolbar button')].find(b=>b.textContent==='建立主頁範本').click();return true;})()");
  await wait("document.querySelector('.preview-surface > iframe')?.srcdoc.includes('我的 Pi 主頁')");
  const frame = 'document.querySelector(".preview-surface > div:last-child").shadowRoot.querySelector("iframe")';
  await wait(`!!(${frame}).contentDocument?.querySelector('#send')&&!(${frame}).contentDocument.querySelector('#send').disabled`);
  await evaluate(`(() => {document.querySelector('.preview-surface > div:last-child').shadowRoot.querySelector('.launcher').click();const w=(${frame}).contentWindow,d=w.document;w.__keyboardSentinel='keep';d.querySelector('#prompt').value='draft remains';d.querySelector('#prompt').focus();return true;})()`);
  assert(await evaluate(`(() => {const d=(${frame}).contentDocument;return d.body.classList.contains('vertical-tabs')&&getComputedStyle(d.querySelector('.tab-bar')).display==='none'&&getComputedStyle(d.querySelector('.sidebar')).display!=='none';})()`), "Popup should show vertical tabs only");
  check("popup shows vertical tabs only");
  await viewport(360, 60);
  await wait(`(${frame}).contentDocument.documentElement.classList.contains('keyboard-open')`);
  const popup = await evaluate(`(() => {const frame=${frame},d=frame.contentDocument,r=frame.getBoundingClientRect(),b=d.querySelector('#send').getBoundingClientRect();return {height:r.height,width:r.width,top:r.top,bottom:r.bottom,sendBottom:b.bottom,font:getComputedStyle(d.querySelector('#prompt')).fontSize,terminalHeight:d.querySelector('#terminal').clientHeight,preserved:frame.contentWindow.__keyboardSentinel==='keep'&&d.querySelector('#prompt').value==='draft remains'};})()`);
  assert(popup.height === 360 && popup.top === 60 && popup.bottom <= 420 && popup.sendBottom <= 360 && popup.terminalHeight >= 180 && popup.preserved, "Popup keyboard geometry or draft preservation failed");
  assert(popup.font === "16px", "Popup input is too small");
  report.popup = popup; check("popup follows host keyboard viewport without remounting or losing draft");
  await call("screenshot", "test-results/mobile-popup-keyboard-simulated.png");
  await viewport(360, 60, 360, 17);
  assert(await evaluate(`(() => {const r=(${frame}).getBoundingClientRect();return r.left===17&&r.width===360&&r.right<=377;})()`), "Panned viewport clips popup horizontally");
  await viewport(844);
  assert(await evaluate(`(${frame}).contentWindow.__keyboardSentinel==='keep'&&(${frame}).contentDocument.querySelector('#prompt').value==='draft remains'`), "Viewport restore remounted popup");
  check("horizontal viewport offset and keyboard dismissal preserve popup");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/mobile-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await call("close");
}
