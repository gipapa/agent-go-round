import { describe, expect, it } from "vitest";
import { parseStandardSkillDocument, validateSkillPackage } from "../runtime/skillPackageValidation";
import { TUTORIAL_GRILLING_INVEST_SKILL_MARKDOWN } from "../onboarding/tutorialSkillTemplate";

const skillMarkdown = `---
name: pdf-processing
description: Process PDF files safely.
version: 1.0.0
disable-model-invocation: true
metadata:
  agent-go-round:
    requiredToolIds:
      - builtin:pdf
---

# Instructions

Read only the resources needed for the task.
`;

describe("skill package validation", () => {
  it("parses standard YAML frontmatter and preserves namespaced metadata", () => {
    expect(parseStandardSkillDocument(skillMarkdown)).toMatchObject({
      name: "pdf-processing",
      description: "Process PDF files safely.",
      disableModelInvocation: true,
      metadata: { "agent-go-round": { requiredToolIds: ["builtin:pdf"] } }
    });
  });

  it("rejects malformed frontmatter and missing required description", () => {
    expect(parseStandardSkillDocument("# no frontmatter")).toMatchObject({ code: "malformed_frontmatter" });
    expect(parseStandardSkillDocument("---\nname: valid-name\n---\nbody")).toMatchObject({ code: "missing_description" });
    expect(parseStandardSkillDocument("---\nname: Invalid Name\ndescription: bad\n---\nbody")).toMatchObject({ code: "invalid_name" });
  });

  it("keeps the grilling-invest tutorial skill compatible with package naming rules", () => {
    expect(parseStandardSkillDocument(TUTORIAL_GRILLING_INVEST_SKILL_MARKDOWN)).toMatchObject({
      name: "grilling-invest"
    });
  });

  it("validates one root, unique SKILL.md, path safety, and package limits", () => {
    const valid = validateSkillPackage([
      { path: "pdf-processing/SKILL.md", content: skillMarkdown },
      { path: "pdf-processing/references/guide.md", content: "guide" },
      { path: "pdf-processing/scripts/run.js", content: "return 1" }
    ]);
    expect(valid.ok).toBe(true);
    expect(valid.rootPath).toBe("pdf-processing");

    const invalid = validateSkillPackage([
      { path: "one/SKILL.md", content: skillMarkdown },
      { path: "two/SKILL.md", content: skillMarkdown },
      { path: "one/../secret.txt", content: "secret" },
      { path: "one/references/guide.md", content: "guide" },
      { path: "one/references/guide.md", content: "duplicate" }
    ]);
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["multiple_roots", "root_escape", "duplicate_path"]));
  });

  it("keeps scripts as package files but does not give them executable semantics", () => {
    const result = validateSkillPackage([
      { path: "demo/SKILL.md", content: skillMarkdown },
      { path: "demo/scripts/run.js", content: "while (true) {}" }
    ]);
    expect(result.files.find((file) => file.path.endsWith("scripts/run.js"))).toMatchObject({ path: "demo/scripts/run.js" });
  });

  it("rejects binary SKILL.md and case-insensitive duplicate paths", () => {
    const result = validateSkillPackage([
      { path: "demo/SKILL.md", content: new Uint8Array([1, 2, 3]) },
      { path: "demo/references/Guide.md", content: "one" },
      { path: "demo/references/guide.md", content: "two" }
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["binary_skill_file", "duplicate_path"])
    );
  });

  it("fails closed with diagnostics for malformed runtime file payloads", () => {
    const result = validateSkillPackage([
      { path: null as never, content: "text" },
      { path: "demo/SKILL.md", content: null as never }
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_path" }),
      expect.objectContaining({ code: "invalid_file_content" })
    ]));
  });

  it("uses actual payload bytes instead of caller-provided size metadata", () => {
    const result = validateSkillPackage([
      { path: "demo/SKILL.md", content: skillMarkdown, byteSize: 0 },
      { path: "demo/assets/large.bin", content: new Uint8Array(512 * 1024 + 1), byteSize: 0 }
    ]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "file_too_large" })]));
  });

  it("rejects oversized package paths before storing the package", () => {
    const result = validateSkillPackage([
      { path: `demo/${"a".repeat(1_025)}`, content: "x" },
      { path: "demo/SKILL.md", content: skillMarkdown }
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "path_too_long" })]));
  });
});
