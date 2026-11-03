// AgentGoRound modification to just-bash 3.6.0 (Apache-2.0): expose the
// execution-local cwd in the public result, including exit/limit paths.
// No application access to private engine state; no parser/command changes.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const path = new URL("../node_modules/just-bash/dist/bundle/browser.js", import.meta.url);
const digest = text => createHash("sha256").update(text).digest("hex");
const upstream = "38f1ad1e3283980ecdf68cede8a4eed028c6dff6e8c31793dec1e0af529c446e";
const marker = "/*! AgentGoRound modification: just-bash 3.6.0 public exec result.cwd; see /licenses/just-bash-modifications.txt. */\n";
const edits = [
  ["let a=f=>l?this.logResult(f):f,c=ii(i,n?.signal)", "let agrState,a=f=>({...l?this.logResult(f):f,cwd:agrState?.cwd??n?.cwd??this.state.cwd}),c=ii(i,n?.signal)"],
  ["},g=t;u.rawScript", "},g=t;agrState=m;u.rawScript"],
  ['!t.trim())return{stdout:"",stderr:"",exitCode:0,env:Nn(this.state.env,u.env)};', '!t.trim())return a({stdout:"",stderr:"",exitCode:0,env:Nn(this.state.env,u.env)});']
];
const source = await readFile(path, "utf8");
// Idempotence still verifies the entire original artifact, not just a header.
let original = source;
if (source.startsWith(marker)) {
  original = source.slice(marker.length);
  for (const [before, after] of edits) {
    if (original.split(after).length === 2) original = original.replace(after, before);
    else if (original.split(before).length !== 2) throw new Error("Unexpected modified just-bash artifact");
  }
}
if (digest(original) !== upstream) throw new Error("just-bash browser artifact differs from pinned 3.6.0; review cwd patch before upgrading");
let patched = original;
for (const [before, after] of edits) {
  if (patched.split(before).length !== 2) throw new Error("just-bash cwd patch marker is not unique");
  patched = patched.replace(before, after);
}
patched = marker + patched;
if (source !== patched) await writeFile(path, patched);
console.log(`Verified just-bash cwd patch (${digest(patched)})`);
