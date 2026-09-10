// Curve sampling shared by scenes and tier-2 layout. Everything works on
// normalized [0,1]×[0,1] "shape space" and is then mapped by the caller.

import { compileExpression } from "../spec/expression";
import { exprVariables, type Vars } from "../spec/vars";
import type { Pt } from "./model";

export const CURVE_SAMPLES = 60;

const STEEPNESS: Record<string, number> = { gentle: 0.55, medium: 1, steep: 1.5 };

/**
 * Qualitative curve in shape space: x in [0,1] → y in [0,1].
 * Curvature is relative to the curve's own run (convex = bowed toward the
 * origin corner for decreasing curves — the classic demand-curve look).
 */
export function qualitativeShape(
  direction: "increasing" | "decreasing" | "flat" | "vertical",
  curvature: "linear" | "convex" | "concave" = "linear",
  steepness: "gentle" | "medium" | "steep" | number = "medium",
): Pt[] {
  const k = Math.max(0.05, typeof steepness === "number" ? steepness : STEEPNESS[steepness] ?? 1);
  const pts: Pt[] = [];
  const lo = Math.max(0.06, 0.5 - 0.42 * k);
  const hi = Math.min(0.94, 0.5 + 0.42 * k);
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    let shape: number;
    if (curvature === "convex") {
      shape = (Math.exp(2.6 * t) - 1) / (Math.exp(2.6) - 1);
    } else if (curvature === "concave") {
      shape = (1 - Math.exp(-2.6 * t)) / (1 - Math.exp(-2.6));
    } else {
      shape = t;
    }
    let y: number;
    switch (direction) {
      case "increasing":
        y = lo + (hi - lo) * shape;
        break;
      case "decreasing":
        y = hi - (hi - lo) * shape;
        break;
      case "flat":
        y = 0.5;
        break;
      case "vertical":
        y = lo + (hi - lo) * t;
        break;
    }
    const x = direction === "vertical" ? 0.5 : t;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Oscillation budget for expression curves. A polyline with at most this many
 * turns (local y-extrema) keeps the plain CURVE_SAMPLES grid — 60 samples give
 * ≥ 12 per half-wave there, and every existing layout stays byte-identical.
 * Beyond it the curve is resampled at CURVE_TURN_SAMPLES per half-wave.
 */
export const CURVE_MAX_PLAIN_TURNS = 4;
export const CURVE_TURN_SAMPLES = 24;
export const CURVE_MAX_SAMPLES = 720;

/** Number of local y-extrema (sign changes of consecutive dy, flat steps skipped) along a polyline. */
export function turnsOf(pts: readonly Pt[]): number {
  let turns = 0;
  let prev = 0;
  for (let i = 1; i < pts.length; i++) {
    const dy = pts[i][1] - pts[i - 1][1];
    if (dy === 0) continue;
    const sign = dy > 0 ? 1 : -1;
    if (prev !== 0 && sign !== prev) turns++;
    prev = sign;
  }
  return turns;
}

/**
 * Sample an explicit expression y = f(x) over [x0, x1] in domain units; the
 * spec's `vars` are read by name (design 2026-09-10 §2.1). The sample count is
 * adaptive: a first pass on the CURVE_SAMPLES grid is kept as-is unless the
 * curve oscillates (more than CURVE_MAX_PLAIN_TURNS turns — sin(4x) over
 * eight periods looked polygonal at 61 points), in which case it is resampled
 * with CURVE_TURN_SAMPLES points per half-wave. Deterministic and pure.
 */
export function sampleExpression(expr: string, x0: number, x1: number, vars: Vars = {}): Pt[] {
  const f = compileExpression(expr, exprVariables(vars));
  const sample = (n: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      // vars last: a var named t or q shadows that alias of x (spec/vars.ts).
      const y = f({ x, X: x, q: x, Q: x, t: x, T: x, ...vars });
      if (Number.isFinite(y)) pts.push([x, y]);
    }
    return pts;
  };
  const plain = sample(CURVE_SAMPLES);
  if (plain.length < 2) throw new Error(`expression "${expr}" produced no finite points over [${x0}, ${x1}]`);
  const turns = turnsOf(plain);
  if (turns <= CURVE_MAX_PLAIN_TURNS) return plain;
  const n = Math.min(CURVE_MAX_SAMPLES, Math.max(CURVE_SAMPLES, turns * CURVE_TURN_SAMPLES));
  const fine = sample(n);
  return fine.length >= 2 ? fine : plain;
}

/** Interpolate a polyline (sorted by x) at a given x. */
export function interpolateAtX(pts: Pt[], x: number): number | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[i + 1];
    if ((x >= xa && x <= xb) || (x >= xb && x <= xa)) {
      const t = xb === xa ? 0 : (x - xa) / (xb - xa);
      return ya + t * (yb - ya);
    }
  }
  return null;
}

/** Find an intersection of two polylines sampled over a shared x range. */
export function intersectPolylines(a: Pt[], b: Pt[]): Pt | null {
  const x0 = Math.max(Math.min(...a.map((p) => p[0])), Math.min(...b.map((p) => p[0])));
  const x1 = Math.min(Math.max(...a.map((p) => p[0])), Math.max(...b.map((p) => p[0])));
  if (x1 <= x0) return null;
  const N = 200;
  let prevDiff: number | null = null;
  let prevX = x0;
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const ya = interpolateAtX(a, x);
    const yb = interpolateAtX(b, x);
    if (ya === null || yb === null) continue;
    const diff = ya - yb;
    if (prevDiff !== null && (diff === 0 || (diff > 0) !== (prevDiff > 0))) {
      // linear refinement between prevX and x
      const t = prevDiff / (prevDiff - diff);
      const xi = prevX + t * (x - prevX);
      const yi = interpolateAtX(a, xi);
      if (yi !== null) return [xi, yi];
    }
    prevDiff = diff;
    prevX = x;
  }
  return null;
}

/** Invert a monotone-ish polyline: find x where y(x) = target. */
export function solveForX(pts: Pt[], targetY: number): number | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[i + 1];
    if ((targetY >= ya && targetY <= yb) || (targetY >= yb && targetY <= ya)) {
      const t = yb === ya ? 0 : (targetY - ya) / (yb - ya);
      return xa + t * (xb - xa);
    }
  }
  return null;
}
