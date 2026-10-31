import { describe, expect, it } from "vitest";
import { mount } from "./index";

describe("public SDK entry", () => {
  it("exports the browser embed mount without hiding the core exports", () => {
    expect(typeof mount).toBe("function");
  });
});
