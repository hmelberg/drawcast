// An expression curve that leaves the plot ENDS at the plot's edge; it is not
// pinned to it (Hans 2026-09-27: a shifted AD curve "becomes partly
// horizontal" along the top).
import { describe, expect, test } from "vitest";
import { clipToBand } from "../src/layout/tier2";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";

describe("clipToBand", () => {
  test("a line leaving through the top ends exactly on the edge", () => {
    const pts: [number, number][] = [[0, 120], [10, 110], [20, 100], [30, 90], [40, 80]];
    const { pts: out, runs } = clipToBand(pts.map(([x, y]) => [x, y - 5]) as never, 0, 100);
    expect(runs).toBe(1);
    expect(out[0]).toEqual([15, 100]);
    expect(out[out.length - 1]).toEqual([40, 75]);
  });

  test("a curve that leaves and comes back keeps its longest stretch", () => {
    const pts = Array.from({ length: 41 }, (_, i) => [i, i < 10 ? 50 : i < 15 ? 150 : 50] as [number, number]);
    const { pts: out, runs } = clipToBand(pts, 0, 100);
    expect(runs).toBe(2);
    expect(out[0][0]).toBeGreaterThan(14);
  });
});

describe("a demand curve shifted up past the plot", () => {
  test("has no flat run along the top", () => {
    const spec = {
      domain: { x: [0, 100], y: [0, 100] },
      vars: { s: 40 },
      elements: [{ id: "ax", type: "axes" }, { id: "demand", type: "curve", expr: "80 + s - x", x_from: 5, x_to: 95 }],
      commands: [{ draw: ["ax", "demand"] }],
    };
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const d = flattenDrawables(layout.drawables).find((x) => x.id === "demand") as StrokeDrawable;
    const top = Math.max(...d.pts.map(([, y]) => y));
    // at most the one point that lands ON the edge — before, every x from 5 to 20 sat there
    expect(d.pts.filter(([, y]) => Math.abs(y - top) < 1e-6).length).toBe(1);
  });
});
