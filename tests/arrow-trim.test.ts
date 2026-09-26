// An arrow between boxes stops at their edges — where its line leaves each
// box — and never runs past the next one (2026-09-25: #277's column of wide
// steps drew 400-unit arrows pointing the wrong way through every box).
import { expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";

test("a fitted column of wide steps: short arrows, pointing down, clear of the boxes", () => {
  const steps = ["1 Departementet: utredning og høring", "2 Regjeringen: lovproposisjon", "3 Fagkomiteen: innstilling"];
  const spec = {
    elements: [
      ...steps.map((t, i) => ({ id: `s${i}`, type: "node", text: t, shape: "rect" })),
      { id: "col", type: "group", members: ["s0", "s1", "s2"], layout: "column", gap: 40, fit: "left" },
      { id: "a1", type: "arrow", from: { ref: "s0" }, to: { ref: "s1" } },
      { id: "a2", type: "arrow", from: { ref: "s1" }, to: { ref: "s2" } },
    ],
    commands: [{ draw: ["col", "a1", "a2"] }],
  };
  const l = layoutSpec(spec as never, heuristicMeasure);
  expect(l.issues).toEqual([]);
  for (const id of ["a1", "a2"]) {
    const a = flattenDrawables(l.drawables).find((d) => d.id === id) as { pts: [number, number][] };
    const [p, q] = [a.pts[0], a.pts[a.pts.length - 1]];
    expect(q[1]).toBeLessThan(p[1]); // down the column
    expect(p[1] - q[1]).toBeLessThan(80);
  }
});

test("an arrow into a plain rect shape stops at its edge", () => {
  const spec = {
    elements: [
      { id: "r", type: "shape", shape: "rect", x: 500, y: 300, width: 300, height: 60 },
      { id: "a", type: "arrow", from: { x: 500, y: 600 }, to: { ref: "r" } },
    ],
    commands: [{ draw: ["r", "a"] }],
  };
  const a = flattenDrawables(layoutSpec(spec as never, heuristicMeasure).drawables).find((d) => d.id === "a") as { pts: [number, number][] };
  expect(a.pts[a.pts.length - 1][1]).toBeCloseTo(300 + 30 + 4, 0);
});
