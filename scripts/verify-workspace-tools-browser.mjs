import { mkdir, writeFile } from "node:fs/promises";
import { browser, workspaceToolFixture, workspaceToolScript, humanPreviewScript, writeFiles } from "./browser-fixture.mjs";

const ui = browser(`agr-workspace-tools-${process.pid}`);
const fixture = await workspaceToolFixture();
const workspaceId = `workspace-tools-${Date.now()}`;
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/");
url.searchParams.set("workspace", workspaceId);
const report = { url: url.href, provider: "local HTTP/SSE fixture", checks: [], status: "running" };
const assert = (value, message) => { if (!value) throw new Error(message); };
const check = name => { report.checks.push(name); console.log(name); };
const runTool = (name, args = {}) => ui.evaluate(`return ${workspaceToolScript(fixture.baseUrl, name, args)}`);
const layout = async () => (await ui.durable(workspaceId)).records.find(row => row.id === "layout").value.snapshot;
const shell = async script => {
  await ui.evaluate('if(document.querySelector("#mode-toggle").getAttribute("aria-checked")==="true")document.querySelector("#mode-toggle").click();return true');
  await ui.wait('document.querySelector("#mode-toggle").getAttribute("aria-checked")==="false"');
  await ui.send(script);
  assert(await ui.evaluate('return document.querySelector("#run-status").textContent!=="error"'), `Shell failed: ${script}`);
};
try {
  await mkdir("test-results", { recursive: true });
  await ui.call("open", url.href); await ui.ready(); await ui.call("snapshot");
  const initialFiles = (await ui.durable(workspaceId)).files.map(({ path, kind, mode, content }) => ({ path, kind, mode, ...(kind === "file" ? { content } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
  assert(await ui.evaluate('return !document.querySelector("#history-toggle,#conversation-history,.workspace-menu,#new-conversation,#route-tab,#route-dialog,.pane-tools")&&document.querySelectorAll(".pane-header-actions > #mode-toggle").length===1'), "Removed UI still present");
  const initial = (await layout()).tabs[0].session.sessionId;
  await ui.call("screenshot", "test-results/workspace-tools-desktop.png");
  await ui.call("set", "viewport", "390", "844");
  assert(await ui.evaluate('return document.documentElement.scrollWidth<=innerWidth'), "Mobile layout overflows");
  await ui.call("screenshot", "test-results/workspace-tools-mobile.png");
  await ui.call("set", "viewport", "1280", "900");
  check("desktop/mobile place the session mode toggle in the header without route controls");

  await shell("mkdir -p ~/Project; cd /tmp");
  await shell(writeFiles([{ path: "~/Project/Mixed.html", content: "<h1>Shared VFS preview</h1>" }, { path: "~/home.txt", content: "home-file" }]));
  await runTool("help", { command: "bash" });
  assert(JSON.stringify(fixture.requests.at(-1).messages).includes("Commands:"), "Shell guide did not reach the model");
  const exposed = fixture.requests.at(-1).tools.map(tool => tool.function.name);
  assert(exposed.length === 11 && exposed.includes("reset_workspace") && !["shell_guide", "home", "ls", "find", "grep", "open_preview"].some(name => exposed.includes(name)), "Default tool catalog is incorrect");
  await runTool("bash", { script: "cd ~/Project" });
  await runTool("bash", { script: "cd ~" });
  await runTool("read", { path: "home.txt" });
  assert(JSON.stringify(fixture.requests.at(-1).messages.at(-1)).includes("home-file"), "Home cwd did not apply to the next file tool");
  const home = (await layout()).tabs[0];
  assert(home.agentCwd === "/home/user" && home.cwd === "/tmp" && home.session.sessionId === initial, "Home changed the human cwd or session identity");
  check("help and Bash cd replace redundant guide/home tools; AI/Shell cwd remain independent");

  await runTool("install_joke_demo");
  await shell(writeFiles([{ path: "~/jokes/笑話1.md", content: "personal joke" }]));
  await runTool("install_joke_demo");
  let state = await ui.durable(workspaceId);
  assert(state.files.find(file => file.path === "/home/user/jokes/笑話1.md").content === "personal joke", "Demo overwrote a user file");
  assert(state.files.find(file => file.path === "/home/user/agents.md").content.includes("請回覆繁體中文"), "Demo replaced workspace rules");
  check("demo installs from serialized production bin JS and preserves existing files");

  await shell(writeFiles([
    { path: "~/bin/probe.js", content: 'async function main() { return { value: "custom-tool-value" }; }' },
    { path: "~/bin/manifests/probe.tool.json", content: JSON.stringify({ version: 1, name: "probe", description: "Browser fixture tool", parameters: { type: "object", properties: {}, additionalProperties: false }, capabilities: [] }) }
  ]));
  await runTool("reload_tools");
  await runTool("probe");
  assert(JSON.stringify(fixture.requests.at(-1).messages.at(-1)).includes("custom-tool-value"), "Reload did not expose the new tool");
  check("reload_tools exposes a newly created VFS bin tool on the next run");

  await runTool("bash", { script: "cd ~/Project" });
  await ui.evaluate(`return ${humanPreviewScript("~/Project/Mixed.html")}`);
  await ui.wait('document.querySelector(".preview-surface > iframe")?.srcdoc.includes("Shared VFS preview")');
  let saved = await layout();
  assert(saved.tabs.find(tab => tab.mode === "preview").preview.entry === "/home/user/Project/Mixed.html", "Preview ignored the source agent cwd/path case");
  assert(saved.tabs.find(tab => tab.id === "main").session.sessionId === initial, "Preview replaced the source session");
  await ui.evaluate('document.querySelector("#tab-list .tab").click();return true');
  await ui.evaluate(`return ${humanPreviewScript("~/Project/Mixed.html")}`);
  assert((await layout()).tabs.filter(tab => tab.mode === "preview").length === 1, "Preview duplicated the existing tab");
  check("human Preview opens the selected file and reuses the existing preview tab");

  await ui.evaluate('document.querySelector("#tab-list .tab").click();document.querySelector("#add-tab").click();return true');
  const before = await layout();
  assert(before.tabs[0].session.sessionId !== before.tabs.at(-1).session.sessionId, "Tabs share a session");
  await ui.call("reload"); await ui.ready();
  const after = await layout();
  assert(JSON.stringify(after.tabs.map(tab => tab.session.sessionId)) === JSON.stringify(before.tabs.map(tab => tab.session.sessionId)), "Reload lost tab identities");
  assert(await ui.evaluate('return !document.querySelector("#history-toggle,.workspace-menu")'), "Reload restored removed controls");
  check("new tabs have independent sessions and reload preserves all open tab identities");

  await ui.evaluate('document.querySelector("#tab-list .tab").click();return true');
  await runTool("bash", { script: "cd ~/Project" });
  await runTool("skill_load", { name: "joke-master" });
  const beforeReset = await layout();
  assert(beforeReset.tabs[0].session.activeSkill === "joke-master", "Active skill fixture was not saved");
  assert(JSON.stringify(beforeReset.tabs[0].session.messages).includes("custom-tool-value"), "Conversation fixture result was not saved before reset");
  await runTool("reset_workspace");
  const resetState = await ui.durable(workspaceId);
  const restoredFiles = resetState.files.map(({ path, kind, mode, content }) => ({ path, kind, mode, ...(kind === "file" ? { content } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
  assert(JSON.stringify(restoredFiles) === JSON.stringify(initialFiles), "Reset did not restore the exact initial workspace");
  const resetLayout = await layout();
  assert(JSON.stringify(resetLayout.tabs.map(tab => tab.session.sessionId)) === JSON.stringify(beforeReset.tabs.map(tab => tab.session.sessionId)), "Reset replaced sessions or tabs");
  assert(resetLayout.tabs[0].agentCwd === "/home/user", "Reset did not return the calling agent home");
  await runTool("help");
  const restoredTools = fixture.requests.at(-1).tools.map(tool => tool.function.name);
  assert(restoredTools.length === 11 && !restoredTools.includes("probe"), "Reset did not reload the default tool catalog");
  assert(!(await layout()).tabs[0].session.activeSkill, "Reset left the next run stuck on a deleted active skill");
  assert(beforeReset.tabs.every(tab => {
    const restored = resetLayout.tabs.find(candidate => candidate.id === tab.id);
    return JSON.stringify(restored.session.messages.slice(0, tab.session.messages.length)) === JSON.stringify(tab.session.messages);
  }), "Reset lost conversation history");
  await ui.call("reload"); await ui.ready();
  const persisted = (await ui.durable(workspaceId)).files.map(({ path, kind, mode, content }) => ({ path, kind, mode, ...(kind === "file" ? { content } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
  assert(JSON.stringify(persisted) === JSON.stringify(initialFiles), "Reload changed the restored initial workspace");
  check("reset_workspace restores the exact initial VFS, reloads tools and preserves sessions/history across reload");
  assert(!fixture.failures.length, fixture.failures.join("; "));
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; }
finally {
  await writeFile("test-results/workspace-tools-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await ui.call("close").catch(() => {}); await fixture.close();
}
