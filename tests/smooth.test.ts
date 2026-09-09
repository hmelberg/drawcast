import { describe, expect, test } from "vitest";
import { catmullRom, catmullRomClosed } from "../src/layout/smooth";
import { simplifyPolyline } from "../src/layout/geometry";

describe("catmullRom", () => {
  test("passes through every input point, in order", () => {
    const pts: [number, number][] = [[0, 0], [100, 50], [200, 0], [300, 80]];
    const out = catmullRom(pts, 8);
    for (const p of pts) expect(out.some(([x, y]) => Math.abs(x - p[0]) < 1e-9 && Math.abs(y - p[1]) < 1e-9)).toBe(true);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    expect(out.length).toBe((pts.length - 1) * 8 + 1);
  });
  test("closed version wraps and does not repeat the first point", () => {
    const pts: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const out = catmullRomClosed(pts, 4);
    expect(out.length).toBe(pts.length * 4);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).not.toEqual(pts[0]);
  });
});

describe("simplifyPolyline", () => {
  test("drops collinear points and keeps corners", () => {
    const line: [number, number][] = [[0, 0], [1, 0.001], [2, 0], [3, 0], [3, 3]];
    expect(simplifyPolyline(line, 0.1)).toEqual([[0, 0], [3, 0], [3, 3]]);
  });
  test("keeps two points minimum", () => {
    expect(simplifyPolyline([[0, 0], [5, 5]], 10)).toEqual([[0, 0], [5, 5]]);
  });
});
