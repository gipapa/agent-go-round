// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mount } from "./index";

describe("public SDK entry in a non-browser runtime", () => {
  it("can be imported without evaluating DOM-only loader side effects", () => {
    expect(typeof mount).toBe("function");
  });
});
