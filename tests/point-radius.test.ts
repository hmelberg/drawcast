import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";
import type { StrokeDrawable, TextDrawable } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";

const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as StrokeDrawable;
const radiusOf = (d: StrokeDrawable) => (d.shapeHint?.type === "circle" ? d.shapeHint.r : NaN);

describe("point radius", () => {
  test("a point without radius keeps the house dot (r = 7)", () => {
    const l = layoutSpec({ elements: [{ id: "p", type: "point", at: { x: 500, y: 375 } }], commands: [] } as Spec);
    expect(radiusOf(stroke(l, "p"))).toBe(7);
  });

  test("radius sizes the dot, and its box follows", () => {
    const spec = { elements: [{ id: "ball", type: "point", at: { x: 500, y: 375 }, radius: 24 }], commands: [] } as Spec;
    expect(validateSpec(spec).ok).toBe(true);
    const l = layoutSpec(spec);
    expect(radiusOf(stroke(l, "ball"))).toBe(24);
    const box = elementBBoxes(l).get("ball")!;
    expect(box.w).toBeGreaterThanOrEqual(48);
    expect(box.h).toBeGreaterThanOrEqual(48);
  });

  test("a bound radius animates with its var", () => {
    const spec = (s: number): Spec =>
      ({ vars: { s }, elements: [{ id: "ball", type: "point", at: { x: 500, y: 375 }, radius: 10, bind: { radius: "10 + 20*s" } }], commands: [] }) as Spec;
    expect(radiusOf(stroke(layoutSpec(spec(0)), "ball"))).toBe(10);
    expect(radiusOf(stroke(layoutSpec(spec(1)), "ball"))).toBe(30);
  });

  test("a label on a big point stands clear of its rim", () => {
    const spec = (radius?: number): Spec =>
      ({
        elements: [
          { id: "ball", type: "point", at: { x: 500, y: 375 }, ...(radius ? { radius } : {}) },
          { id: "lab", type: "label", text: "Ball", attach_to: "ball", side: "right" },
        ],
        commands: [],
      }) as Spec;
    const small = layoutSpec(spec()).drawables.find((d) => d.id === "lab") as TextDrawable;
    const big = layoutSpec(spec(40)).drawables.find((d) => d.id === "lab") as TextDrawable;
    // The big ball's label moved out by the extra radius, and never overlaps the ball.
    expect(big.pos[0] - small.pos[0]).toBeCloseTo(33, 0);
    const bigBox = elementBBoxes(layoutSpec(spec(40))).get("lab")!;
    expect(bigBox.x).toBeGreaterThan(540);
  });
});
