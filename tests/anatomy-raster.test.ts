import { describe, expect, test } from "vitest";
import { Mask } from "../scripts/anatomy/raster.mjs";
import { ringArea } from "../scripts/anatomy/geom.mjs";

describe("Mask", () => {
  test("a filled square covers its area to within one cell of boundary", () => {
    const m = new Mask(100, 100, 1); // 100 × 100 cells of 1 unit
    m.fillTriangle([10, 10], [60, 10], [60, 60]);
    m.fillTriangle([10, 10], [60, 60], [10, 60]);
    expect(m.covered()).toBeGreaterThan(50 * 50 * 0.95);
    expect(m.covered()).toBeLessThan(50 * 50 * 1.08);
  });

  test("contours a square into one ring of about the right area, in atlas units", () => {
    const m = new Mask(100, 100, 2, [0, 0]); // cell 2 → 200 × 200 atlas units
    m.fillTriangle([20, 20], [120, 20], [120, 120]);
    m.fillTriangle([20, 20], [120, 120], [20, 120]);
    const rings = m.rings();
    expect(rings.length).toBe(1);
    expect(rings[0].holes).toEqual([]);
    expect(ringArea(rings[0].outer)).toBeGreaterThan(100 * 100 * 0.9);
    expect(ringArea(rings[0].outer)).toBeLessThan(100 * 100 * 1.1);
    const xs = rings[0].outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(15);
    expect(Math.max(...xs)).toBeLessThan(125);
  });

  test("a square with a square hole becomes one outer ring with one hole", () => {
    const m = new Mask(100, 100, 1);
    m.fillTriangle([10, 10], [90, 10], [90, 90]);
    m.fillTriangle([10, 10], [90, 90], [10, 90]);
    const hole = new Mask(100, 100, 1);
    hole.fillTriangle([40, 40], [60, 40], [60, 60]);
    hole.fillTriangle([40, 40], [60, 60], [40, 60]);
    m.subtract(hole);
    const rings = m.rings();
    expect(rings.length).toBe(1);
    expect(rings[0].holes.length).toBe(1);
    expect(ringArea(rings[0].holes[0])).toBeGreaterThan(20 * 20 * 0.8);
  });

  test("two separate squares become two rings", () => {
    const m = new Mask(100, 100, 1);
    m.fillTriangle([5, 5], [25, 5], [25, 25]); m.fillTriangle([5, 5], [25, 25], [5, 25]);
    m.fillTriangle([60, 60], [90, 60], [90, 90]); m.fillTriangle([60, 60], [90, 90], [60, 90]);
    expect(m.rings().length).toBe(2);
  });

  test("the origin offsets atlas coordinates", () => {
    const m = new Mask(50, 50, 1, [1000, 2000]);
    m.fillTriangle([1010, 2010], [1030, 2010], [1030, 2030]);
    m.fillTriangle([1010, 2010], [1030, 2030], [1010, 2030]);
    const xs = m.rings()[0].outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(1005);
  });
});
