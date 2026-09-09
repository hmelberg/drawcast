import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { encodeIcon } from "../src/spec/trace";

describe("icon layout", () => {
  test("rings scaled to size, y flipped (svg y-down → canvas y-up), placeable with at", () => {
    const strokes = encodeIcon([[[0, 0], [1, 0], [1, 1], [0, 1]]]);
    const r = layoutSpec({ elements: [{ id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 }, { id: "i", type: "icon", of: "box", size: 50, strokes, at: { ref: "a", side: "above", gap: 10 } }], commands: [{ draw: ["a", "i"] }] });
    const b = elementBBoxes(r).get("i")!;
    expect([b.w, b.h]).toEqual([50, 50]);
    expect(b.y).toBeCloseTo(300 + 40 + 10, 0);
    expect(flattenDrawables(r.drawables).find((d) => d.id === "i__r0")).toMatchObject({ kind: "stroke", closed: true });
  });
  test("unresolved icon draws nothing and warns", () => {
    const r = layoutSpec({ elements: [{ id: "i", type: "icon", of: "nothing", x: 100, y: 100 }], commands: [{ draw: ["i"] }] });
    expect(r.warnings.join(" ")).toMatch(/no icon for "nothing"/);
  });
  // Fix round 1: a ring that does NOT touch its viewBox edges (the common
  // case — most icons have inset artwork) must still yield a box of exactly
  // `size`, and `at` placement must sit against that DECLARED box, not the
  // ink's own (smaller) bbox.
  test("the placement box is the declared size, not the ink — an inset ring still yields a size×size box", () => {
    const strokes = encodeIcon([[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]]);
    const r = layoutSpec({ elements: [{ id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 }, { id: "i", type: "icon", of: "box", size: 50, strokes, at: { ref: "a", side: "above", gap: 10 } }], commands: [{ draw: ["a", "i"] }] });
    const b = elementBBoxes(r).get("i")!;
    expect([b.w, b.h]).toEqual([50, 50]);
    expect(b.y).toBeCloseTo(300 + 40 + 10, 0);
  });
});
