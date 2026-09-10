import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { isEmptyOverrides, mapLeaf, overridesKey } from "../src/layout/posed";
import type { Spec } from "../src/spec/types";
import type { AreaDrawable, StrokeDrawable, TextDrawable } from "../src/layout/model";

const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as StrokeDrawable;
const dot = (l: ReturnType<typeof layoutSpec>, id: string): [number, number] => {
  const d = stroke(l, id);
  return d.shapeHint?.type === "circle" ? d.shapeHint.c : d.pts[0];
};
const area = (pts: [number, number][]) =>
  Math.abs(
    pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2,
  );
const style = { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 };
const drawOpts = { mode: "instant" as const, duration: 0 };

const market: Spec = {
  domain: { x: [0, 100], y: [0, 100] },
  elements: [
    { id: "d", type: "curve", expr: "80 - x" },
    { id: "s", type: "curve", expr: "20 + x" },
    { id: "eq", type: "point", at: { intersection_of: ["d", "s"] }, guides: true },
    { id: "cs", type: "region", between: ["d", "s"], x_from: 0, x_to: 30 },
    { id: "a", type: "arrow", from: { ref: "eq" }, to: { x: 80, y: 90 } },
    { id: "lb", type: "label", attach_to: "d", text: "D" },
  ],
  commands: [],
};

describe("posed helpers", () => {
  test("mapLeaf maps text, circle hints (radius × scale), rect hints (to corners) and points", () => {
    const map = (p: [number, number]): [number, number] => [p[0] + 10, p[1] * 2];
    const t = mapLeaf({ id: "t", kind: "text", pos: [1, 1], text: "x", fontSize: 20, anchor: "middle", z: 2, style, drawOpts }, map, 2) as TextDrawable;
    expect(t.pos).toEqual([11, 2]);
    const c = mapLeaf({ id: "c", kind: "stroke", pts: [[5, 5]], shapeHint: { type: "circle", c: [5, 5], r: 3 }, z: 1, style, drawOpts }, map, 2) as StrokeDrawable;
    expect(c.shapeHint).toEqual({ type: "circle", c: [15, 10], r: 6 });
    const r = mapLeaf({ id: "r", kind: "stroke", pts: [], shapeHint: { type: "rect", x: 0, y: 0, w: 2, h: 2 }, z: 1, style, drawOpts }, map, 1) as StrokeDrawable;
    expect(r.shapeHint).toBeUndefined();
    expect(r.closed).toBe(true);
    expect(r.pts).toEqual([[10, 0], [12, 0], [12, 4], [10, 4]]);
    const a = mapLeaf({ id: "a", kind: "area", pts: [[0, 0], [1, 0], [1, 1]], z: 0, style, drawOpts }, map, 1, { a: [[2, 2], [3, 2], [3, 3]] }) as AreaDrawable;
    expect(a.pts).toEqual([[12, 4], [13, 4], [13, 6]]);
  });
  test("overridesKey is empty for nothing and stable for something", () => {
    expect(isEmptyOverrides(undefined)).toBe(true);
    expect(isEmptyOverrides({ poses: {} })).toBe(true);
    expect(overridesKey({ poses: {} })).toBe("");
    expect(overridesKey({ poses: { d: { offset: [5, 0] } } })).toBe(overridesKey({ poses: { d: { offset: [5, 0] } } }));
    expect(overridesKey({ poses: { d: { offset: [5, 0] } } })).not.toBe(overridesKey({ poses: { d: { offset: [6, 0] } } }));
  });
});

