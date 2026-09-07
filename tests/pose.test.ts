import { describe, expect, test } from "vitest";
import { composeTurn, poseOf } from "../src/render/pose";

const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe("composeTurn", () => {
  test("first rotation about the element's own point leaves the offset alone and stores the pivot in the original frame", () => {
    const r = composeTurn([10, 5], undefined, 90, [110, 55]);
    expect(r.turn.deg).toBe(90);
    close(r.turn.pivot, [100, 50]); // pivotNow minus the offset
    close(r.offset, [10, 5]);
  });
  test("rotating about a point elsewhere moves the element: 180° about the origin sends (10,0)+offset 0 to (-10,0)", () => {
    // Element point P=(10,0) (original frame), no offset, no turn. Rotate 180° about Q=(0,0).
    const r = composeTurn([0, 0], undefined, 180, [0, 0]);
    // pose applies: rotate about pivot (0,0) by 180 then translate by offset
    const p = poseOf(r.offset, r.turn)([10, 0]);
    close(p, [-10, 0]);
  });
  test("two rotations about the same current point compose to their sum, wherever the element is", () => {
    const a = composeTurn([30, 0], undefined, 45, [130, 0]); // pivot at original (100,0)
    const b = composeTurn(a.offset, a.turn, 45, [130, 0]);
    expect(b.turn.deg).toBe(90);
    // the point under the pivot never moves
    close(poseOf(b.offset, b.turn)([100, 0]), [130, 0]);
  });
  test("a rotation about a different point is exact: the second pivot stays fixed", () => {
    const a = composeTurn([0, 0], undefined, 90, [0, 0]); // 90° about origin
    const b = composeTurn(a.offset, a.turn, 90, [50, 0]); // then 90° about the point now at (50,0)
    close(poseOf(b.offset, b.turn)(poseOf(a.offset, a.turn, true)([50, 0])), [50, 0]);
  });
});
