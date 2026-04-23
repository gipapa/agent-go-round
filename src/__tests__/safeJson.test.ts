import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../utils/safeJson";

describe("extractJsonObject", () => {
  it("extracts the first complete JSON object without greedily swallowing later objects", () => {
    expect(extractJsonObject('first {"type":"no_tool"} trailing {"type":"other"}')).toEqual({ type: "no_tool" });
  });

  it("handles braces inside JSON strings", () => {
    expect(extractJsonObject('payload {"message":"literal } brace","ok":true} done')).toEqual({
      message: "literal } brace",
      ok: true
    });
  });

  it("handles markdown json fences", () => {
    expect(extractJsonObject('```json\n{"type":"finish","reason":"done"}\n```')).toEqual({
      type: "finish",
      reason: "done"
    });
  });

  it("falls through invalid object-looking text to a later valid object", () => {
    expect(extractJsonObject("bad {not json} then {\"ok\":true}")).toEqual({ ok: true });
  });

  it("rejects empty and oversized inputs", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject(`{"x":"${"a".repeat(200_001)}"}`)).toBeNull();
  });
});
