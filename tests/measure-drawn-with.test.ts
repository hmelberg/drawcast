// A measure's number comes with its dimension line: `draw: ["m"]` draws the
// line and then `label_m`. It used to wait for the cast's final implicit draw
// unless the cast named `label_m` as well — which still works, and then the
// cast decides where it is drawn.
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

const plan = (commands: object[], extra: object[] = []) => {
  const spec = {
    elements: [
      { id: "side", type: "path", points: [[300, 300], [600, 300]] },
      { id: "m", type: "measure", of: "side", unit: "cm", scale: 50 },
      { id: "sq", type: "shape", shape: "rect", x: 500, y: 550, width: 120, height: 80 },
      { id: "ar", type: "measure", of: "sq", what: "area" },
      ...extra,
    ],
    commands,
  } as unknown as Spec;
  const l = layoutSpec(spec, heuristicMeasure);
  const bb = elementBBoxes(l, heuristicMeasure);
  return planCommands(spec.commands, l.order, { bboxOf: (id) => bb.get(id) ?? null, ...planOptionsFor(spec, l) });
};
const draws = (p: ReturnType<typeof plan>) => p.steps.filter((s) => s.kind === "draw").map((s) => (s as { ids: string[] }).ids);

describe("a measure brings its number", () => {
  test("drawing the measure draws the line, then its number", () => {
    const p = plan([{ draw: ["side"] }, { draw: ["m"], speak: "Six centimetres." }]);
    expect(draws(p)[1]).toEqual(["m", "label_m"]);
  });

  test("a cast that names the label in the same draw is unchanged", () => {
    const p = plan([{ draw: ["side", "m", "label_m"] }]);
    expect(draws(p)[0]).toEqual(["side", "m", "label_m"]);
  });

  test("a cast that draws the label LATER keeps that timing", () => {
    const p = plan([{ draw: ["side", "m"] }, { speak: "How long?" }, { draw: ["label_m"], speak: "Six." }]);
    expect(draws(p)[0]).toEqual(["side", "m"]);
    expect(draws(p)[1]).toEqual(["label_m"]);
  });

  test("an area measure (no line) still draws its number by the measure's id", () => {
    const p = plan([{ draw: ["sq", "ar"] }]);
    expect(draws(p)[0]).toEqual(["sq", "label_ar"]);
  });

  test("label: false brings nothing", () => {
    const p = plan([{ draw: ["side", "q"] }], [{ id: "q", type: "measure", of: "side", label: false }]);
    expect(draws(p)[0]).toEqual(["side", "q"]);
  });
});
