import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
const textOf = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { text?: string } | undefined)?.text;

describe("angle element (design §2.2)", () => {
  const tri = { id: "tri", type: "polygon", points: [[200, 200], [500, 200], [200, 400]] };
  test("an angle at a vertex between two arms writes its degrees, sweeps counter-clockwise, and anchors vertex/arc", () => {
    const out = layoutSpec(spec([tri, { id: "a", type: "angle", at: { ref: "tri", anchor: "vertex_1" }, from: { ref: "tri", anchor: "vertex_2" }, to: { ref: "tri", anchor: "vertex_3" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "a_text")).toBe("90°");
    const arc = flattenDrawables(out.drawables).find((d) => d.id === "a") as { pts: [number, number][] };
    expect(arc.pts).toHaveLength(3); // the right-angle square: two arm points and the corner
    expect(out.namedAnchors.a.vertex).toEqual([200, 200]);
    const b = out.namedAnchors.a.arc;
    expect(Math.hypot(b[0] - 200, b[1] - 200)).toBeCloseTo(40, 6);
    expect(b[0]).toBeGreaterThan(200); expect(b[1]).toBeGreaterThan(200); // on the bisector, into the first quadrant
  });
  test("directions in degrees, a custom radius and label, and the reflex side when the arms are given the other way round", () => {
    const out = layoutSpec(spec([{ id: "b", type: "angle", at: [500, 375], from: 0, to: 60, radius: 80, label: "α" }, { id: "c", type: "angle", at: [800, 375], from: 60, to: 0, label: false, right: false }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "b_text")).toBe("α");
    const arc = flattenDrawables(out.drawables).find((d) => d.id === "b") as { pts: [number, number][] };
    expect(arc.pts.length).toBeGreaterThan(10);
    expect(Math.hypot(arc.pts[0][0] - 500, arc.pts[0][1] - 375)).toBeCloseTo(80, 6);
    expect(textOf(out, "c_text")).toBeUndefined();
    const reflex = flattenDrawables(out.drawables).find((d) => d.id === "c") as { pts: [number, number][] };
    const last = reflex.pts[reflex.pts.length - 1];
    expect(Math.atan2(last[1] - 375, last[0] - 800)).toBeCloseTo(0, 3); // swept 300° from 60° round to 0°
  });
  test("schema: needs at, from and to; a 90° between arms not flagged right: false gets the square", () => {
    expect(validateSpec(spec([{ id: "x", type: "angle", at: [0, 0], from: 0 }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "x", type: "angle", at: [0, 0], from: 0, to: 90 }])).ok).toBe(true);
  });
  test("an arm resolving to the vertex itself warns and is skipped, rather than reading as a silent 0°", () => {
    const out = layoutSpec(spec([{ id: "d", type: "angle", at: [100, 100], from: [100, 100], to: 90 }]), heuristicMeasure);
    expect(out.warnings).toEqual([`angle "d": an arm coincides with the vertex`]);
    expect(flattenDrawables(out.drawables).find((dr) => dr.id === "d")).toBeUndefined();
  });
});
