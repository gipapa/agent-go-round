// Offline, reproducible production-dependency inventory and full license copies.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const lockText = await readFile(new URL("package-lock.json", root), "utf8"), lock = JSON.parse(lockText);
const output = new URL("public/licenses/", root);
await mkdir(output, { recursive: true });
const piLicense = await readFile(new URL("public/licenses/pi-0.84.4-LICENSE.txt", root), "utf8");
const packages = [], sections = [];
const sha256 = value => createHash("sha256").update(value).digest("hex");
for (const [path, record] of Object.entries(lock.packages)) {
  if (!path || record.dev) continue;
  const directory = resolve(fileURLToPath(root), path);
  let files;
  try { files = await readdir(directory); }
  catch (error) { if (error.code === "ENOENT" && record.optional) continue; throw error; }
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const texts = [];
  for (const name of files.filter(name => /^(licen[sc]e|copying|copyright|notice)([.\-_]|$)/i.test(name)).sort()) {
    texts.push({ source: `${path}/${name}`, text: await readFile(join(directory, name), "utf8") });
  }
  if (!texts.length) {
    if (manifest.name.startsWith("@earendil-works/pi-") && manifest.version === "0.84.4") {
      texts.push({ source: "https://github.com/earendil-works/pi/blob/v0.84.4/LICENSE", text: piLicense });
    } else if (manifest.name.startsWith("@aws-sdk/")) {
      texts.push({ source: "node_modules/@aws-sdk/core/LICENSE (shared AWS SDK Apache-2.0 license)", text: await readFile(new URL("node_modules/@aws-sdk/core/LICENSE", root), "utf8") });
    } else if (manifest.name === "@nodable/entities" && manifest.version === "3.1.0") {
      texts.push({ source: "https://github.com/nodable/val-parsers/blob/ac48e7ea591da372be023a481875c747535812b3/LICENSE", text: await readFile(new URL("scripts/license-sources/nodable-entities-3.1.0-LICENSE.txt", root), "utf8") });
    } else {
      const readme = await readFile(join(directory, "README.md"), "utf8");
      const license = readme.match(/(?:^|\n)(?:## Licen[sc]e|License\r?\n-+)[\s\S]*$/i)?.[0];
      if (!license || !license.includes("Permission is hereby granted")) throw new Error(`Missing full license text for ${manifest.name}@${manifest.version}`);
      texts.push({ source: `${path}/README.md`, text: license });
    }
  }
  const identity = `${manifest.name}@${manifest.version}`;
  sections.push(`\n${"=".repeat(80)}\n${identity}\n${path}\n${"=".repeat(80)}\n` + texts.map(({ source, text }) => `Source: ${source}\n\n${text.trim()}\n`).join("\n"));
  packages.push({ name: manifest.name, version: manifest.version, path, license: manifest.license ?? record.license, tarball: record.resolved, integrity: record.integrity, repository: manifest.repository, texts: texts.map(({ source, text }) => ({ source, sha256: sha256(text) })) });
}
const bash = await readFile(new URL("node_modules/just-bash/dist/bundle/browser.js", root), "utf8");
if (sha256(bash) !== "37977c1541791bb2f5182ba9453566301c15082faee7c1a4c89eaec0ec8e543f") throw new Error("Expected the verified just-bash public cwd patch; run scripts/patch-just-bash.mjs");
const notices = bash.slice(bash.lastIndexOf("/*! Bundled license information:"));
if (!notices.startsWith("/*!")) throw new Error("Expected just-bash bundled dependency notices");
sections.push(`\nUnmodified just-bash browser bundle notices\n${notices}\n`);
const fullText = ("Production dependency license texts (a superset of browser-bundled code).\nOptional packages absent on this install platform are excluded.\n" + sections.join("\n"))
  .replace(/\r\n/g, "\n").replace(/[\t ]+$/gm, "").trimEnd() + "\n";
await writeFile(new URL("THIRD_PARTY_NOTICES.txt", output), fullText);
await writeFile(new URL("index.json", output), JSON.stringify({ format: 1, lockfileSha256: sha256(lockText), noticesSha256: sha256(fullText), scope: "Installed production dependency closure; includes Node-only and optional packages which may not appear in browser output. Bundled upstream notices are preserved separately in THIRD_PARTY_NOTICES.txt.", packages }, null, 2) + "\n");
await writeFile(new URL("just-bash-3.6.0-LICENSE.txt", output), await readFile(new URL("node_modules/just-bash/LICENSE", root)));
console.log(`Generated license inventory and full texts for ${packages.length} production dependencies`);
