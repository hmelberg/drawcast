// A label attached to a TEMPLATE's own part (a bar of bar_chart, a cell of
// two_by_two_table) honours its side, as a label on a spec element's outline
// does: the part's anchor is its centre, so "above" started the search inside
// the bar or cell and the label landed on it (2026-10-05, an 11-part book).
import { beforeAll, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(["data"]);
});

const placed = (spec: object, label: string, part: string) => {
  const l = layoutSpec(spec as never, heuristicMeasure);
  const pos = (flattenDrawables(l.drawables).find((x) => x.id === label) as { pos: [number, number] }).pos;
  const box = elementBBoxes(l, heuristicMeasure).get(part)!;
  return { pos, box };
};

const table = {
  template: "two_by_two_table",
  params: { row_label: "Test", col_label: "Disease", row_values: ["+", "−"], col_values: ["yes", "no"], cells: [["90", "10"], ["5", "95"]] },
};

test("right of a table cell: beyond the cell's square (the grid's right edge), not beside its number inside it", () => {
  const spec = { ...table, elements: [{ id: "lab", type: "label", text: "FP", attach_to: "cell_0_1", side: "right" }], commands: [] };
  const { pos, box } = placed(spec, "lab", "grid");
  expect(pos[0]).toBeGreaterThan(box.x + box.w);
});

test("above a bar: over the bar's top, not on it", () => {
  const spec = {
    template: "bar_chart",
    params: { labels: ["A", "B", "C"], values: [3, 8, 5] },
    elements: [{ id: "lab", type: "label", text: "tallest", attach_to: "bar_2", side: "above" }],
    commands: [],
  };
  const { pos, box } = placed(spec, "lab", "bar_2");
  expect(pos[1]).toBeGreaterThan(box.y + box.h);
});
