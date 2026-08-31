import { describe, expect, it } from "vitest";
import { needsRender } from "../src/render/policy";

describe("needsRender", () => {
  it("renders when nothing has been rendered yet", () => {
    expect(needsRender("a: 1", null)).toBe(true);
  });

  it("does not render when the text is unchanged", () => {
    expect(needsRender("a: 1", "a: 1")).toBe(false);
  });

  it("renders when the text changed", () => {
    expect(needsRender("a: 2", "a: 1")).toBe(true);
  });

  it("treats whitespace as a change — indentation is meaning in YAML", () => {
    expect(needsRender("a:\n  b: 1", "a:\n b: 1")).toBe(true);
    expect(needsRender(" a: 1", "a: 1")).toBe(true);
  });
});
