// Arrow round (Hans 2026-09-17, "arrows are often ugly"): an arrowhead's
// direction is the tangent over the last head-length of its path, not the
// last two samples — on a smoothed curve the final segment is a few units
// long and its direction wobbles, so the head sat askew on every curved
// edge and every self-loop.
import { describe, expect, test } from "vitest";
import { arrowheadPts, ARROWHEAD_SIZE } from "../src/render/svg-backend";
import type { Pt } from "../src/layout/model";

const angleOf = (tri: [Pt, Pt, Pt]): number => {
  const [left, tip, right] = tri;
  const bx = (left[0] + right[0]) / 2;
  const by = (left[1] + right[1]) / 2;
  return Math.atan2(tip[1] - by, tip[0] - bx);
};

describe("arrowheadPts direction", () => {
  test("a straight two-point path is unchanged: the head points along it", () => {
    const tri = arrowheadPts([[0, 0], [100, 0]], "end")!;
    expect(tri[1]).toEqual([100, 0]);
    expect(angleOf(tri)).toBeCloseTo(0, 5);
  });

  test("a curved path whose last sample kinks does not tilt the head: the tangent over the last head-length wins", () => {
    // A long gentle path heading +x, ending in a 2-unit sample that veers 60°.
    const pts: Pt[] = [];
    for (let x = 0; x <= 100; x += 10) pts.push([x, 0]);
    pts.push([101, 1.7]); // the kink: 2 units at 60°
    const tri = arrowheadPts(pts, "end")!;
    expect(tri[1]).toEqual([101, 1.7]);
    // Over the last ARROWHEAD_SIZE units the path runs almost straight +x.
    expect(Math.abs(angleOf(tri))).toBeLessThan(0.15);
    // The naive last-segment direction would have been 60°.
    expect(Math.atan2(1.7, 1)).toBeGreaterThan(1.0);
  });

  test("start heads mirror the rule at the other end", () => {
    const pts: Pt[] = [[-1, 1.7]];
    for (let x = 0; x <= 100; x += 10) pts.push([x, 0]);
    const tri = arrowheadPts(pts, "start")!;
    expect(tri[1]).toEqual([-1, 1.7]);
    // Pointing −x (the head at the start points back along the path).
    expect(Math.abs(Math.abs(angleOf(tri)) - Math.PI)).toBeLessThan(0.15);
  });

  test("a path shorter than a head-length uses its whole extent", () => {
    const tri = arrowheadPts([[0, 0], [3, 0], [5, 0]], "end")!;
    expect(angleOf(tri)).toBeCloseTo(0, 5);
    expect(ARROWHEAD_SIZE).toBe(13);
  });
});

describe("arrowhead size scales with the drawing (Hans 2026-09-17: heads did not shrink in an inset)", () => {
  test("arrowheadPts takes the head size; a smaller head has shorter arms", () => {
    const big = arrowheadPts([[0, 0], [100, 0]], "end")!;
    const small = arrowheadPts([[0, 0], [100, 0]], "end", 4)!;
    const arm = (t: [Pt, Pt, Pt]) => Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]);
    expect(arm(big)).toBeCloseTo(ARROWHEAD_SIZE, 5);
    expect(arm(small)).toBeCloseTo(4, 5);
  });
});
