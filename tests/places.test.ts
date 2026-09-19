import { describe, expect, test } from "vitest";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const withAt = (at: unknown) => ({
  elements: [{ id: "t", type: "text", text: "hei", at }],
  commands: [{ draw: ["t"] }],
});

describe("at.place — a named spot on the canvas", () => {
  test("a place name validates", () => {
    expect(validateSpec(withAt({ place: "top_right" })).ok).toBe(true);
  });

  test("the bare string form normalizes to an object", () => {
    const n = normalizeSpec(withAt("left")) as Spec;
    expect(n.elements![0].at).toEqual({ place: "left" });
  });

  test("a hyphenated place name normalizes to the anchor spelling", () => {
    const n = normalizeSpec(withAt("top-right")) as Spec;
    expect(n.elements![0].at).toEqual({ place: "top_right" });
  });

  test("place cannot be combined with x/y", () => {
    const r = validateSpec({
      elements: [{ id: "t", type: "text", text: "hei", x: 100, y: 100, at: { place: "left" } }],
      commands: [{ draw: ["t"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("at.place cannot be combined with x/y");
  });

  test("place cannot be combined with ref", () => {
    const r = validateSpec(withAt({ place: "left", ref: "other" }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("at.place cannot be combined with at.ref");
  });

  test("an unknown place name is rejected", () => {
    expect(validateSpec(withAt({ place: "middle-ish" })).ok).toBe(false);
  });
});