describe("definitions hold under overrides", () => {
  test("an intersection follows a translated curve; the curve's own ink does not move; the label stays with the raw anchor", () => {
    const base = layoutSpec(market);
    const moved = layoutSpec(market, undefined, { poses: { d: { offset: [60, 0] } } });
    expect(stroke(moved, "d").pts).toEqual(stroke(base, "d").pts);
    const e0 = dot(base, "eq");
    const e1 = dot(moved, "eq");
    expect(e1[0]).toBeGreaterThan(e0[0] + 20);
    expect(e1[1]).toBeGreaterThan(e0[1] + 20); // up the supply curve
    // The arrow stands off its anchor by the connector gap (≈ 14 units), so its tail is near, not on, the moved point.
    expect(Math.abs(stroke(moved, "a").pts[0][0] - e1[0])).toBeLessThan(20);
    expect(Math.abs(stroke(base, "a").pts[0][0] - e0[0])).toBeLessThan(20);
    const lb0 = moved.drawables.find((d) => d.id === "lb") as TextDrawable;
    const lb1 = base.drawables.find((d) => d.id === "lb") as TextDrawable;
    expect(Math.abs(lb1.pos[0] - lb0.pos[0])).toBeLessThan(30);
    expect(moved.warnings).toEqual([]);
  });
  test("a region between a moved and a fixed curve changes area the right way", () => {
    const base = layoutSpec(market);
    const up = layoutSpec(market, undefined, { poses: { d: { offset: [0, 40] } } });
    expect(area((up.drawables.find((d) => d.id === "cs") as AreaDrawable).pts)).toBeGreaterThan(area((base.drawables.find((d) => d.id === "cs") as AreaDrawable).pts));
  });
  test("an angle follows a rotated arm; a line through a moved point follows", () => {
    const spec: Spec = {
      elements: [
        { id: "v", type: "shape", shape: "circle", x: 500, y: 375, radius: 4 },
        { id: "a", type: "arrow", from: { x: 500, y: 375 }, to: { x: 700, y: 375 } },
        { id: "b", type: "arrow", from: { x: 500, y: 375 }, to: { x: 700, y: 375 } },
        { id: "ang", type: "angle", at: { ref: "a", anchor: "tail" }, from: { ref: "a", anchor: "tip" }, to: { ref: "b", anchor: "tip" } },
        { id: "ln", type: "line", through: [{ ref: "v" }, { ref: "b", anchor: "tip" }] },
      ],
      commands: [],
    };
    const flat = layoutSpec(spec);
    expect((flat.drawables.find((d) => d.id === "ang_text") as TextDrawable | undefined)?.text).toBe("360°"); // both arms on one ray: a full turn
    const turned = layoutSpec(spec, undefined, { poses: { b: { offset: [0, 0], turn: { deg: 90, pivot: [500, 375] } } } });
    expect(stroke(turned, "ang")).toBeDefined();
    const label = turned.drawables.find((d) => d.id === "ang_text") as TextDrawable | undefined;
    expect(label?.text).toBe("90°");
    const ln = stroke(turned, "ln");
    expect(Math.abs(ln.pts[1][0] - ln.pts[0][0])).toBeLessThan(1e-6); // vertical through (500,375) and (500,575)
    expect(turned.warnings).toEqual([]);
  });
  test("an edge between nodes follows a moved node; a morphed curve's intersection follows its shapes", () => {
    const g = layoutSpec(
      { elements: [{ id: "n1", type: "node", x: 200, y: 300, text: "A" }, { id: "n2", type: "node", x: 600, y: 300, text: "B" }, { id: "e", type: "edge", from: { ref: "n1" }, to: { ref: "n2" } }], commands: [] },
      undefined,
      { poses: { n2: { offset: [0, 200] } } },
    );
    const e = stroke(g, "e");
    expect(e.pts[e.pts.length - 1][1]).toBeGreaterThan(400);
    const base = layoutSpec(market);
    const flatD = stroke(base, "d").pts.map(([x]) => [x, 400] as [number, number]);
    const m = layoutSpec(market, undefined, { shapes: { d: { d: flatD } } });
    expect(stroke(m, "d").pts).toEqual(stroke(base, "d").pts); // the morph is the renderer's; layout keeps the curve's own points
    expect(dot(m, "eq")[1]).toBeCloseTo(400, 0);
  });
  test("a template id can be a source: a freehand arrow from a template point follows its pose", () => {
    const spec: Spec = { template: "supply_demand", params: {}, elements: [{ id: "a", type: "arrow", from: { ref: "equilibrium_point" }, to: { x: 90, y: 90 } }], commands: [] };
    const base = layoutSpec(spec);
    const moved = layoutSpec(spec, undefined, { poses: { equilibrium_point: { offset: [0, 50] } } });
    // The arrow starts a few units off its anchor along its own direction, which turns a little when the tail moves.
    expect(Math.abs(stroke(moved, "a").pts[0][1] - (stroke(base, "a").pts[0][1] + 50))).toBeLessThan(3);
  });
  test("a group's definitional anchor follows a moved member; its placement anchor does not", () => {
    const spec: Spec = {
      elements: [
        { id: "p1", type: "shape", shape: "rect", x: 100, y: 100, width: 100, height: 50 },
        { id: "p2", type: "shape", shape: "rect", x: 300, y: 100, width: 100, height: 50 },
        { id: "g", type: "group", members: ["p1", "p2"] },
        { id: "a", type: "arrow", from: { ref: "g" }, to: { x: 500, y: 600 } },
        { id: "t", type: "text", text: "beside", at: { ref: "g", side: "right", gap: 10 } },
      ],
      commands: [],
    };
    const base = layoutSpec(spec);
    const moved = layoutSpec(spec, undefined, { poses: { p2: { offset: [0, 300] } } });
    expect(stroke(moved, "a").pts[0][1]).toBeGreaterThan(stroke(base, "a").pts[0][1] + 100);
    expect((moved.drawables.find((d) => d.id === "t") as TextDrawable).pos).toEqual((base.drawables.find((d) => d.id === "t") as TextDrawable).pos);
  });
});
