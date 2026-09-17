// Arrow round 2 (Hans 2026-09-17): "the line of the arrow is not really
// smooth when it bends" — a bowed edge was a Catmull-Rom through three
// points with duplicated ends, 20 samples, flat at both ends and bent in
// the middle; and "an arrow from one state to another and another back are
// too close (both head and lines)" — both edges of a reverse pair trimmed
// their endpoints along the straight chord, so they attached to the SAME
// two boundary points. A bowed edge is now a quadratic through its bow
// point, sampled finely, and it meets the node where its own curve arrives.
import { describe, expect, test } from "vitest";
import { kit } from "../src/scenes/kit";
import type { Pt, StrokeDrawable } from "../src/layout/model";

const A: Pt = [300, 400];
const B: Pt = [700, 400];
const RX = 80;
const RY = 45;
const edge = (from: Pt, to: Pt, curve: number): Pt[] =>
  (kit.edgeArrow("e", from, to, { curve, shorten: { ellipse: [RX, RY] } }).drawables[0] as StrokeDrawable).pts;

const turn = (p: Pt, q: Pt, r: Pt): number => {
  const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

describe("a bowed edge is a smooth arc", () => {
  test("many samples, no turn between consecutive segments above a few degrees, and the bow is where it was asked for", () => {
    const pts = edge(A, B, 0.2);
    expect(pts.length).toBeGreaterThanOrEqual(30);
    for (let i = 1; i + 1 < pts.length; i++) expect(turn(pts[i - 1], pts[i], pts[i + 1])).toBeLessThan(0.12);
    // The bow: with +curve the midpoint sits (-uy, ux) * curve * chord off the chord — here straight up by 0.2 * 400 = 80.
    const top = pts.reduce((b, p) => (p[1] > b[1] ? p : b));
    expect(top[1]).toBeCloseTo(480, -1);
    expect(top[0]).toBeCloseTo(500, -1);
  });
  test("a straight edge is unchanged: two points on the chord", () => {
    const pts = edge(A, B, 0);
    expect(pts).toHaveLength(2);
    expect(pts[0][1]).toBe(400);
    expect(pts[1][1]).toBe(400);
  });
});

describe("a reverse pair attaches to separate boundary points", () => {
  test("A→B and B→A, both bowed, leave each node from different places", () => {
    const ab = edge(A, B, 0.2);
    const ba = edge(B, A, 0.2);
    const tipAtB = ab[ab.length - 1];
    const startAtB = ba[0];
    const tipAtA = ba[ba.length - 1];
    const startAtA = ab[0];
    expect(Math.hypot(tipAtB[0] - startAtB[0], tipAtB[1] - startAtB[1])).toBeGreaterThan(30);
    expect(Math.hypot(tipAtA[0] - startAtA[0], tipAtA[1] - startAtA[1])).toBeGreaterThan(30);
    // And each endpoint still sits on the ellipse (plus the breathing gap).
    const norm = (p: Pt, c: Pt) => Math.hypot((p[0] - c[0]) / RX, (p[1] - c[1]) / RY);
    for (const [p, c] of [[tipAtB, B], [startAtB, B], [tipAtA, A], [startAtA, A]] as [Pt, Pt][]) {
      expect(norm(p, c)).toBeGreaterThanOrEqual(1);
      expect(norm(p, c)).toBeLessThanOrEqual(1.15);
    }
  });
});
