import { describe, expect, test } from "vitest";
import { sampleSvgPath } from "../src/scenes/svgpath";

describe("sampleSvgPath arcs", () => {
  test("a circle from two half arcs has ~2πr length and 16+ points", () => {
    const rings = sampleSvgPath("M 12 2 A 10 10 0 1 1 12 22 A 10 10 0 1 1 12 2 Z", 8);
    expect(rings.length).toBe(1);
    const r = rings[0];
    expect(r.length).toBeGreaterThanOrEqual(16);
    let len = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    expect(len).toBeCloseTo(2 * Math.PI * 10, 0);
    expect(r.every(([x, y]) => Math.abs(Math.hypot(x - 12, y - 12) - 10) < 0.05)).toBe(true);
  });
  test("relative arc and zero-radius arc (a line)", () => {
    expect(sampleSvgPath("M 0 0 a 0 0 0 0 1 10 0 L 10 10 Z", 4)[0][1]).toEqual([10, 0]);
  });

  // Glued flags: the SVG grammar allows largeArc/sweep to be single digits
  // written with no separator before the next flag or coordinate — SVGO
  // minifies icon sets exactly this way. A number-hungry tokenizer misreads
  // "1120" as one number (1120) instead of flags 1,1 + x=20.
  test("glued flags ('1120' = largeArc 1, sweep 1, x 20) resolve to the right endpoint and stay in the arc's bounding box", () => {
    const [ring] = sampleSvgPath("M0 0a10 10 0 1120 0", 4);
    const last = ring[ring.length - 1];
    expect(last[0]).toBeCloseTo(20, 6);
    expect(last[1]).toBeCloseTo(0, 6);
    // rx=ry=10 and the endpoints are diametrically opposite (chord = 2r), so
    // every sampled point has to sit on the one circle of radius 10 centred
    // at (10, 0) — the glued-flag bug instead produced points wildly outside
    // this box (a "huge wrong arc" off of the misread radius/flags).
    expect(ring.every(([x, y]) => x >= -0.01 && x <= 20.01 && y >= -10.01 && y <= 10.01)).toBe(true);
  });

  test("glued flags ('0110' = largeArc 0, sweep 1, x 10) no longer throw, and reach the right endpoint", () => {
    const [ring] = sampleSvgPath("M0 0A5 5 0 0110 10", 4);
    const last = ring[ring.length - 1];
    expect(last[0]).toBeCloseTo(10, 5);
    expect(last[1]).toBeCloseTo(10, 5);
    expect(ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
