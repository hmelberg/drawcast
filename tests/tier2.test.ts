import { describe, expect, test } from "vitest";
import { layoutElements } from "../src/layout/tier2";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

function get(drawables: ReturnType<typeof layoutElements>["drawables"], id: string) {
  return flattenDrawables(drawables).find((d) => d.id === id);
}

describe("layoutElements (tier 2/3)", () => {
  test("curve with an explicit expression is sampled over the domain", () => {
    const r = layoutElements(
      [
        { id: "ax", type: "axes", x_label: "Q", y_label: "P" },
        { id: "d", type: "curve", expr: "100 - 0.5*x" },
      ] as SpecElement[],
      { x: [0, 200], y: [0, 100] },
    );
    const curve = get(r.drawables, "d") as StrokeDrawable;
    expect(curve.kind).toBe("stroke");
    const first = curve.pts[0];
    const last = curve.pts[curve.pts.length - 1];
    // Left end of a decreasing line is high, right end low, in logical y-up coords.
    expect(first[1]).toBeGreaterThan(last[1]);
    expect(curve.pts.length).toBeGreaterThan(20);
  });

  test("qualitative curves: increasing convex differs from decreasing linear", () => {
    const r = layoutElements(
      [
        { id: "up", type: "curve", direction: "increasing", curvature: "linear" },
        { id: "down", type: "curve", direction: "decreasing", curvature: "convex" },
      ] as SpecElement[],
      undefined,
    );
    const up = get(r.drawables, "up") as StrokeDrawable;
    const down = get(r.drawables, "down") as StrokeDrawable;
    expect(up.pts[0][1]).toBeLessThan(up.pts[up.pts.length - 1][1]);
    expect(down.pts[0][1]).toBeGreaterThan(down.pts[down.pts.length - 1][1]);
  });

  test("intersection point of two curves is found", () => {
    const r = layoutElements(
      [
        { id: "d", type: "curve", expr: "100 - x" },
        { id: "s", type: "curve", expr: "x" },
        { id: "eq", type: "point", at: { intersection_of: ["d", "s"] }, guides: true },
      ] as SpecElement[],
      { x: [0, 100], y: [0, 100] },
    );
    const pt = get(r.drawables, "eq") as StrokeDrawable;
    expect(pt).toBeDefined();
    const c = pt.shapeHint && pt.shapeHint.type === "circle" ? pt.shapeHint.c : pt.pts[0];
    const dCurve = get(r.drawables, "d") as StrokeDrawable;
    const sCurve = get(r.drawables, "s") as StrokeDrawable;
    const nearD = Math.min(...dCurve.pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    const nearS = Math.min(...sCurve.pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    expect(nearD).toBeLessThan(15);
    expect(nearS).toBeLessThan(15);
    expect(get(r.drawables, "eq_guides")).toBeDefined();
  });

  test("a point given angle's vertex shape ({ref, anchor}) is a defensive no-op with a warning, not a silent miss", () => {
    // validateSpec already rejects this shape on a point element (schema.test.ts);
    // this exercises the resolvePointDomain fallback directly, the way a
    // hand-built spec that skips validateSpec would reach it.
    const r = layoutElements([{ id: "p", type: "point", at: { ref: "somewhere", anchor: "vertex_1" } }] as SpecElement[], undefined);
    expect(get(r.drawables, "p")).toBeUndefined();
    expect(r.warnings).toEqual([`point "p": at must be {x, y} or {intersection_of} — {ref, anchor} is not valid on a point`]);
  });

  test("region between two curves builds a closed area", () => {
    const r = layoutElements(
      [
        { id: "d", type: "curve", expr: "100 - x" },
        { id: "s", type: "curve", expr: "x" },
        { id: "gap", type: "region", between: ["d", "s"], x_from: 0, x_to: 50 },
      ] as SpecElement[],
      { x: [0, 100], y: [0, 100] },
    );
    const region = get(r.drawables, "gap");
    expect(region?.kind).toBe("area");
    expect((region as StrokeDrawable).pts.length).toBeGreaterThan(10);
  });

  test("free nodes get distinct deterministic positions and edges connect them", () => {
    const els: SpecElement[] = [
      { id: "healthy", type: "node", shape: "circle", text: "Healthy" },
      { id: "sick", type: "node", shape: "circle", text: "Sick" },
      { id: "dead", type: "node", shape: "circle", text: "Dead" },
      { id: "e1", type: "edge", from: { ref: "healthy" }, to: { ref: "sick" } },
    ];
    const a = layoutElements(els, undefined);
    const b = layoutElements(els, undefined);
    const posA = ["healthy", "sick", "dead"].map((id) => {
      const d = get(a.drawables, id) as StrokeDrawable;
      return d.shapeHint && d.shapeHint.type === "circle" ? d.shapeHint.c : d.pts[0];
    });
    // distinct positions
    expect(new Set(posA.map((p) => p.join(","))).size).toBe(3);
    // deterministic across runs
    const posB = get(b.drawables, "healthy") as StrokeDrawable;
    expect(JSON.stringify(posB)).toBe(JSON.stringify(get(a.drawables, "healthy")));
    expect(get(a.drawables, "e1")).toBeDefined();
  });

  test("arrow between two referenced elements produces a stroke with an arrowhead", () => {
    const r = layoutElements(
      [
        { id: "a", type: "node", shape: "rect", text: "A" },
        { id: "b", type: "node", shape: "rect", text: "B" },
        { id: "ar", type: "arrow", from: { ref: "a" }, to: { ref: "b" } },
      ] as SpecElement[],
      undefined,
    );
    const arrow = get(r.drawables, "ar") as StrokeDrawable;
    expect(arrow.kind).toBe("stroke");
    expect(arrow.arrowhead).toBe("end");
  });

  test("tier-3 raw text and shapes pass through in logical coordinates", () => {
    const r = layoutElements(
      [
        { id: "t", type: "text", text: "Sensitivity", x: 250, y: 600, font_size: 28 },
        { id: "box", type: "shape", shape: "rect", x: 300, y: 475, width: 200, height: 150 },
      ] as SpecElement[],
      undefined,
    );
    const t = flattenDrawables(r.drawables).find((d) => d.id === "t");
    expect(t?.kind).toBe("text");
    const box = get(r.drawables, "box") as StrokeDrawable;
    expect(box.shapeHint?.type).toBe("rect");
  });
});

describe("node width and height", () => {
  const lay = (el: object) => layoutElements([{ id: "n", type: "node", text: "Vault", x: 250, y: 250, ...el }] as SpecElement[], undefined);
  const hint = (el: object) => (get(lay(el).drawables, "n") as StrokeDrawable).shapeHint;

  test("a rect node takes its declared width and height, centred on x/y", () => {
    expect(hint({ shape: "rect", width: 320, height: 250 })).toEqual({ type: "rect", x: 90, y: 125, w: 320, h: 250 });
  });

  test("only one of width/height given keeps the other's default", () => {
    const wide = hint({ shape: "rect", width: 320 });
    expect(wide).toMatchObject({ type: "rect", w: 320, h: 62 });
    const tall = hint({ shape: "rect", height: 250 });
    expect(tall).toMatchObject({ type: "rect", h: 250 });
    expect((tall as { w: number }).w).toBeGreaterThanOrEqual(130); // the text-fitted default
  });

  test("a circle node takes width as its diameter; the larger of width/height wins", () => {
    expect(hint({ shape: "circle", width: 200 })).toEqual({ type: "circle", c: [250, 250], r: 100 });
    expect(hint({ shape: "circle", width: 120, height: 200 })).toMatchObject({ r: 100 });
    expect(hint({ shape: "chance", width: 90 })).toMatchObject({ r: 45 });
  });

  test("an edge attaches at the rim of the sized node, not at the default one", () => {
    const r = layoutElements(
      [
        { id: "n", type: "node", shape: "rect", text: "Vault", x: 250, y: 250, width: 320, height: 250 },
        { id: "m", type: "node", shape: "circle", text: "M", x: 900, y: 250 },
        { id: "e", type: "edge", from: { ref: "n" }, to: { ref: "m" } },
      ] as SpecElement[],
      undefined,
    );
    const e = get(r.drawables, "e") as StrokeDrawable;
    const start = e.pts[0];
    // The edge leaves the node at nodeRadius + 4 from its centre (half the diagonal for a rect).
    expect(Math.hypot(start[0] - 250, start[1] - 250)).toBeCloseTo(Math.hypot(320, 250) / 2 + 4, 3);
  });
});

describe("shape rect origin", () => {
  test("a shape rect with x/y/width/height is centred on x/y, like a node", () => {
    const r = layoutElements([{ id: "vault", type: "shape", shape: "rect", x: 250, y: 250, width: 320, height: 250 }] as SpecElement[], undefined);
    const s = get(r.drawables, "vault") as StrokeDrawable;
    expect(s.shapeHint).toEqual({ type: "rect", x: 90, y: 125, w: 320, h: 250 });
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(250, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(250, 6);
  });
});
