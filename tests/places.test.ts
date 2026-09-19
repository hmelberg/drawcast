import { describe, expect, test } from "vitest";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { autoRow, placeDelta, safeArea, PLACE_MARGIN } from "../src/layout/places";

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

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const shifted = (b: { x: number; y: number; w: number; h: number }, [dx, dy]: [number, number]) =>
  ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });

describe("place geometry", () => {
  test("the safe area is the canvas inset by the margin on every side", () => {
    expect(safeArea()).toEqual({ x: PLACE_MARGIN, y: PLACE_MARGIN, w: 1000 - 2 * PLACE_MARGIN, h: 750 - 2 * PLACE_MARGIN });
  });

  test("left seats the left edge on the margin, vertically centred", () => {
    const b = shifted(box(0, 0, 100, 40), placeDelta(box(0, 0, 100, 40), "left"));
    expect(b.x).toBeCloseTo(PLACE_MARGIN, 5);
    expect(b.y + b.h / 2).toBeCloseTo(375, 5);
  });

  test("top_right tucks the element's own top-right corner into that corner", () => {
    const b = shifted(box(0, 0, 200, 80), placeDelta(box(0, 0, 200, 80), "top_right"));
    expect(b.x + b.w).toBeCloseTo(1000 - PLACE_MARGIN, 5);
    expect(b.y + b.h).toBeCloseTo(750 - PLACE_MARGIN, 5);
  });

  test("center centres the element on the canvas", () => {
    const b = shifted(box(0, 0, 120, 60), placeDelta(box(0, 0, 120, 60), "center"));
    expect(b.x + b.w / 2).toBeCloseTo(500, 5);
    expect(b.y + b.h / 2).toBeCloseTo(375, 5);
  });

  test("a huge element still cannot fall off the left edge", () => {
    const b = shifted(box(0, 0, 900, 700), placeDelta(box(0, 0, 900, 700), "left"));
    expect(b.x).toBeCloseTo(PLACE_MARGIN, 5);
  });

  test("the element's own anchor overrides which of its points lands there", () => {
    const b = shifted(box(0, 0, 120, 60), placeDelta(box(0, 0, 120, 60), "left", "center"));
    expect(b.x + b.w / 2).toBeCloseTo(PLACE_MARGIN, 5);
  });

  test("autoRow spreads n slots evenly across the safe area at mid height", () => {
    const slots = autoRow(2);
    expect(slots).toHaveLength(2);
    expect(slots[0][0]).toBeCloseTo(PLACE_MARGIN + (1000 - 2 * PLACE_MARGIN) * 0.25, 5);
    expect(slots[1][0]).toBeCloseTo(PLACE_MARGIN + (1000 - 2 * PLACE_MARGIN) * 0.75, 5);
    expect(slots[0][1]).toBeCloseTo(375, 5);
  });

  test("a single slot is the centre of the canvas", () => {
    expect(autoRow(1)[0][0]).toBeCloseTo(500, 5);
  });
});
