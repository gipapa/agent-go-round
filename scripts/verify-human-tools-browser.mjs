import { mkdir, writeFile } from "node:fs/promises";
import { assert, browser, humanPreviewScript, writeFiles } from "./browser-fixture.mjs";
const ui = browser(`agr-human-tools-${process.pid}`), workspace = `human-tools-${Date.now()}`;
const url = new URL(process.env.AGENT_GO_ROUND_APP_URL || "http://127.0.0.1:4173/"); url.searchParams.set("workspace", workspace);
const html = '<!doctype html><html lang="zh-Hant"><body><h1>人類編輯 $HOME `literal`</h1></body></html>';
const report = { url: url.href, provider: "none: human UI only", status: "running", checks: [] };
const check = name => { report.checks.push(name); console.log(name); };
const saved = async (path = "/home/user/main.html") => (await ui.durable(workspace)).files.find(file => file.path === path);
const change = async text => { await ui.call("fill", "#editor-content", text); };
const save = async () => { await ui.call("click", "#editor-save"); await ui.wait("document.querySelector('#editor-status').textContent.includes('已儲存')"); };
const openEditor = async () => { await ui.call("click", "#human-edit"); await ui.wait("document.querySelector('.file-editor')?.hidden===false&&!document.querySelector('#editor-content').disabled"); };
const clickText = (scope, text) => ui.evaluate(`[...document.querySelectorAll(${JSON.stringify(scope)})].find(node=>node.textContent===${JSON.stringify(text)}).click();return true`);
const activeSurface = ".preview-surface:not([hidden])";
const launcherClearOfStatusBar = `const launcher=document.querySelector('${activeSurface} > div:last-child').shadowRoot.querySelector('.launcher').getBoundingClientRect(),footer=document.querySelector('.terminal-footer').getBoundingClientRect();return launcher.bottom<=footer.top`;
try {
  await mkdir("test-results", { recursive: true }); await ui.call("open", url.href); await ui.ready(); await ui.call("snapshot");
  const controls = "return ['human-preview','human-edit','sidebar-provider-toggle'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,width:r.width,height:r.height}})";
  let positions = await ui.evaluate(controls);
  assert(positions.every(p => p.width > 0 && p.x >= 0) && positions[0].y < positions[1].y && positions[1].y < positions[2].y, "Human buttons are not above the lower-left gear on desktop");
  await openEditor(); await change(html); await save();
  assert((await saved()).content === html, "Editor did not save literal HTML");
  await ui.call("screenshot", "test-results/human-editor-desktop.png");
  check("desktop buttons sit above settings and save literal UTF-8 HTML without a model");

  await change("Unsaved human draft"); await ui.call("click", "#editor-close");
  await ui.wait("document.querySelector('#human-edit').classList.contains('has-draft')");
  await ui.durable(workspace); await ui.call("reload"); await ui.ready();
  await ui.wait("document.querySelector('#human-edit').classList.contains('has-draft')");
  check("the Edit button marks an unsaved draft, including one restored by a reload");
  await openEditor();
  assert(await ui.evaluate("return document.querySelector('#editor-content').value==='Unsaved human draft'&&document.querySelector('#editor-badge').textContent==='未儲存'"), "Reload lost the unsaved draft");
  assert((await saved()).content === html, "Draft backup silently wrote to the actual file");
  await ui.call("click", "#editor-close"); await ui.call("click", "#mode-toggle"); await ui.ready();
  await ui.send(`mkdir -p /home/user/docs; ${writeFiles([{ path: "~/main.html", content: "Other writer" }, { path: "~/docs/guide.html", content: "<h1>Guide page</h1>\n" }])}`);
  await openEditor();
  await ui.wait("document.querySelector('#editor-banner').hidden===false");
  assert(await ui.evaluate("return document.querySelector('#editor-content').value==='Unsaved human draft'"), "Conflict warning replaced the draft");
  await ui.call("screenshot", "test-results/human-editor-conflict.png");
  await ui.call("click", "#editor-save");
  await ui.wait("document.querySelector('#editor-status').textContent.includes('未覆寫')");
  assert((await saved()).content === "Other writer" && await ui.evaluate("return document.querySelector('#editor-content').value==='Unsaved human draft'"), "Revision conflict lost another writer or the human draft");
  check("reload restores drafts; a concurrent write is flagged on open, blocks save and keeps both versions intact");

  await ui.call("click", "#editor-reload");
  assert(await ui.evaluate("return document.querySelector('#editor-content').value==='Unsaved human draft'"), "Discard must ask before replacing the draft");
  await ui.call("click", '#editor-banner [data-action="discard"]');
  await ui.wait("document.querySelector('#editor-content').value==='Other writer'");
  check("discarding a draft takes an explicit confirmation");

  await change(html); await clickText(".editor-file", "agents.md");
  await ui.wait("document.querySelector('#editor-banner').hidden===false&&document.activeElement===document.querySelector('#editor-banner [data-action=\"save\"]')");
  await ui.call("screenshot", "test-results/human-editor-unsaved-prompt.png");
  await ui.call("click", '#editor-banner [data-action="save"]');
  await ui.wait("document.querySelector('#editor-current').textContent==='~/agents.md'");
  assert((await saved()).content === html, "Save and open did not save the previous file first");
  check("opening another file over unsaved changes offers to save first");

  await clickText(".editor-file", "docs/");
  await ui.wait("[...document.querySelectorAll('.editor-file')].some(node=>node.textContent==='guide.html')");
  await clickText(".editor-file", "guide.html");
  await ui.wait("document.querySelector('#editor-current').textContent==='~/docs/guide.html'");
  assert(await ui.evaluate("return document.querySelector('.editor-file[aria-current=\"true\"]').textContent==='guide.html'&&document.querySelector('#editor-directory').textContent==='~/docs'"), "Open file or folder is not indicated");
  assert(await ui.evaluate("const gutter=document.querySelector('#editor-gutter-lines'),text=document.querySelector('#editor-content'),a=getComputedStyle(gutter),b=getComputedStyle(text);return gutter.textContent==='1\\n2'&&a.lineHeight===b.lineHeight&&a.fontSize===b.fontSize&&gutter.getBoundingClientRect().top===text.getBoundingClientRect().top+parseFloat(b.paddingTop)"), "Line numbers are not aligned with the text");
  await ui.call("focus", "#editor-content");
  await ui.call("press", "Tab");
  assert(await ui.evaluate("const text=document.querySelector('#editor-content');return text===document.activeElement&&text.value==='  <h1>Guide page</h1>\\n'"), "Tab did not indent in place");
  assert(await ui.evaluate("const text=document.querySelector('#editor-content');document.execCommand('undo');const undone=text.value==='<h1>Guide page</h1>\\n';document.execCommand('redo');return undone"), "Indentation is missing from the undo history");
  await ui.call("press", "Control+s");
  await ui.wait("document.querySelector('#editor-status').textContent.includes('已儲存')");
  assert(await ui.evaluate("return document.activeElement===document.querySelector('#editor-content')"), "Keyboard save dropped focus from the text");
  await ui.call("press", "F6");
  assert(await ui.evaluate("return document.activeElement===document.querySelector('#editor-wrap')"), "F6 did not leave the text area");
  await change("  <h1>Guide page</h1>\n<!-- saved with the mouse -->\n");
  await ui.call("click", "#editor-save");
  await ui.wait("document.querySelector('#editor-status').textContent.includes('已儲存')&&document.activeElement===document.querySelector('#editor-content')");
  await ui.call("press", "Escape");
  await ui.wait("document.querySelector('.file-editor').hidden");
  await ui.call("click", "#human-edit");
  await ui.wait("document.querySelector('.file-editor').hidden===false&&document.activeElement===document.querySelector('#editor-content')");
  check("the editor shows the open file, numbers lines, indents with Tab and keeps focus through Ctrl+S and a mouse save");

  await change("<h1>Saved from editor</h1>");
  await ui.call("click", "#editor-preview");
  await ui.wait(`document.querySelector('${activeSurface} > iframe')?.srcdoc.includes('Saved from editor')&&document.querySelector('.file-editor').hidden`);
  assert((await saved("/home/user/docs/guide.html")).content === "<h1>Saved from editor</h1>", "Save and preview did not save");
  await ui.call("screenshot", "test-results/human-preview-desktop.png");
  assert(await ui.evaluate("return getComputedStyle(document.querySelector('.pane-header')).display==='none'&&document.querySelector('.pane').classList.contains('previewing')"), "Preview stacks a second header");
  assert(await ui.evaluate(launcherClearOfStatusBar), "AI launcher overlaps the status bar");
  check("Save and preview opens the saved page; preview has one header and the launcher clears the status bar");

  await clickText(`${activeSurface} .preview-toolbar button`, "編輯");
  await ui.wait("document.querySelector('.file-editor').hidden===false&&document.querySelector('#editor-current').textContent==='~/docs/guide.html'");
  await ui.call("click", "#editor-close");
  await clickText(`${activeSurface} .preview-devices button`, "手機");
  assert(await ui.evaluate(`return Math.round(document.querySelector('${activeSurface} > iframe').getBoundingClientRect().width)===390`), "Phone width was not applied");
  await ui.call("screenshot", "test-results/human-preview-phone-width.png");
  await clickText(`${activeSurface} .preview-devices button`, "桌面");
  check("preview opens its page in the editor and previews at phone width");

  await ui.evaluate(`return ${humanPreviewScript("~/main.html")}`);
  await ui.wait(`document.querySelector('${activeSurface} > iframe')?.srcdoc.includes('人類編輯')`);
  assert((await ui.durable(workspace)).records.filter(row => row.id.startsWith("session:")).every(row => row.value.tab.session.messages.length === 0), "Human actions invoked an AI conversation");
  check("human Preview renders the saved file without AI calls");

  await ui.call("click", "#human-preview");
  await ui.wait("document.querySelectorAll('.human-preview-option').length===2");
  assert(await ui.evaluate("return document.querySelector('.human-preview-option[aria-selected=\"true\"]').title==='~/docs/guide.html'&&document.activeElement===document.querySelector('#human-preview-path')"), "Picker did not suggest the page open in the editor");
  await ui.call("screenshot", "test-results/human-preview-picker.png");
  await ui.call("fill", "#human-preview-path", "guide");
  await ui.wait("document.querySelectorAll('.human-preview-option').length===1");
  await ui.call("press", "ArrowDown");
  assert(await ui.evaluate("return document.querySelector('#human-preview-path').value==='~/docs/guide.html'"), "Arrow keys did not choose a result");
  await ui.call("press", "Enter");
  await ui.wait(`document.querySelector('#human-preview-dialog').hidden&&document.querySelector('${activeSurface} > iframe')?.srcdoc.includes('Saved from editor')`);
  assert(await ui.evaluate("return document.querySelectorAll('#tab-list .tab').length===3"), "Reopening a page duplicated its tab");
  check("the picker lists pages, filters them, and opens by keyboard without duplicating tabs");

  await ui.call("click", "#human-preview");
  await ui.call("fill", "#human-preview-path", "~/missing-page.html");
  await ui.call("press", "Enter");
  await ui.wait(`document.querySelector('${activeSurface}')?.dataset.state==='missing'`);
  assert(await ui.evaluate(`const s=document.querySelector('${activeSurface}');return s.querySelector('iframe').hidden&&!s.querySelector('.preview-message').hidden&&s.querySelector('.preview-message').textContent.includes('~/missing-page.html')`), "Missing page did not explain itself");
  await ui.call("screenshot", "test-results/human-preview-missing.png");
  await clickText(`${activeSurface} button`, "建立主頁範本");
  await ui.wait(`document.querySelector('${activeSurface} > iframe').srcdoc.includes('我的 Pi 主頁')&&!document.querySelector('${activeSurface} > iframe').hidden`);
  check("a missing page explains itself instead of showing a blank frame, and creates the template on request");

  await ui.evaluate("document.querySelector('#tab-list .tab').click();return true");
  await ui.send(writeFiles([{ path: "~/missing-page.html", content: "<h1>Changed in the shell</h1>" }]));
  await ui.evaluate("[...document.querySelectorAll('#tab-list .tab')].at(-1).click();return true");
  await ui.wait(`document.querySelector('${activeSurface}').dataset.state==='stale'`);
  assert(await ui.evaluate(`const s=document.querySelector('${activeSurface}');return s.querySelector('.preview-status').textContent.includes('檔案有更新')&&s.querySelector('iframe').srcdoc.includes('我的 Pi 主頁')&&[...s.querySelectorAll('.preview-toolbar button')].find(b=>b.textContent==='重新載入預覽').classList.contains('primary')`), "Outside change is not flagged or was applied without asking");
  await ui.call("screenshot", "test-results/human-preview-stale.png");
  await clickText(`${activeSurface} .preview-toolbar button`, "重新載入預覽");
  await ui.wait(`document.querySelector('${activeSurface} > iframe').srcdoc.includes('Changed in the shell')`);
  await ui.evaluate("document.querySelector('#tab-list .tab').click();return true");
  await ui.send(writeFiles([{ path: "~/missing-page.html", content: '<link rel="stylesheet" href="absent.css"><h1>Broken</h1>' }]));
  await ui.evaluate("[...document.querySelectorAll('#tab-list .tab')].at(-1).click();return true");
  await ui.wait(`document.querySelector('${activeSurface}').dataset.state==='stale'`);
  await clickText(`${activeSurface} .preview-toolbar button`, "重新載入預覽");
  await ui.wait(`document.querySelector('${activeSurface}').dataset.state==='error'`);
  await new Promise(resolve => setTimeout(resolve, 2500)); // Outlast the change poll, which must not clear the notice.
  assert(await ui.evaluate(`const s=document.querySelector('${activeSurface}'),m=s.querySelector('.preview-message');return !s.querySelector('iframe').hidden&&s.querySelector('iframe').srcdoc.includes('Changed in the shell')&&m.textContent.includes('absent.css')&&m.getBoundingClientRect().height<120&&s.querySelector('iframe').getBoundingClientRect().height>200`), "A failed reload did not keep the last good page under a compact notice");
  await ui.call("screenshot", "test-results/human-preview-error.png");
  check("outside changes are flagged and applied on request; a failed reload keeps the last good page");

  await ui.call("set", "viewport", "390", "844");
  await ui.call("reload"); await ui.ready();
  positions = await ui.evaluate(controls);
  assert(positions[0].y < positions[1].y && positions[1].y < positions[2].y && positions[2].y + positions[2].height <= 844, "Mobile tools moved below/outside settings");
  await ui.wait(`document.querySelector('${activeSurface}')?.dataset.hasContent==='true'||document.querySelector('${activeSurface}')?.dataset.state==='error'`);
  assert(await ui.evaluate(`const bar=document.querySelector('${activeSurface} .preview-toolbar').getBoundingClientRect(),buttons=[...document.querySelectorAll('${activeSurface} .preview-actions .tool-button')].filter(b=>b.getClientRects().length).map(b=>b.getBoundingClientRect());return document.documentElement.scrollWidth<=innerWidth&&buttons.length===3&&buttons.every(b=>b.right<=bar.right&&b.height>=40&&b.width>=40)&&bar.height<=64`), "Mobile preview toolbar overflows, wraps or has small targets");
  assert(await ui.evaluate(launcherClearOfStatusBar), "AI launcher overlaps the mobile status bar");
  await ui.call("screenshot", "test-results/human-preview-mobile.png");
  check("mobile preview toolbar stays on one row with touch-sized controls");

  await ui.call("click", "#human-preview");
  await ui.wait("document.querySelectorAll('.human-preview-option').length>=2");
  assert(await ui.evaluate("const panel=document.querySelector('.human-preview-panel').getBoundingClientRect(),row=document.querySelector('.human-preview-option').getBoundingClientRect();return document.activeElement!==document.querySelector('#human-preview-path')&&panel.height===innerHeight&&row.height>=44&&getComputedStyle(document.querySelector('#human-preview-path')).fontSize==='16px'"), "Mobile picker raised the keyboard, or has small targets or undersized text");
  await ui.call("screenshot", "test-results/human-preview-picker-mobile.png");
  await ui.call("click", "#human-preview-close");
  check("mobile picker fills the screen without raising the keyboard over the list");

  await ui.evaluate("document.querySelector('#human-edit').click();return true");
  await ui.wait("document.querySelector('.file-editor')?.hidden===false&&!document.querySelector('#editor-content').disabled");
  assert(await ui.evaluate("const text=document.querySelector('#editor-content');return document.documentElement.scrollWidth<=innerWidth&&getComputedStyle(text).fontSize==='16px'&&getComputedStyle(document.querySelector('.editor-browser')).display==='none'&&document.activeElement!==text&&text.wrap==='soft'&&getComputedStyle(document.querySelector('.editor-gutter')).display==='none'&&!document.querySelector('#editor-save').textContent.includes('S')"), "Mobile editor overflow, undersized text, or keyboard raised on open");
  await ui.call("screenshot", "test-results/human-editor-mobile.png");
  await ui.call("click", "#editor-toggle-files");
  assert(await ui.evaluate("const list=document.querySelector('.editor-browser').getBoundingClientRect(),row=document.querySelector('.editor-file').getBoundingClientRect();return list.width===innerWidth&&row.height>=44"), "Mobile file list does not fill the editor with touch-sized rows");
  await ui.call("click", "#editor-up");
  await ui.wait("[...document.querySelectorAll('.editor-file')].some(node=>node.textContent==='agents.md')");
  await ui.call("screenshot", "test-results/human-editor-mobile-files.png");
  await clickText(".editor-file", "agents.md");
  await ui.wait("document.querySelector('#editor-current').textContent==='~/agents.md'&&getComputedStyle(document.querySelector('.editor-browser')).display==='none'");
  await ui.call("click", "#editor-close");
  check("mobile editor keeps the file list out of the way until asked, without horizontal overflow");

  await openEditor();
  await ui.evaluate("window.__editorViewport=Object.assign(new EventTarget(),{width:390,height:360,offsetTop:60,offsetLeft:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__editorViewport});window.dispatchEvent(new Event('resize'));return true");
  await ui.wait("document.documentElement.classList.contains('keyboard-open')");
  assert(await ui.evaluate("const text=document.querySelector('#editor-content').getBoundingClientRect(),save=document.querySelector('#editor-save').getBoundingClientRect();return text.height>=160&&save.bottom<=420&&getComputedStyle(document.querySelector('.editor-browser')).display==='none'"), "Keyboard obscures editor content or save controls");
  await ui.call("screenshot", "test-results/human-editor-keyboard.png");
  check("editor hides the file list and keeps text and save controls visible above the keyboard");
  await ui.call("click", "#editor-toggle-files");
  assert(await ui.evaluate("const input=document.querySelector('#editor-path');input.focus();return getComputedStyle(document.querySelector('.editor-browser')).display!=='none'&&document.activeElement===input&&input.getBoundingClientRect().bottom<=420"), "Keyboard hides the path field being typed into");
  check("an open file list stays usable while the keyboard is up");
  report.status = "pass";
} catch (error) { report.status = "fail"; report.failure = error.message; process.exitCode = 1; try { await ui.call("screenshot", "test-results/human-tools-failure.png"); report.visible = await ui.evaluate("return document.body.textContent.slice(-5000)"); } catch {} }
finally { await writeFile("test-results/human-tools-browser.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure })); await ui.call("close").catch(() => {}); }
