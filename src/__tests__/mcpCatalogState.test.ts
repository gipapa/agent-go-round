import { describe, expect, it } from "vitest";
import { retainMcpToolCatalog } from "../runtime/mcpCatalogState";

describe("MCP catalog state", () => {
  it("drops removed and invalidated server catalogs while retaining unchanged servers", () => {
    const previous = {
      unchanged: [{ name: "search" }],
      changed: [{ name: "stale_tool" }]
    };
    expect(retainMcpToolCatalog(
      previous,
      [{ id: "unchanged" }, { id: "changed" }, { id: "new" }],
      new Set(["changed"])
    )).toEqual({ unchanged: [{ name: "search" }] });
  });

  it("does not treat prototype properties as cached tool catalogs", () => {
    const previous = Object.create({ inherited: [{ name: "forged" }] }) as Record<string, { name: string }[]>;
    expect(retainMcpToolCatalog(previous, [{ id: "inherited" }])).toEqual({});
  });
});
