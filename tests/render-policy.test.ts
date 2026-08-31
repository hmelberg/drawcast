import { describe, expect, it } from "vitest";
import { canRender, needsRender } from "../src/render/policy";

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

describe("canRender", () => {
  it("allows a render when neither guard is active", () => {
    expect(canRender(false, false)).toBe(true);
  });

  it("blocks while viewing an old version — nowhere for a render to land", () => {
    expect(canRender(true, false)).toBe(false);
  });

  it("blocks while an AI call is streaming — the text is not the author's yet", () => {
    expect(canRender(false, true)).toBe(false);
  });

  it("blocks when both guards are active", () => {
    expect(canRender(true, true)).toBe(false);
  });
});
