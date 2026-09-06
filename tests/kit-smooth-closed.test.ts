import { describe, expect, test } from "vitest";
import { kit, KIT_VERSION } from "../src/scenes/kit";

const square = [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][];

describe("kit.smoothClosed", () => {
  test("is periodic: per samples per edge, starts at the first point, no seam duplicate", () => {
    const out = kit.smoothClosed(square, 4);
    expect(out.length).toBe(16);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).not.toEqual([0, 0]);
  });

  test("rounds the corners without leaving the neighbourhood of the ring", () => {
    // A four-point square is the worst case for Catmull-Rom: each edge bows
    // out by an eighth of its length (12.5 here). Real rings have many points
    // and small turns, so the bow is a fraction of a unit.
    const out = kit.smoothClosed(square, 8);
    for (const [x, y] of out) {
      expect(x).toBeGreaterThan(-13);
      expect(x).toBeLessThan(113);
      expect(y).toBeGreaterThan(-13);
      expect(y).toBeLessThan(113);
    }
    // A corner is cut: no output point sits exactly on (100, 100) except the vertex itself.
    const near = out.filter(([x, y]) => Math.abs(x - 100) < 1 && Math.abs(y - 100) < 1);
    expect(near.length).toBe(1);
  });

  test("a ring with fewer than three points is returned as a copy", () => {
    expect(kit.smoothClosed([[1, 2], [3, 4]] as [number, number][], 4)).toEqual([[1, 2], [3, 4]]);
  });
});

describe("roughness", () => {
  test("stroke and area carry roughness into their style when asked, and not otherwise", () => {
    expect(kit.stroke("a", square, { roughness: 0.7 }).style.roughness).toBe(0.7);
    expect(kit.area("b", square, "#ccc", { roughness: 0.4 }).style.roughness).toBe(0.4);
    expect(kit.stroke("c", square).style.roughness).toBe(kit.stroke("d", square, {}).style.roughness);
  });

  test("the kit version says these exist", () => {
    expect(KIT_VERSION).toBe(8);
  });
});
