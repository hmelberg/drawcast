// The label solver judges a spot the way the label–stroke lint does: a line
// through the label's CORE is a defect, a graze of its edge is not
// (2026-09-25, ledger Engine #4 — labels on curves and on the y-axis landed
// where the lint then blamed the author). In a sweep of crowded lattices the
// old solver crossed the core in 107 of 126 cases; this one in none.
import { expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";

const crowd = (sp: number, fs: number, text: string) => {
  const lines: object[] = [];
  for (let k = -6; k <= 6; k++) {
    lines.push({ id: `h${k + 6}`, type: "path", points: [[200, 400 + sp * k], [800, 400 + sp * k]] });
    lines.push({ id: `v${k + 6}`, type: "path", points: [[500 + sp * k, 200], [500 + sp * k, 600]] });
  }
  const ids = lines.map((l) => (l as { id: string }).id);
  return {
    elements: [...lines, { id: "p", type: "shape", shape: "circle", x: 500, y: 400, radius: 4 }, { id: "lab", type: "label", text, attach_to: "p", side: "above", font_size: fs }],
    commands: [{ draw: [...ids, "p", "lab"] }],
  };
};

test.each([
  [20, 18, "M"],
  [24, 24, "Demand"],
  [30, 28, "label here"],
  [36, 24, "Demand"],
])("lattice %i apart, a %i-unit %s: no line through the label's core", (sp, fs, text) => {
  const l = layoutSpec(crowd(sp, fs, text) as never, heuristicMeasure);
  expect(l.issues.filter((i) => i.rule === "overlap-label-stroke" && i.ids.includes("lab"))).toEqual([]);
});
