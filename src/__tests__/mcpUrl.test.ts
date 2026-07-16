import { describe, expect, it } from "vitest";
import { redactMcpUrl } from "../mcp/url";

describe("redactMcpUrl", () => {
  it("redacts common query-string credential names", () => {
    expect(redactMcpUrl("https://mcp.example.com/mcp?tavilyApiKey=secret&mode=fast"))
      .toBe("https://mcp.example.com/mcp?tavilyApiKey=%5Bredacted%5D&mode=fast");
  });
});
