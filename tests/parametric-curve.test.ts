import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { sampleParametric } from "../src/layout/curves";
import { validateSpec } from "../src/spec/schema";
import { linearScale, plotArea } from "../src/layout/canvas";
import type { StrokeDrawable } from "../src/layout/model";

const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as StrokeDrawable | undefined;

/** Map a drawable's logical (canvas) points back to the spec's domain units, the inverse of what layout/tier2.ts's sx/sy do. */
const toDomain = (domainX: [number, number], domainY: [number, number]) => {
  const plot = plotArea();
  const ix = linearScale([plot.x0, plot.x1], domainX);
  const iy = linearScale([plot.y0, plot.y1], domainY);
  return ([x, y]: [number, number]): [number, number] => [ix(x), iy(y)];
};

const circleEl = { id: "circle", type: "curve" as const, x_expr: "cos(t)", y_expr: "sin(t)", t_from: 0, t_to: 6.2832 };
const domain = { x: [-1.5, 1.5] as [number, number], y: [-1.5, 1.5] as [number, number] };

describe("parametric curve (x_expr/y_expr in t)", () => {
  test("sampleParametric: a unit circle has 61 samples all at radius 1, the first at (1, 0)", () => {
    const pts = sampleParametric("cos(t)", "sin(t)", 0, 6.2832, {});
    expect(pts).toHaveLength(61);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    expect(pts[0][0]).toBeCloseTo(1, 9);
    expect(pts[0][1]).toBeCloseTo(0, 9);
  });

  test("layoutSpec: the curve drawable has 61 points and no warnings", () => {
    const l = layoutSpec({ domain, elements: [circleEl], commands: [] });
    const s = stroke(l, "circle");
    expect(s).toBeDefined();
    expect(s!.pts).toHaveLength(61);
    expect(l.warnings).toEqual([]);
  });

  test("bind: {t_to: 's'} sweeps the parameter — the last sample lands near (-1, 0)", () => {
    // Direct: the bound value plugged straight into sampleParametric.
    const bound = sampleParametric("cos(t)", "sin(t)", 0, 3.1416, {});
    const last = bound[bound.length - 1];
    expect(last[0]).toBeCloseTo(-1, 3);
    expect(last[1]).toBeCloseTo(0, 3);

    // Through the layout pipeline: bind + vars drives t_to, and the drawn
    // curve's last logical point maps back to the same domain point.
    const l = layoutSpec({
      domain,
      vars: { s: 3.1416 },
      elements: [{ ...circleEl, t_to: 1, bind: { t_to: "s" } }],
      commands: [],
    });
    const s = stroke(l, "circle")!;
    const back = toDomain(domain.x, domain.y)(s.pts[s.pts.length - 1] as [number, number]);
    expect(back[0]).toBeCloseTo(-1, 2);
    expect(back[1]).toBeCloseTo(0, 2);
  });

  test("a var named t is shadowed by the parameter, and the shadowing is reported", () => {
    const l = layoutSpec({ domain, vars: { t: 5 }, elements: [circleEl], commands: [] });
    const s = stroke(l, "circle")!;
    const first = toDomain(domain.x, domain.y)(s.pts[0] as [number, number]);
    // t = 5 did NOT leak into the parameter: the curve still starts at (1, 0).
    expect(first[0]).toBeCloseTo(1, 2);
    expect(first[1]).toBeCloseTo(0, 2);
    expect(l.warnings.some((w) => w.includes('curve "circle"') && w.includes("a var named t is shadowed by the parameter"))).toBe(true);
  });

  test("point.at.on a parametric curve warns and draws no dot", () => {
    const l = layoutSpec({
      domain,
      elements: [circleEl, { id: "p", type: "point", at: { x: 1, on: "circle" } }],
      commands: [],
    });
    expect(stroke(l, "p")).toBeUndefined();
    expect(l.warnings.some((w) => w.includes('curve "circle" is parametric') && w.includes("point on curve skipped"))).toBe(true);
  });

  test("point.at.intersection_of a parametric curve warns and skips", () => {
    const l = layoutSpec({
      domain,
      elements: [circleEl, { id: "line", type: "curve", expr: "x" }, { id: "p", type: "point", at: { intersection_of: ["circle", "line"] } }],
      commands: [],
    });
    expect(stroke(l, "p")).toBeUndefined();
    expect(l.warnings.some((w) => w.includes('curve "circle" is parametric') && w.includes("intersection skipped"))).toBe(true);
  });

  test("region.between a parametric curve warns and skips", () => {
    const l = layoutSpec({
      domain,
      elements: [circleEl, { id: "line", type: "curve", expr: "x" }, { id: "r", type: "region", between: ["circle", "line"] }],
      commands: [],
    });
    expect(l.drawables.some((d) => d.id === "r")).toBe(false);
    expect(l.warnings.some((w) => w.includes('curve "circle" is parametric') && w.includes("region skipped"))).toBe(true);
  });

  test("a failed x_expr/y_expr falls back to a straight line and no longer reads as parametric afterwards (review finding 6, 2026-09-10)", () => {
    // sqrt(-1) is NaN for every t, so sampleParametric finds zero finite
    // points and throws — the id is registered in ctx.parametric BEFORE
    // that throw (sampleCurveDomain adds it, then calls sampleParametric),
    // so the catch's fallback (a plain qualitative polyline) must un-register
    // it or a later point.at.on wrongly warns "is parametric" and skips a
    // curve that is, in fact, an ordinary x-monotone polyline now.
    const bad = { id: "bad", type: "curve" as const, x_expr: "sqrt(-1)", y_expr: "sin(t)", t_from: 0, t_to: 1 };
    const l = layoutSpec({ elements: [bad, { id: "p", type: "point", at: { x: 50, on: "bad" } }], commands: [] });
    expect(l.warnings.some((w) => w.includes('curve "bad"') && w.includes("using a straight line"))).toBe(true);
    expect(l.warnings.some((w) => w.includes("is parametric"))).toBe(false);
    expect(stroke(l, "p")).toBeDefined();
  });

  test("t_from equals t_to warns that the curve is a point, but still returns samples (review finding 6, 2026-09-10)", () => {
    const pointCurve = { id: "pointCurve", type: "curve" as const, x_expr: "cos(t)", y_expr: "sin(t)", t_from: 2, t_to: 2 };
    const l = layoutSpec({ domain, elements: [pointCurve], commands: [] });
    const s = stroke(l, "pointCurve");
    expect(s).toBeDefined();
    expect(s!.pts).toHaveLength(61);
    expect(l.warnings).toContain('curve "pointCurve": t_from equals t_to — the curve is a point');
  });

  test("validation refuses expr together with x_expr, and x_expr without y_expr", () => {
    const base = { commands: [] as const };
    const both = validateSpec({ ...base, elements: [{ id: "c", type: "curve", expr: "x", x_expr: "cos(t)", y_expr: "sin(t)" }] });
    expect(both.ok).toBe(false);
    expect(both.errors.some((e) => e.includes("not both"))).toBe(true);

    const lonely = validateSpec({ ...base, elements: [{ id: "c", type: "curve", x_expr: "cos(t)" }] });
    expect(lonely.ok).toBe(false);
    expect(lonely.errors.some((e) => e.includes("go together"))).toBe(true);

    const ok = validateSpec({ ...base, elements: [circleEl] });
    expect(ok.ok).toBe(true);
    expect(ok.errors).toEqual([]);
  });
});
