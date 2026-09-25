// A label attached to an outline goes on the side of it the author asked
// for — not beside the outline's middle vertex or centre, which put "above"
// a concave path or a big ellipse inside it (2026-09-25).
import { expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";

const labelPos = (spec: object, id: string) => {
  const d = flattenDrawables(layoutSpec(spec as never, heuristicMeasure).drawables).find((x) => x.id === id) as { pos: [number, number] };
  return d.pos;
};

test("above a concave (U-shaped) path: over its top edge, not in the notch", () => {
  // A U whose middle vertex is the bottom of the notch.
  const points = [[300, 600], [300, 300], [500, 300], [700, 300], [700, 600], [620, 600], [620, 380], [500, 380], [380, 380], [380, 600]];
  const spec = { elements: [{ id: "u", type: "path", points, closed: true }, { id: "lab", type: "label", text: "enzyme", attach_to: "u", side: "above" }], commands: [{ draw: ["u", "lab"] }] };
  const [, y] = labelPos(spec, "lab");
  expect(y).toBeGreaterThan(600);
});

test("left of a horizontal wave: beyond its left end", () => {
  const points = Array.from({ length: 21 }, (_, i) => [300 + i * 20, 400 + 30 * Math.sin(i)]);
  const spec = { elements: [{ id: "w", type: "path", points }, { id: "lab", type: "label", text: "C", attach_to: "w", side: "left" }], commands: [{ draw: ["w", "lab"] }] };
  const [x] = labelPos(spec, "lab");
  expect(x).toBeLessThan(300);
});

test("no side given: placed as before (the solver's own choice)", () => {
  const points = [[300, 600], [300, 300], [700, 300], [700, 600]];
  const spec = { elements: [{ id: "p", type: "path", points }, { id: "lab", type: "label", text: "x", attach_to: "p" }], commands: [{ draw: ["p", "lab"] }] };
  const [x, y] = labelPos(spec, "lab");
  // near the middle vertex [700, 300], above-right of it
  expect(Math.hypot(x - 700, y - 300)).toBeLessThan(120);
});
