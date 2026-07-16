import { beforeEach, describe, expect, it } from "vitest";
import { loadMcpServers } from "../storage/settingsStore";

describe("MCP settings", () => {
  beforeEach(() => localStorage.clear());

  it("loads legacy server records as SSE", () => {
    localStorage.setItem("agr_mcp_v1", JSON.stringify([
      { id: "legacy", name: "Legacy", sseUrl: "http://localhost:3333/mcp/sse" }
    ]));

    expect(loadMcpServers()).toEqual([
      expect.objectContaining({ id: "legacy", transport: "sse", useLocalProxy: false })
    ]);
  });

  it("restores remote transport authentication settings", () => {
    localStorage.setItem("agr_mcp_v1", JSON.stringify([
      {
        id: "remote",
        name: "Remote",
        sseUrl: "https://example.com/mcp",
        transport: "streamable_http",
        authToken: "secret",
        customHeaders: { DEFAULT_PARAMETERS: "{\"max_results\":5}", ignored: 42 },
        useLocalProxy: true
      }
    ]));

    expect(loadMcpServers()[0]).toEqual(expect.objectContaining({
      transport: "streamable_http",
      authToken: "secret",
      customHeaders: { DEFAULT_PARAMETERS: "{\"max_results\":5}" },
      useLocalProxy: true
    }));
  });
});
