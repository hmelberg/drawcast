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
});
