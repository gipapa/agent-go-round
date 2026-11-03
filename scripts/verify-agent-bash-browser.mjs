import { mkdir, writeFile } from "node:fs/promises";
import { assert, browser, fixtureProvider, sequence, tool } from "./browser-fixture.mjs";
const { call, evaluate, wait, ready, send, connect, durable } = browser("agr-agent-bash");
const provider = await fixtureProvider({
  "P4 mixed": sequence([
    [tool("create", "bash", { script: "mkdir -p ~/project; cd ~/project; printf 'alpha\\nbeta\\n' > source.txt; cp source.txt copied.txt; grep alpha copied.txt | head -n 1" })],
    [tool("read", "read", { path: "source.txt" })],
    [tool("edit", "edit", { path: "source.txt", oldText: "beta", newText: "gamma" })],
    [tool("subtree", "bash", { script: "cp -r ~/project /tmp/copy; mv /tmp/copy /tmp/moved; grep gamma /tmp/moved/source.txt; cd /tmp" })],
    [tool("write", "write", { path: "from-json.txt", content: "structured" })],
    [tool("reverse", "bash", { script: "cat from-json.txt; cat ~/project/source.txt; head -n 1 ~/skills/probe/references/rule.txt" })],
    [tool("skill", "skill_load", { name: "probe" })],
    [tool("reference", "read", { path: "~/skills/probe/references/rule.txt" })],
    [tool("help", "help", { command: "bash" })], "P4 verified"
  ]),
  "P4 stop": sequence([[tool("cancelled", "bash", { script: "printf once >> ~/once; sleep 30; printf late > ~/late" })]]),
  "P4 inspect": sequence([[tool("inspect", "bash", { script: "cat ~/once; test ! -e ~/late" })], "read back verified"])
});
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"), workspace = `agent-bash-${Date.now()}`;
url.searchParams.set("workspace", workspace);
const report = { url: url.href, provider: "local deterministic HTTP/SSE fixture", status: "running", checks: [] };
const check = name => report.checks.push({ name, status: "pass" });
try {
  await mkdir("test-results", { recursive: true });
  await call("open", url.href); await ready(); await call("snapshot");
  await send("mkdir -p ~/skills/probe/references; printf '%s' '---\nname: probe\ndescription: Check referenced rules.\n---\nRead references/rule.txt.' > ~/skills/probe/SKILL.md; printf 'first rule\\nsecond rule\\n' > ~/skills/probe/references/rule.txt");
  await connect(provider.baseUrl); await call("click", "#mode-toggle");
  await send("P4 mixed: create, read, modify and search actual files");
  assert(await evaluate("return document.querySelector('#run-status').textContent==='done'"), await evaluate("return document.querySelector('#terminal').textContent.slice(-4000)"));
  let state = await durable(workspace);
  const file = path => state.files.find(file => file.path === path);
  assert(file("/home/user/project/source.txt")?.content === "alpha\ngamma\n" && file("/tmp/from-json.txt")?.content === "structured", "Bash and structured files differ");
  assert(file("/tmp/moved/source.txt")?.content === "alpha\ngamma\n", "Subtree copy/move lost contents");
  const trace = state.events.filter(event => event.type === "file_access");
  const has = (id, method, path, revision) => trace.some(event => event.toolCallId === id && event.method === method && event.path === path && event.revision === revision);
  assert(has("create", "writeBytes", "/home/user/project/source.txt", 1), "Missing committed creation revision");
  assert(has("subtree", "writeBytes", "/tmp/moved/source.txt", 2) && has("subtree", "remove", "/tmp/copy/source.txt", 1), "Missing transaction subtree revisions");
  assert(trace.filter(event => ["create", "subtree", "reverse"].includes(event.toolCallId)).every(event => !event.readRange), "Bash partial outputs were marked as complete model reads");
  assert(trace.some(event => event.toolCallId === "read" && event.path === "/home/user/project/source.txt" && event.readRange?.totalLines === 3), "Structured read lost range evidence");
  assert(trace.some(event => event.toolCallId === "reference" && event.readRange?.totalLines === 3), "Skill reference was not read");
  const delivered = provider.requests.flatMap(request => request.messages).filter(message => message.role === "tool");
  assert(delivered.some(message => message.tool_call_id === "create" && JSON.parse(message.content).stdout === "alpha\n") && delivered.some(message => message.tool_call_id === "help" && message.content.includes("maxSteps")), "Results or native help did not reach real provider request");
  check("AI uses actual Worker and shared IDB; structured tools, skills, cwd and byte/revision audit interoperate");
  await call("click", "#mode-toggle"); await send("pwd; cat /tmp/from-json.txt");
  assert(await evaluate("return [...document.querySelectorAll('[data-channel=stdout]')].at(-1).textContent.includes('/home/user\\nstructured')"), "Agent cwd leaked to human shell or human cannot read agent file");
  check("human cwd is separate and immediately reads agent writes");
  await call("click", "#mode-toggle"); await send("P4 stop after committed append", "document", false);
  await wait("Boolean(document.querySelector('iframe[data-shell-isolation=opaque-worker]'))");
  const deadline = Date.now() + 10000; let committed = false;
  while (Date.now() < deadline) { state = await durable(workspace); if (file("/home/user/once")?.content === "once") { committed = true; break; } }
  assert(committed, "Append did not commit before Stop");
  const beforeStop = provider.requests.length;
  await call("click", "#stop"); await ready();
  state = await durable(workspace);
  const stopped = state.events.filter(event => event.type === "run_finished").at(-1);
  assert(stopped?.status === "outcome_unknown", `Unexpected cancelled run: ${JSON.stringify(stopped)}`);
  assert(state.events.some(event => event.type === "file_access" && event.toolCallId === "cancelled" && event.runId === stopped.runId && event.method === "writeBytes" && event.path === "/home/user/once"), "Committed Stop write lost run ownership");
  assert(provider.requests.length === beforeStop && !file("/home/user/late"), "Stop continued model loop or late mutation");
  const sessionId = stopped.sessionId;
  await call("reload"); await ready(); await connect(provider.baseUrl);
  assert(provider.requests.length === beforeStop, "Reload/reconnect replayed an unknown mutation");
  await send("P4 inspect without replay"); state = await durable(workspace);
  assert(file("/home/user/once")?.content === "once" && !file("/home/user/late"), "Readback replayed append");
  assert(state.events.filter(event => event.type === "run_finished").at(-1)?.sessionId === sessionId, "Reload lost session");
  check("Stop preserves committed append, records original run, revokes late writes and never replays on reload/reconnect");
  await call("screenshot", "test-results/agent-bash-browser.png");
  assert(provider.failures.length === 0, provider.failures.join("; "));
  report.requestCount = provider.requests.length; report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; try { report.visible = await evaluate("return document.querySelector('#terminal')?.textContent.slice(-6000)"); } catch {} }
finally { await writeFile("test-results/agent-bash-browser.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await call("close"); await provider.close(); }
