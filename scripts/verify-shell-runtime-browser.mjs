// Formal product shell: opaque Worker, native IDB, real UI and reload. No model key.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const prefix = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const exec = promisify(execFile), session = "agr-shell-runtime";
const call = async (...args) => (await exec(prefix[0], [...prefix.slice(1), "--session", session, ...args], { maxBuffer: 5_000_000, timeout: 45_000 })).stdout.trim();
const evaluate = async code => JSON.parse(await call("eval", `(async()=>{${code}})()`));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function ready() {
  const start = Date.now();
  while (Date.now() - start < 35_000) {
    if (await evaluate('return Boolean(document.querySelector("#send")&&!document.querySelector("#send").disabled)')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Shell UI did not become idle");
}
async function start(script) {
  await ready();
  await evaluate('window.__shellRows=document.querySelectorAll("#terminal .terminal-line").length;return true');
  await call("fill", "#prompt", script); await call("click", "#send");
}
async function result() {
  await ready();
  return evaluate(`const rows=[...document.querySelectorAll("#terminal .terminal-line")].slice(window.__shellRows);
    const text=channel=>rows.filter(row=>row.dataset.channel===channel).map(row=>row.querySelector(".line-content").textContent).join("");
    return {stdout:text("stdout"),stderr:text("stderr"),exitCode:Number(text("exit").split(":")[1]),cwd:document.querySelector("#pane-path").textContent,all:rows.map(row=>row.textContent).join("\\n")};`);
}
async function run(script) { await start(script); return result(); }
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/");
url.searchParams.set("workspace", `runtime-${Date.now()}`);
const report = { url: url.href, status: "running", checks: [] };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await call("open", url.href); await ready(); await call("snapshot");
  const sample = await run(`mkdir -p ~/docs && cd ~/docs
printf 'hello\\n世界\\n' > notes.txt
cat notes.txt | grep hello > matches.txt
printf 'more\\n' >> notes.txt
cat *.txt | wc -l
test -f matches.txt && echo ok
cat <<'EOF' > literal.txt
$HOME is literal here
EOF
for f in *.txt; do echo "$f"; done`);
  assert(sample.stdout === "4\nok\nliteral.txt\nmatches.txt\nnotes.txt\n" && sample.stderr === "" && sample.exitCode === 0 && sample.cwd === "~/docs", JSON.stringify(sample));
  check("product UI sends complete scripts through just-bash and separates stdout/stderr/exitCode");
  assert((await run("PWD=/tmp; pwd")).stdout === "/home/user/docs\n", "PWD spoof changed actual cwd");
  assert((await run("pwd")).stdout === "/home/user/docs\n", "PWD spoof was persisted");
  const exited = await run("cd ~; exit 7");
  assert(exited.exitCode === 7 && exited.cwd === "~", "cwd was lost on exit");
  assert((await run('eval "cd ~/docs; exit 3"')).cwd === "~/docs", "eval exit lost cwd");
  assert((await run("(cd /tmp); pwd")).stdout === "/home/user/docs\n", "Subshell changed parent cwd");
  check("actual cwd survives PWD spoofing and exit; subshells remain isolated");
  await run("export VALUE=one; f() { echo function; }; f");
  assert((await run("echo ${VALUE-unset}")).stdout === "unset\n", "Variables leaked between independent scripts");
  const upper = await run("LS"); assert(upper.exitCode !== 0 && upper.stderr.includes("command not found"), "Old case-insensitive parser remains");
  assert((await run("read answer <<< hello; echo $answer")).stdout === "hello\n", "read was intercepted as a JSON file tool");
  check("independent scripts, upstream case sensitivity and read builtin");
  await call("click", "#add-tab"); await ready();
  assert((await run("pwd; cat ~/docs/matches.txt")).stdout === "/home/user\nhello\n", "Tabs do not share files with separate cwd");
  await run("cd /tmp");
  await evaluate('document.querySelector("#tab-list .tab").click();return true'); await ready();
  assert((await run("pwd")).stdout === "/home/user/docs\n", "Tab A cwd changed with Tab B");
  await new Promise(resolve => setTimeout(resolve, 500)); await call("reload"); await ready();
  assert((await run("pwd; cat notes.txt")).stdout === "/home/user/docs\nhello\n世界\nmore\n", "Reload lost files or cwd");
  await evaluate('document.querySelectorAll("#tab-list .tab")[1].click();return true'); await ready();
  assert((await run("pwd")).stdout === "/tmp\n", "Reload lost the other tab's root cwd");
  check("two tabs share native IDB files and preserve independent cwd across reload");
  const channels = await run("printf out; printf err >&2; false");
  assert(channels.stdout === "out" && channels.stderr === "err" && channels.exitCode === 1, "Output channels were combined");
  check("stderr and nonzero exit codes are visible independently");
  await start("printf committed > ~/before-stop; sleep 30; printf late > ~/after-stop");
  const isolated = await evaluate(`
    const start=Date.now(); let frame;
    while(Date.now()-start<5000){frame=document.querySelector('iframe[data-shell-isolation="opaque-worker"]');if(frame)break;await new Promise(r=>setTimeout(r,30))}
    if(!frame)return {found:false};let blocked=false;try{blocked=frame.contentWindow.document===undefined}catch{blocked=true}
    return {found:true,sandbox:frame.getAttribute("sandbox"),blocked,policy:frame.srcdoc.includes("connect-src 'none'")};
  `);
  assert(isolated.found && isolated.sandbox === "allow-scripts" && isolated.blocked && isolated.policy, "Opaque Worker/CSP boundary missing");
  const committed = await evaluate(`
    const opening=indexedDB.open("agent-go-round.vfs.bytes-v2",1);
    const db=await new Promise((resolve,reject)=>{opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error)});
    const key=JSON.stringify([new URL(location.href).searchParams.get("workspace"),"/home/user/before-stop"]);
    let found=false;const start=Date.now();
    while(Date.now()-start<8000){const request=db.transaction("contents").objectStore("contents").get(key);const row=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});if(row&&new TextDecoder().decode(row.content)==="committed"){found=true;break}await new Promise(r=>setTimeout(r,20))}
    db.close();return found;
  `);
  assert(committed, "Write did not commit before Stop");
  await call("click", "#stop"); const stopped = await result();
  assert(stopped.all.includes("read back"), `Stop did not classify possible writes: ${JSON.stringify(stopped)}`);
  assert(await evaluate('return document.querySelectorAll("iframe[data-shell-owner]").length===0'), "Stop did not revoke Worker");
  const after = await run("cat ~/before-stop; test ! -e ~/after-stop");
  assert(after.stdout === "committed" && after.exitCode === 0, "Stop lost committed content or accepted a late write");
  check("opaque iframe/Worker/CSP, Stop revokes execution and preserves only committed writes");
  await start("while true; do sleep 0.01; done");
  await evaluate('const start=Date.now();while(!document.querySelector(\'iframe[data-shell-isolation="opaque-worker"]\')&&Date.now()-start<5000)await new Promise(r=>setTimeout(r,30));return true');
  await new Promise(resolve => setTimeout(resolve, 100)); await call("click", "#stop");
  assert((await result()).all.includes("cancelled"), "Infinite loop could not be stopped"); check("Stop terminates infinite loops");
  const large = await run("printf %200000s x");
  assert(large.exitCode !== 0 && /limit|exceeded/i.test(large.stderr), "Output limit did not apply");
  for (const script of ["node -e '1'", "python3 -c '1'", "curl https://example.com", "gzip file"]) assert((await run(script)).exitCode !== 0, `Unexpected runtime command: ${script}`);
  check("output limits and disabled Node/Python/network/codecs");
  await call("click", "#mode-toggle");
  assert(await evaluate('return document.querySelector("#pane-type").textContent==="AI agent"'), "AI mode UI did not switch");
  await call("click", "#mode-toggle"); await ready();
  check("shell/AI switching is an app action");
  await call("set", "viewport", "390", "700"); await call("snapshot");
  assert((await run("printf mobile")).stdout === "mobile", "Mobile shell input failed");
  await call("screenshot", "test-results/shell-runtime-mobile.png");
  assert(await evaluate('return document.documentElement.scrollWidth<=window.innerWidth'), "Mobile UI overflows horizontally");
  check("mobile input, result display and layout");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true }); await writeFile("test-results/shell-runtime-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await call("close");
}
