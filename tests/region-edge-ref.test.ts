// Hans 2026-09-10: in "Demand shifts, the equilibrium follows" the surplus
// wedge was right before the shift and wrong after — its right edge was a
// number (30) while the equilibrium had moved to 37.5, and the moved stroke
// no longer existed left of 20. A region edge can now be a point reference,
// read where the point stands; the example drives the shift through a var.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { plotArea } from "../src/layout/canvas";
import { flattenDrawables } from "../src/layout/model";
import { definitionalRefs } from "../src/spec/deps";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const plot = plotArea();
const toDomX = (x: number) => ((x - plot.x0) / (plot.x1 - plot.x0)) * 100;
const regionX = (spec: Spec, id = "surplus") => {
  const l = layoutSpec(spec);
  const r = flattenDrawables(l.drawables).find((d) => d.id === id) as { pts: [number, number][] };
  const xs = r.pts.map((p) => toDomX(p[0]));
  return { min: Math.min(...xs), max: Math.max(...xs), warnings: l.warnings };
};

const base: Spec = {
  domain: { x: [0, 100], y: [0, 100] },
  vars: { s: 0 },
  elements: [
    { id: "demand", type: "curve", expr: "80 + s - x", x_from: 5, x_to: 75 },
    { id: "supply", type: "curve", expr: "20 + x", x_from: 5, x_to: 75 },
    { id: "eq", type: "point", at: { intersection_of: ["demand", "supply"] } },
    { id: "surplus", type: "region", between: ["demand", "supply"], x_from: 5, x_to: { ref: "eq" } },
  ],
  commands: [{ draw: ["demand", "supply", "eq", "surplus"] }],
};

describe("a region edge that stops at a point", () => {
  test("validates, and the point is one of the region's definitional references", () => {
    expect(validateSpec(base).ok).toBe(true);
    expect(definitionalRefs(base.elements![3])).toEqual(["demand", "supply", "eq"]);
  });

  test("the edge reads the point's x: at the equilibrium, and follows it when a var moves the curve", () => {
    const at0 = regionX(base);
    expect(at0.warnings).toEqual([]);
    expect(at0.min).toBeCloseTo(5, 5);
    expect(at0.max).toBeCloseTo(30, 5);
    const at15 = regionX({ ...base, vars: { s: 15 } });
    expect(at15.warnings).toEqual([]);
    expect(at15.min).toBeCloseTo(5, 5);
    expect(at15.max).toBeCloseTo(37.5, 5);
  });

  test("declared before the point it stops at, the region is still built after it", () => {
    const els = base.elements!;
    const spec = { ...base, elements: [els[0], els[1], els[3], els[2]] };
    const r = regionX(spec);
    expect(r.warnings).toEqual([]);
    expect(r.max).toBeCloseTo(30, 5);
  });

  test("a reference to nothing warns and falls back to the curves' extent", () => {
    const spec = { ...base, elements: base.elements!.map((e) => (e.id === "surplus" ? { ...e, x_to: { ref: "nowhere" } } : e)) };
    const r = regionX(spec);
    expect(r.warnings.some((w) => w.includes('region "surplus"') && w.includes('"nowhere"'))).toBe(true);
    expect(r.max).toBeCloseTo(75, 5);
  });

  test("the bundled example: the wedge reaches the equilibrium before and after the shift", () => {
    const examples = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8")) as { spec?: Spec }[];
    const spec = examples.find((e) => e.spec?.title === "Demand shifts, the equilibrium follows")!.spec!;
    const before = regionX(spec);
    expect(before.max).toBeCloseTo(toDomX(elementBBoxes(layoutSpec(spec)).get("eq")!.x + elementBBoxes(layoutSpec(spec)).get("eq")!.w / 2), 0);
    const shifted = { ...spec, vars: { ...spec.vars, s: 15 } };
    const after = regionX(shifted);
    expect(after.warnings).toEqual([]);
    expect(after.min).toBeCloseTo(5, 5);
    expect(after.max).toBeCloseTo(37.5, 5);
  });
});
