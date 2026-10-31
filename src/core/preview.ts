import { resolvePath, type VirtualFileSystem } from "./fs";
import type { DefaultTreeAdapterTypes as Tree } from "parse5";

export type PreviewDocument = { html: string; revisions: Record<string, number> };
const directory = (path: string): string => path.slice(0, path.lastIndexOf("/"));

/** Render text resources from the VFS. The resulting document never runs page scripts. */
export async function resolvePreview(fs: VirtualFileSystem, entry: string): Promise<PreviewDocument> {
  const { parse, parseFragment, serialize } = await import("parse5");
  const revisions: Record<string, number> = {};
  let bytes = 0;
  async function read(path: string): Promise<string> {
    if (Object.keys(revisions).length >= 64 && !(path in revisions)) throw new Error("Preview exceeds 64 resources");
    const file = await fs.readFile(path);
    bytes += file.content.length;
    if (bytes > 2_000_000) throw new Error("Preview exceeds 2 MB of text resources");
    revisions[file.path] = file.revision;
    return file.content;
  }
  function local(value: string, base: string): string {
    if (!value || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value)) throw new Error(`Preview requires a VFS relative resource: ${value}`);
    return resolvePath(decodeURIComponent(value.split(/[?#]/)[0]), directory(base));
  }
  async function image(value: string, base: string): Promise<string> {
    const path = local(value, base);
    if (!/\.svg$/i.test(path)) throw new Error("VFS preview images currently support UTF-8 SVG files");
    const svg = await read(path);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  async function css(text: string, base: string, chain: string[] = []): Promise<string> {
    if (chain.length > 12) throw new Error("Stylesheet imports are too deep");
    // Ignore comments before resolving URLs, including commented-out imports.
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const imports = [...text.matchAll(/@import\s+(?:url\(\s*(["']?)(.*?)\1\s*\)|(["'])(.*?)\3)\s*([^;]*);/gi)];
    for (const match of imports) {
      const path = local(match[2] ?? match[4], base);
      if (chain.includes(path)) throw new Error(`Circular CSS import: ${path}`);
      const content = await css(await read(path), path, [...chain, path]);
      text = text.replace(match[0], () => match[5].trim() ? `@media ${match[5]} {${content}}` : content);
    }
    const urls = [...text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)];
    for (const match of urls) {
      if (match[2].startsWith("data:image/svg+xml;")) continue;
      const value = await image(match[2], base);
      text = text.replace(match[0], () => `url("${value}")`);
    }
    return text;
  }
  const path = resolvePath(entry);
  // A pure HTML parser avoids even speculative image/iframe fetches during parsing.
  const document = parse(await read(path), { scriptingEnabled: false });
  const blocked = new Set(["script", "iframe", "frame", "object", "embed", "base", "meta", "template"]);
  const isElement = (node: Tree.ChildNode): node is Tree.Element => "tagName" in node;
  async function clean(parent: Tree.ParentNode): Promise<void> {
    parent.childNodes = parent.childNodes.filter(node => !isElement(node) || (!blocked.has(node.tagName) && (node.tagName !== "link" || node.attrs.some(attr => attr.name === "rel" && attr.value.toLowerCase() === "stylesheet"))));
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      const get = (name: string): string | undefined => node.attrs.find(attr => attr.name === name)?.value;
      if (node.tagName === "link") {
        const target = local(get("href") || "", path);
        const text = await css(await read(target), target, [target]);
        node.tagName = node.nodeName = "style";
        node.attrs = node.attrs.filter(attr => attr.name === "media");
        node.childNodes = [{ nodeName: "#text", value: text, parentNode: node }];
      } else if (node.tagName === "style") {
        const text = node.childNodes.map(child => "value" in child ? child.value : "").join("");
        node.childNodes = [{ nodeName: "#text", value: await css(text, path), parentNode: node }];
      }
      const source = get("src");
      if (node.tagName === "img" && source) node.attrs.find(attr => attr.name === "src")!.value = await image(source, path);
      const style = node.attrs.find(attr => attr.name === "style");
      if (style) style.value = await css(style.value, path);
      node.attrs = node.attrs.filter(attr => !/^on/i.test(attr.name) && !["srcdoc", "srcset", "action", "formaction", "ping", "autofocus", "href"].includes(attr.name) && (attr.name !== "src" || node.tagName === "img"));
      await clean(node);
    }
  }
  await clean(document);
  const root = document.childNodes.find(node => isElement(node) && node.tagName === "html") as Tree.Element;
  const head = root.childNodes.find(node => isElement(node) && node.tagName === "head") as Tree.Element;
  const policy = parseFragment(`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`).childNodes;
  for (const node of policy) node.parentNode = head;
  head.childNodes.unshift(...policy);
  document.childNodes = document.childNodes.filter(node => node.nodeName !== "#documentType");
  return { html: "<!doctype html>" + serialize(document), revisions };
}

export const STARTER_PAGE = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>我的 Pi 主頁</title>
<style>body{margin:0;padding:clamp(24px,8vw,100px);font-family:system-ui;background:#f6f3ed;color:#29263a}h1{font-size:clamp(32px,6vw,64px)}p{line-height:1.8;max-width:42em}</style></head>
<body><h1>我的 Pi 主頁</h1><p>開啟右下角的 Pi，讓它讀取並修改這個檔案。儲存後按「重新載入預覽」，就能看到更新。</p></body></html>`;
