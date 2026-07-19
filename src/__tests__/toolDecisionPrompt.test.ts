import { describe, expect, it } from "vitest";
import { buildToolDecisionCatalog, buildToolDecisionPrompt } from "../runtime/toolDecisionPrompt";
import type { BuiltInToolConfig, McpServerConfig } from "../types";

describe("tool decision prompt runtime", () => {
  it("replaces every supported placeholder without duplicating fallback instructions", () => {
    const template = "User={{userInput}}\nTools={{toolListJson}}\n{{noToolJson}}\n{{userProfileJson}}\n{{builtinToolJson}}\n{{mcpCallJson}}";
    const prompt = buildToolDecisionPrompt(template, "fallback", "question", "[]");
    expect(prompt).toContain("User=question");
    expect(prompt).toContain("Tools=[]");
    expect(prompt).toContain('{"type":"no_tool"}');
    expect(prompt).not.toContain("User request:");
  });

  it("uses the fallback template and appends missing contracts", () => {
    const prompt = buildToolDecisionPrompt("  ", "Choose a tool.", "question", "[]");
    expect(prompt).toContain("Choose a tool.");
    expect(prompt).toContain("User request:\nquestion");
    expect(prompt).toContain("Available tools:\n[]");
    expect(prompt).toContain("If an MCP tool is needed");
  });

  it("serializes built-in and MCP catalogs with compact summaries", () => {
    const server: McpServerConfig = { id: "browser", name: "Browser", sseUrl: "https://example.com/mcp" };
    const builtIn: BuiltInToolConfig = {
      id: "clock",
      name: "clock",
      description: "  Read   the current time  ",
      code: "return null",
      updatedAt: 0
    };
    const catalog = buildToolDecisionCatalog([
      { kind: "builtin", tool: builtIn },
      { kind: "mcp", server, tool: { name: "browser_open", description: "Open a URL" } }
    ]);
    expect(catalog).toEqual([
      { kind: "builtin", tool: "clock", summary: "Read the current time" },
      { kind: "mcp", server: "Browser", tool: "browser_open", summary: "Open a URL" }
    ]);
  });
});
