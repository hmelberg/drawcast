import { describe, expect, test } from "vitest";
import { simplify, ringArea, centroid, convexHull, blob, tube, closestPair, round1 } from "../scripts/anatomy/geom.mjs";

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe("simplify", () => {
  test("drops collinear points and keeps corners", () => {
    const noisy = [[0, 0], [5, 0.01], [10, 0], [10, 5], [10, 10], [0, 10]];
    expect(simplify(noisy, 0.5)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });
  test("never goes below three points on a ring", () => {
    expect(simplify(square, 1000).length).toBeGreaterThanOrEqual(3);
  });
});

test("ringArea is the shoelace area, orientation-free", () => {
  expect(ringArea(square)).toBe(100);
  expect(ringArea([...square].reverse())).toBe(100);
});

test("centroid averages the vertices of every ring", () => {
  expect(centroid([square])).toEqual([5, 5]);
});

test("convexHull of a plus-sign is its four arm tips", () => {
  const plus = [[5, 0], [5, 10], [0, 5], [10, 5], [5, 5], [4, 4], [6, 6]];
  const hull = convexHull(plus);
  expect(hull.length).toBe(4);
  for (const p of [[5, 0], [10, 5], [5, 10], [0, 5]]) expect(hull).toContainEqual(p);
});

describe("blob", () => {
  test("is a closed organic ring around its centre with the requested point count", () => {
    const b = blob({ c: [100, 200], rx: 30, ry: 20, wobble: 0.1, seed: 3, n: 24 });
    expect(b.length).toBe(24);
    const [cx, cy] = centroid([b]);
    expect(Math.abs(cx - 100)).toBeLessThan(2);
    expect(Math.abs(cy - 200)).toBeLessThan(2);
  });
  test("is deterministic", () => {
    expect(blob({ c: [0, 0], rx: 10, ry: 10, wobble: 0.2, seed: 7 })).toEqual(blob({ c: [0, 0], rx: 10, ry: 10, wobble: 0.2, seed: 7 }));
  });
});

describe("tube", () => {
  test("sweeps a centre line into one closed ring of the given width", () => {
    const ring = tube([[0, 0], [100, 0]], 10);
    expect(ring.length).toBeGreaterThanOrEqual(4);
    const ys = ring.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-5, 5);
    expect(Math.max(...ys)).toBeCloseTo(5, 5);
    expect(ringArea(ring)).toBeCloseTo(1000, 0);
  });
  test("a bent path still yields one simple ring", () => {
    const ring = tube([[0, 0], [50, 0], [50, 50]], 8);
    expect(ringArea(ring)).toBeGreaterThan(700);
    expect(ringArea(ring)).toBeLessThan(900);
  });
});

test("closestPair finds the nearest vertices of two rings", () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const b = [[13, 12], [30, 12], [30, 40], [13, 40]];
  const { p, q, d } = closestPair(a, b);
  expect(p).toEqual([10, 10]);
  expect(q).toEqual([13, 12]);
  expect(d).toBeCloseTo(Math.hypot(3, 2), 6);
});

test("round1 rounds to one decimal", () => {
  expect(round1([[1.234, 5.678]])).toEqual([[1.2, 5.7]]);
});
