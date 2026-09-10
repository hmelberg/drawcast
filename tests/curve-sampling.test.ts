// Adaptive sampling of expression curves (src/layout/curves.ts). Smooth or
// monotone curves keep the plain CURVE_SAMPLES grid byte-for-byte, so existing
// layouts and anchors never move; oscillating curves get more points so a
// high-frequency sine no longer renders as a polygon.

import { describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { CURVE_SAMPLES, sampleExpression, turnsOf } from "../src/layout/curves";
import { layoutSpec } from "../src/layout/layout";
import { drawablesForId, leafDrawables } from "../src/layout/model";
import type { Pt } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

function plainSampling(f: (x: number) => number, x0: number, x1: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / CURVE_SAMPLES;
    pts.push([x, f(x)]);
  }
  return pts;
}

/** Largest gap between the polyline and the true function at each segment's midpoint. */
function maxMidpointError(pts: Pt[], f: (x: number) => number): number {
  let worst = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[i + 1];
    const xm = (xa + xb) / 2;
    worst = Math.max(worst, Math.abs((ya + yb) / 2 - f(xm)));
  }
  return worst;
}

describe("sampleExpression adapts its sample count to oscillation", () => {
  test("sin(4x) over eight periods gets more than 60 samples and hugs the true sine", () => {
    const pts = sampleExpression("sin(4*x)", 0, 12.6);
    expect(pts.length).toBeGreaterThan(CURVE_SAMPLES + 1);
    expect(turnsOf(pts)).toBeGreaterThan(4);
    expect(maxMidpointError(pts, (x) => Math.sin(4 * x))).toBeLessThan(0.02);
    // The plain grid, by contrast, is visibly polygonal at this frequency.
    expect(maxMidpointError(plainSampling((x) => Math.sin(4 * x), 0, 12.6), (x) => Math.sin(4 * x))).toBeGreaterThan(0.05);
  });

  test("it is deterministic", () => {
    expect(sampleExpression("sin(4*x)", 0, 12.6)).toEqual(sampleExpression("sin(4*x)", 0, 12.6));
  });

  test.each<[string, number, number, (x: number) => number]>([
    ["sin(x)", 0, 12.6, (x) => Math.sin(x)],
    ["80 - x", 0, 100, (x) => 80 - x],
    ["10000*exp(0.06766*x)", 0, 40, (x) => 10000 * Math.exp(0.06766 * x)],
  ])("%s keeps exactly the plain 60-step sampling", (expr, x0, x1, f) => {
    const pts = sampleExpression(expr, x0, x1);
    expect(pts).toHaveLength(CURVE_SAMPLES + 1);
    expect(pts).toEqual(plainSampling(f, x0, x1));
  });

  test("turnsOf counts local extrema and ignores flat steps", () => {
    expect(turnsOf([[0, 0], [1, 1], [2, 2]])).toBe(0);
    expect(turnsOf([[0, 1], [1, 1], [2, 1]])).toBe(0);
    expect(turnsOf([[0, 0], [1, 1], [2, 0], [3, 1]])).toBe(2);
    expect(turnsOf([[0, 0], [1, 1], [2, 1], [3, 0]])).toBe(1);
  });
});

describe("the bundled frequency example", () => {
  const example = (bundledExamples as { request: string; spec: Spec }[]).find(
    (e) => e.request === "Why does a higher frequency squeeze the wave?",
  );

  test("draws a smooth wave at the end of the f sweep", () => {
    expect(example).toBeDefined();
    const spec = example!.spec;
    const layout = layoutSpec({ ...spec, vars: { ...(spec.vars ?? {}), f: 4 } });
    expect(layout.warnings).toEqual([]);
    const strokes = leafDrawables(drawablesForId(layout.drawables, "wave")).filter((d) => d.kind === "stroke");
    expect(strokes.length).toBeGreaterThan(0);
    const pts = strokes[0].kind === "stroke" ? strokes[0].pts : [];
    expect(pts.length).toBeGreaterThan(CURVE_SAMPLES + 1);
  });

  test("keeps the plain grid at its starting frequency", () => {
    const spec = example!.spec;
    const layout = layoutSpec(spec);
    const strokes = leafDrawables(drawablesForId(layout.drawables, "wave")).filter((d) => d.kind === "stroke");
    const pts = strokes[0].kind === "stroke" ? strokes[0].pts : [];
    expect(pts).toHaveLength(CURVE_SAMPLES + 1);
  });
});
