// spec.adjust (layout/adjust.ts): a template's own parts — the readout card,
// the curve labels — are not spec elements, so this is the only way the look
// pass's fix round can move or enlarge them.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";
import type { Spec } from "../src/spec/types";

const base = (adjust?: Spec["adjust"]): Spec =>
  ({ template: "supply_demand", params: { tax: { amount: 18 }, readout: ["dwl", "revenue"] }, commands: [], ...(adjust ? { adjust } : {}) }) as unknown as Spec;

const text = (spec: Spec, id: string): TextDrawable =>
  flattenDrawables(layoutSpec(spec, heuristicMeasure).drawables).find((d) => d.id === id) as TextDrawable;

describe("spec.adjust", () => {
  test("move shifts every member of a group by percent of the page, right and up", () => {
    const before = text(base(), "readout_dwl_value");
    const after = text(base({ readout: { move: [-10, 20] } }), "readout_dwl_value");
    expect(after.pos[0]).toBeCloseTo(before.pos[0] - 0.1 * CANVAS.w);
    expect(after.pos[1]).toBeCloseTo(before.pos[1] + 0.2 * CANVAS.h);
    const rev0 = text(base(), "readout_revenue_name");
    const rev1 = text(base({ readout: { move: [-10, 20] } }), "readout_revenue_name");
    expect(rev1.pos[1]).toBeCloseTo(rev0.pos[1] + 0.2 * CANVAS.h);
  });

  test("scale enlarges the text of a part", () => {
    const before = text(base(), "readout_dwl_value");
    const after = text(base({ readout_dwl: { scale: 1.5 } }), "readout_dwl_value");
    expect(after.fontSize).toBeCloseTo(before.fontSize * 1.5);
  });

  test("a template label (a label request) grows too", () => {
    const before = text(base(), "label_D");
    const after = text(base({ label_D: { scale: 1.4 } }), "label_D");
    expect(after.fontSize).toBeCloseTo(before.fontSize * 1.4);
  });

  test("an id the page does not draw warns instead of doing nothing silently", () => {
    const l = layoutSpec(base({ nope: { move: [5, 0] } }), heuristicMeasure);
    expect(l.issues.map((i) => i.rule)).toContain("adjust-unknown");
  });
});
