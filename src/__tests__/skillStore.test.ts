import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { deleteSkill, exportSkillZip, importSkillZip, listSkillFiles, upsertSkillTextFile } from "../storage/skillStore";

const skillMarkdown = `---
name: binary-fixture
description: Verify binary package fidelity.
version: 1.0.0
---

# Binary fixture
`;

const binaryPayload = new Uint8Array([0x00, 0xff, 0x01, 0xfe, 0x7f]);

const scopedSkillMarkdown = `---
name: scoped-skill
description: Scoped capability metadata.
metadata:
  agent-go-round:
    workflow:
      requiredToolIds:
        - builtin:scoped
---

# Scoped skill
`;

describe("skill package storage", () => {
  it("preserves arbitrary package bytes through IndexedDB import and zip export", async () => {
    const zip = new JSZip();
    zip.file("binary-fixture/SKILL.md", skillMarkdown);
    zip.file("binary-fixture/assets/payload.txt", binaryPayload);
    zip.file("binary-fixture/assets/payload.bin", binaryPayload);
    const input = new File([await zip.generateAsync({ type: "blob" })], "binary-fixture.zip");

    const meta = await importSkillZip(input);
    try {
      const files = await listSkillFiles(meta.id);
      for (const path of ["binary-fixture/assets/payload.txt", "binary-fixture/assets/payload.bin"]) {
        const stored = files.find((file) => file.path === path);
        expect(typeof stored?.content).not.toBe("string");
        expect(Array.from(stored?.content as Uint8Array)).toEqual(Array.from(binaryPayload));
        expect(Array.from(stored?.binaryContent ?? [])).toEqual(Array.from(binaryPayload));
        expect(stored?.byteSize).toBe(binaryPayload.byteLength);
      }

      const exported = await exportSkillZip(meta.id);
      const exportedZip = await JSZip.loadAsync(exported);
      for (const path of ["binary-fixture/assets/payload.txt", "binary-fixture/assets/payload.bin"]) {
        expect(Array.from(await exportedZip.file(path)!.async("uint8array"))).toEqual(Array.from(binaryPayload));
      }
      expect(await exportedZip.file("binary-fixture/SKILL.md")!.async("text")).toBe(skillMarkdown);

      await expect(upsertSkillTextFile(meta.id, { path: "../escape.txt", kind: "asset", content: "blocked" })).rejects.toThrow("safe relative path");
      await expect(upsertSkillTextFile(meta.id, { path: "SKILL.md", kind: "asset", content: "blocked" })).rejects.toThrow("Editable files");
      await expect(upsertSkillTextFile(meta.id, { path: "references/too-large.txt", kind: "reference", content: "x".repeat(512 * 1024 + 1) })).rejects.toThrow("exceeds");
    } finally {
      await deleteSkill(meta.id);
    }
  });

  it("preserves namespaced workflow capability requirements on import", async () => {
    const zip = new JSZip();
    zip.file("scoped-skill/SKILL.md", scopedSkillMarkdown);
    const input = new File([await zip.generateAsync({ type: "blob" })], "scoped-skill.zip");
    const meta = await importSkillZip(input);
    try {
      expect(meta.workflow.requiredToolIds).toEqual(["builtin:scoped"]);
    } finally {
      await deleteSkill(meta.id);
    }
  });

  it("parses the optional skill-config block after standard frontmatter", async () => {
    const markdown = `---
name: browser-workflow
description: Browser workflow skill.
---

# Browser Workflow

Follow the browser workflow.

\`\`\`skill-config
{
  "workflow": {
    "allowMcp": true,
    "allowBuiltInTools": true
  }
}
\`\`\`
`;
    const zip = new JSZip();
    zip.file("browser-workflow/SKILL.md", markdown);
    const input = new File([await zip.generateAsync({ type: "blob" })], "browser-workflow.zip");
    const meta = await importSkillZip(input);
    try {
      expect(meta.workflow.allowMcp).toBe(true);
      expect(meta.workflow.allowBuiltInTools).toBe(true);
      expect(meta.workflow.instructions).toBe("# Browser Workflow\n\nFollow the browser workflow.");
    } finally {
      await deleteSkill(meta.id);
    }
  });
});
