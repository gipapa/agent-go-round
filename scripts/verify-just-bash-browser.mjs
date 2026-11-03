// P0: real browser, built Worker and native IndexedDB. No provider credentials.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
const cli = process.env.AGENT_BROWSER_CLI || "agent-browser";
const command = cli.endsWith(".js") ? [process.execPath, cli] : [cli];
const exec = promisify(execFile), session = "agr-just-bash-p0";
const call = async (...args) => (await exec(command[0], [...command.slice(1), "--session", session, ...args], { maxBuffer: 5_000_000 })).stdout.trim();
const evaluate = async code => JSON.parse(await call("eval", `(async()=>{${code}})()`));
const run = options => evaluate(`return window.justBashProbe.run(${JSON.stringify(options)})`);
const assert = (value, message) => { if (!value) throw new Error(message); };
const url = new URL("poc/just-bash.html", process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/");
url.searchParams.set("workspace", `bash-p0-${Date.now()}`);
const report = { url: url.href, version: "3.6.0", status: "running", checks: [] };
const check = name => report.checks.push({ name, status: "pass" });
const representative = `mkdir -p ~/docs && cd ~/docs
printf 'hello\\n世界\\n' > notes.txt
cat notes.txt | grep hello > matches.txt
printf 'more\\n' >> notes.txt
cat *.txt | wc -l
test -f matches.txt && echo ok
cat <<'EOF' > literal.txt
$HOME is literal here
EOF
for f in *.txt; do echo "$f"; done`;
try {
  await call("open", url.href); await call("snapshot");
  for (const storage of ["memory", "indexeddb"]) {
    const result = await run({ script: representative, storage });
    assert(result.exitCode === 0 && result.stderr === "", `${storage}: ${JSON.stringify(result)}`);
    assert(result.stdout === "4\nok\nliteral.txt\nmatches.txt\nnotes.txt\n", `${storage}: representative output mismatch: ${result.stdout}`);
    assert(result.env.PWD === "/home/user/docs" && result.initialCwd === "/home/user", "Final cwd must come from result.env.PWD");
    if (storage === "indexeddb") report.fsMethods = [...new Set(result.calls)];
    check(`${storage}: quotes, Unicode, pipes, redirect, append, glob, heredoc, conditions, loops and final cwd`);
  }
  const next = await run({ script: "cat literal.txt; printf '%s' \"$HOME\"", cwd: "/home/user/docs", storage: "indexeddb" });
  assert(next.stdout === "$HOME is literal here\n/home/user", "Literal heredoc or explicit HOME failed");
  await call("reload");
  const reloaded = await run({ script: "cat ~/docs/notes.txt", storage: "indexeddb" });
  assert(reloaded.stdout === "hello\n世界\nmore\n", "Native IndexedDB reload did not preserve UTF-8 contents");
  check("native IndexedDB reload retains create/read/append results");
  const files = await run({ storage: "indexeddb", script: `
printf AP+A | base64 -d > ~/shell-binary
cp ~/shell-binary ~/copy-binary
mv ~/copy-binary ~/moved-binary
chmod 600 ~/moved-binary
touch -d 2020-01-02 ~/moved-binary
ln -s /home/user/moved-binary ~/binary-link
base64 ~/binary-link
ln -s /home/user /bin/workspace
mkdir -p /bin/workspace/cross-mount
printf cross > /bin/workspace/cross-mount/file
cat ~/cross-mount/file
ln -s /bin/cat ~/system-link
test -f ~/system-link && echo stub
ln -s cycle-b ~/cycle-a
ln -s cycle-a ~/cycle-b
if cat ~/cycle-a 2>/dev/null; then exit 9; fi
test ! -e ~/missing` });
  assert(files.exitCode === 0 && files.stderr === "" && files.stdout === "AP+A\ncrossstub\n", `Adapter integration failed: ${JSON.stringify({ stdout: files.stdout, stderr: files.stderr, exitCode: files.exitCode })}`);
  const metadata = await evaluate('return window.justBashProbe.bytes.stat("~/moved-binary")');
  assert(metadata.mode === 0o600 && metadata.mtime === Date.parse("2020-01-02T00:00:00Z"), "Native mode/mtime was not persisted");
  check("formal adapter: binary, copy/move, chmod/touch, absolute links, loops and cross-mount links");
  const steps = await run({ script: "while true; do :; done", steps: 30 });
  assert(steps.exitCode !== 0 && /limit|iterations|exceeded/i.test(steps.stderr), "Step limit did not terminate loop"); check("step limit");
  const output = await run({ script: "yes output", outputLimit: 1024 });
  assert(new TextEncoder().encode(output.stdout).byteLength <= 1024, "yes exceeded the output budget");
  const aggregate = await run({ script: "for i in {1..300}; do echo output; done", outputLimit: 1024 });
  assert(aggregate.exitCode !== 0 && /limit|exceeded/i.test(aggregate.stderr), "Aggregate output limit did not terminate loop"); check("bounded yes output and aggregate output limit");
  const deadline = await run({ script: "sleep 10", timeoutMs: 80 });
  assert(deadline.exitCode !== 0 && /time|limit|exceeded/i.test(deadline.stderr), "Wall time limit did not terminate sleep"); check("execution deadline");
  const cancelled = await evaluate(`
    const result = window.justBashProbe.run({script:"printf committed > ~/before-stop; sleep 10; printf late > ~/after-stop",storage:"indexeddb",timeoutMs:5000}).then(()=>"unexpected",error=>error.message);
    const start=Date.now();
    while(Date.now()-start<4000){try{if(await window.justBashProbe.read("~/before-stop")==="committed")break}catch{}await new Promise(r=>setTimeout(r,20))}
    window.justBashProbe.stop(); return result;
  `);
  assert(cancelled.includes("cancelled"), "Stop did not terminate Worker");
  const after = await run({ script: "cat ~/before-stop; test ! -e ~/after-stop", storage: "indexeddb" });
  assert(after.stdout === "committed" && after.exitCode === 0, "Cancellation lost committed write or accepted late writes"); check("Stop preserves committed writes and prevents subsequent writes");
  report.unsupported = {};
  for (const script of ["printf a | gzip", "curl https://example.com", "node -e '1'", "python3 -c '1'"]) {
    const result = await run({ script });
    assert(result.exitCode !== 0, `Unexpectedly supported: ${script}`);
    report.unsupported[script] = { exitCode: result.exitCode, stderr: result.stderr };
  }
  check("browser codec, network and arbitrary runtime commands fail explicitly");
  const embedded = await evaluate(`
    const frame=document.createElement("iframe");frame.src=${JSON.stringify(url.href)};document.body.append(frame);
    await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject});
    const start=Date.now();while(!frame.contentWindow.justBashProbe&&Date.now()-start<5000)await new Promise(r=>setTimeout(r,30));
    const result=await frame.contentWindow.justBashProbe.run({script:"cat ~/before-stop",storage:"indexeddb"});
    window.__storageFrame=frame;return result;
  `);
  assert(embedded.stdout === "committed", "Embedded Worker cannot read shared native IndexedDB"); check("embedded frame loads Worker and shares workspace storage");
  const native = await evaluate(`
    const a=window.justBashProbe.bytes,b=window.__storageFrame.contentWindow.justBashProbe.bytes;
    const original=Array.from({length:256},(_,i)=>i);await a.write("~/binary",original);
    const binary=await b.read("~/binary");
    await Promise.all(Array.from({length:80},(_,i)=>(i%2?a:b).append("~/parallel-log",Array.from(new TextEncoder().encode(i+"\\n")))));
    const log=new TextDecoder().decode(new Uint8Array(await a.read("~/parallel-log")));
    const exclusive=await Promise.allSettled([a.exclusive("~/exclusive"),b.exclusive("~/exclusive")]);
    return {binary,lines:log.trim().split("\\n"),stat:await b.stat("~/parallel-log"),exclusive:exclusive.map(r=>r.status)};
  `);
  assert(native.binary.every((value, index) => value === index) && native.binary.length === 256, "Native byte round trip failed");
  assert(new Set(native.lines).size === 80 && native.stat.revision === 80, "Independent browser surfaces lost concurrent appends");
  assert(native.exclusive.filter(status => status === "fulfilled").length === 1, "Native exclusive create raced");
  check("native IndexedDB binary bytes, 80 concurrent surface appends and exclusive creation");
  await call("reload");
  const restored = await evaluate('return {binary:await window.justBashProbe.bytes.read("~/binary"),stat:await window.justBashProbe.bytes.stat("~/parallel-log")}');
  assert(restored.binary.length === 256 && restored.binary[255] === 255 && restored.stat.revision === 80, "Native byte storage lost data after reload");
  check("native byte storage persists across reload");
  const quota = await evaluate('return window.justBashProbe.bytes.verifyQuota()');
  assert(quota.quota && quota.rolledBack, "Native quota transaction partially committed");
  check("native IndexedDB quota failure rolls back the entire byte batch");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; }
finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/just-bash-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); await call("close");
}
