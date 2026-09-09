import { describe, expect, test } from "vitest";
import { dimensionLine, formatMeasure, measureValue, ringArea, ringPerimeter } from "../src/layout/measures";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
const textOf = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { text?: string } | undefined)?.text;

describe("measure geometry", () => {
  test("area, perimeter, length, format", () => {
    const sq: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(ringArea(sq)).toBe(10000);
    expect(ringArea([...sq].reverse())).toBe(10000); // orientation-free
    expect(ringPerimeter(sq)).toBe(400);
    expect(measureValue("length", { a: [0, 0], b: [30, 40] })).toBe(50);
    expect(measureValue("width", { ring: sq })).toBe(100);
    expect(measureValue("area", { a: [0, 0] })).toBeNull();
    expect(formatMeasure(10000, { label: "{value}", scale: 1 })).toBe("10000");
    expect(formatMeasure(50, { label: "b = {value}", scale: 1 })).toBe("b = 50.0");
    expect(formatMeasure(250, { label: "{value}", scale: 100, unit: "cm", decimals: 1 })).toBe("2.5 cm");
  });
  test("dimensionLine offsets to the left of a→b, with ticks and the text further out", () => {
    const d = dimensionLine([0, 0], [100, 0], 24, "left");
    expect(d.line).toEqual([[0, 24], [100, 24]]);
    expect(d.ticks).toHaveLength(2);
    expect(d.textPos).toEqual([50, 40]);
    expect(dimensionLine([0, 0], [100, 0], 24, "right").line[0][1]).toBe(-24);
  });
});

describe("measure element (design §2.3)", () => {
  const sq = { id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]], style: { fill: "#87a878" } };
  test("area of a polygon by default, as a text label_<id> at the centroid, recorded in layout.measures", () => {
    const out = layoutSpec(spec([sq, { id: "ar", type: "measure", of: "sq", label: "A = {value}" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_ar")).toBe("A = 10000");
    expect(out.order).toContain("label_ar");
    expect(out.measures.ar).toMatchObject({ of: "sq", what: "area", lineId: "ar", textId: "label_ar" });
    const t = flattenDrawables(out.drawables).find((d) => d.id === "label_ar") as { pos: [number, number] };
    expect(t.pos).toEqual([250, 250]);
  });
  test("a segment between two anchors draws a dimension line away from the element with ticks and the length", () => {
    const out = layoutSpec(spec([sq, { id: "side", type: "measure", from: { ref: "sq", anchor: "vertex_1" }, to: { ref: "sq", anchor: "vertex_2" }, label: "b = {value}", unit: "px" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_side")).toBe("b = 100 px");
    const line = flattenDrawables(out.drawables).find((d) => d.id === "side") as { pts: [number, number][] };
    expect(line.pts[0][1]).toBe(176); // below the bottom edge, away from the square's centroid
    expect(flattenDrawables(out.drawables).some((d) => d.id === "side_guides")).toBe(true);
    expect(out.measures.side.from).toEqual({ ref: "sq", anchor: "vertex_1" });
  });
  test("what: width/height/perimeter of an element; length of an arrow; scale and decimals", () => {
    const out = layoutSpec(spec([sq, { id: "arr", type: "arrow", from: { x: 500, y: 500 }, to: { x: 560, y: 580 } },
      { id: "w", type: "measure", of: "sq", what: "width", scale: 50, unit: "cm" },
      { id: "p", type: "measure", of: "sq", what: "perimeter" },
      { id: "l", type: "measure", of: "arr", decimals: 2 }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_w")).toBe("2.0 cm");
    expect(textOf(out, "label_p")).toBe("400");
    expect(textOf(out, "label_l")).toBe("100.00");
    expect(out.measures.l.what).toBe("length");
  });
  test("schema: needs of, or from and to", () => {
    expect(validateSpec(spec([{ id: "m", type: "measure" }])).ok).toBe(false);
    expect(validateSpec(spec([sq, { id: "m", type: "measure", of: "sq" }])).ok).toBe(true);
  });
});
