import { describe, expect, test } from "vitest";
import { composeFlip, composeScale, composeTurn, poseOf } from "../src/render/pose";

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

describe("composeScale", () => {
  test("a first scale about the element's own point keeps the offset and stores the pivot in the original frame", () => {
    const r = composeScale([10, 5], undefined, 2, [110, 55]);
    expect(r.turn.scale).toBe(2);
    expect(r.turn.deg).toBe(0);
    close(r.turn.pivot, [100, 50]);
    close(r.offset, [10, 5]);
  });
  test("scaling about a point elsewhere moves the element: ×2 about the origin sends (10,0) to (20,0)", () => {
    const r = composeScale([0, 0], undefined, 2, [0, 0]);
    close(poseOf(r.offset, r.turn)([10, 0]), [20, 0]);
  });
  test("scale and rotation about the same current point commute: the point under the pivot never moves", () => {
    const a = composeScale([30, 0], undefined, 2, [130, 0]);
    const b = composeTurn(a.offset, a.turn, 90, [130, 0]);
    expect(b.turn.scale).toBe(2);
    close(poseOf(b.offset, b.turn)([100, 0]), [130, 0]);
    // a point 10 right of the pivot ends 20 ABOVE it (scaled ×2, then turned 90° ccw)
    close(poseOf(b.offset, b.turn)([110, 0]), [130, 20]);
  });
  test("the inverse map undoes scale", () => {
    const a = composeScale([5, 5], undefined, 0.5, [50, 50]);
    const fwd = poseOf(a.offset, a.turn);
    const inv = poseOf(a.offset, a.turn, true);
    close(inv(fwd([123, 45])), [123, 45]);
  });
});

describe("composeFlip (design §2.3)", () => {
  test("a vertical mirror through the element's own centre keeps the offset and sets mirror", () => {
    const r = composeFlip([10, 0], undefined, 90, [60, 25]); // element centre now at (60,25)
    expect(r.turn.mirror).toBe(true);
    expect(r.turn.deg % 360).toBe(0);
    close(r.offset, [10, 0]);
    close(poseOf(r.offset, r.turn)([0, 0]), [110, 0]); // current (10,0) reflected across x=60 → (110,0)
    close(poseOf(r.offset, r.turn)([50, 25]), [60, 25]); // the centre stays
  });
  test("a horizontal mirror through the origin flips y, and inverts", () => {
    const r = composeFlip([0, 0], undefined, 0, [0, 0]);
    close(poseOf(r.offset, r.turn)([3, 4]), [3, -4]);
    close(poseOf(r.offset, r.turn, true)([3, -4]), [3, 4]);
  });
  test("two flips across the same line are the identity", () => {
    const a = composeFlip([5, 7], undefined, 90, [100, 0]);
    const b = composeFlip(a.offset, a.turn, 90, [100, 0]);
    close(poseOf(b.offset, b.turn)([20, 30]), [25, 37]);
    expect(b.turn.mirror).toBe(false);
  });
  test("a flip across a 45° line through the origin swaps x and y", () => {
    const r = composeFlip([0, 0], undefined, 45, [0, 0]);
    close(poseOf(r.offset, r.turn)([3, 1]), [1, 3]);
  });
  test("a turn and a scale after a mirror keep composing exactly", () => {
    const m = composeFlip([0, 0], undefined, 90, [0, 0]); // x ↦ −x
    const t = composeTurn(m.offset, m.turn, 90, [0, 0]); // then rotate 90° about the origin
    close(poseOf(t.offset, t.turn)([1, 0]), [0, -1]); // (1,0) → (−1,0) → (0,−1)
    const s = composeScale(t.offset, t.turn, 2, [0, 0]);
    close(poseOf(s.offset, s.turn)([1, 0]), [0, -2]);
    expect(s.turn.mirror).toBe(true);
  });
});
