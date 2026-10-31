import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./fs";
import { resolvePreview } from "./preview";

describe("VFS page resources", () => {
  it("resolves nested CSS and SVG relative to their own files and records all revisions", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("~/site/css", { recursive: true });
    await fs.writeFile("~/site/main.html", '<html><head><link rel="stylesheet" href="css/base.css"></head><body><h1>你好</h1><img src="logo.svg"></body></html>');
    await fs.writeFile("~/site/css/base.css", '@import "colors.css"; h1{background-image:url(../logo.svg)}');
    await fs.writeFile("~/site/css/colors.css", 'h1{color:rgb(20, 30, 40)}');
    await fs.writeFile("~/site/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle r="10"/></svg>');
    const result = await resolvePreview(fs, "~/site/main.html");
    expect(result.html).toContain("rgb(20, 30, 40)");
    expect(result.html).toContain("data:image/svg+xml;");
    expect(result.html).not.toContain("@import");
    expect(Object.keys(result.revisions).sort()).toEqual(["/home/user/site/css/base.css", "/home/user/site/css/colors.css", "/home/user/site/logo.svg", "/home/user/site/main.html"]);
    await fs.writeFile("~/site/css/colors.css", "h1{color:red}");
    expect((await resolvePreview(fs, "~/site/main.html")).revisions["/home/user/site/css/colors.css"]).toBe(2);
  });

  it("blocks page scripts, navigation and remote resources", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("~/main.html", '<meta http-equiv="refresh" content="0;url=https://example.com"><script>steal()</script><iframe src="https://example.com"></iframe><body onload="steal()"><a href="javascript:steal()">hello</a></body>');
    const result = await resolvePreview(fs, "~/main.html");
    expect(result.html).not.toMatch(/steal|onload|http-equiv="refresh"|<iframe|javascript:/);
    expect(result.html).toContain("script-src 'none'");
    await fs.writeFile("~/main.html", '<link rel="stylesheet" href="https://example.com/style.css">');
    await expect(resolvePreview(fs, "~/main.html")).rejects.toThrow("VFS relative");
    await fs.writeFile("~/main.html", '<link rel="stylesheet" href="missing.css">');
    await expect(resolvePreview(fs, "~/main.html")).rejects.toThrow("Not found");
    await fs.writeFile("~/main.html", '<style>@import "loop.css";</style>');
    await fs.writeFile("~/loop.css", '@import "loop.css";');
    await expect(resolvePreview(fs, "~/main.html")).rejects.toThrow("Circular CSS");
  });
});
