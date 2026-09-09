import { describe, expect, test } from "vitest";
import { dimensionLine, formatMeasure, measureValue, ringArea, ringPerimeter, segmentLength } from "../src/layout/measures";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";

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
  test("of a shape (rect or circle) is measurable — a shapeHint stroke's pts are not a literal ring", () => {
    const rect = { id: "r", type: "shape", shape: "rect", x: 100, y: 100, width: 100, height: 100 };
    const circle = { id: "c", type: "shape", shape: "circle", x: 500, y: 400, radius: 100 };
    const out = layoutSpec(
      spec([
        rect,
        circle,
        { id: "ra", type: "measure", of: "r" },
        { id: "ca", type: "measure", of: "c" },
        { id: "cp", type: "measure", of: "c", what: "perimeter" },
        { id: "cw", type: "measure", of: "c", what: "width" },
      ]),
      heuristicMeasure,
    );
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_ra")).toBe("10000"); // a 100 × 100 rect
    expect(textOf(out, "label_ca")).toBe("31416"); // π · 100²
    expect(textOf(out, "label_cp")).toBe("628"); // 2π · 100
    const line = flattenDrawables(out.drawables).find((d) => d.id === "cw") as { pts: [number, number][] };
    expect(segmentLength(line.pts[0], line.pts[1])).toBe(200); // the circle's diameter
    expect(out.measures.ca.circle).toEqual({ c: [500, 400], r: 100 });
  });
  test("label: false hides the text but the measure still records its textId", () => {
    const out = layoutSpec(spec([sq, { id: "hidden", type: "measure", of: "sq", label: false }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(flattenDrawables(out.drawables).some((d) => d.id === "label_hidden")).toBe(false);
    expect(out.measures.hidden.textId).toBe("label_hidden");
  });
  test("a wide label on a vertical measure clears its own dimension line (16 + half the label's width)", () => {
    // "r = 100" is 7 characters: heuristicMeasure gives 7 × 24 × 0.52 = 87.36
    // wide, so the centred text reaches 43.68 each way — a fixed 16 would put
    // it back across its own line. The vertical line's normal is (±1, 0), so
    // the clearance is the full 16 + 43.68 = 59.68.
    const out = layoutSpec(spec([sq, { id: "h", type: "measure", of: "sq", what: "height", label: "r = {value}" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_h")).toBe("r = 100");
    expect(out.issues.filter((i) => i.message.includes('sits on stroke "h"'))).toEqual([]);
    const w = heuristicMeasure("r = 100", 24).w;
    const line = flattenDrawables(out.drawables).find((d) => d.id === "h") as { pts: [number, number][] };
    const t = flattenDrawables(out.drawables).find((d) => d.id === "label_h") as { pos: [number, number] };
    expect(line.pts[0][0]).toBe(line.pts[1][0]); // vertical
    expect(Math.abs(t.pos[0] - line.pts[0][0])).toBeGreaterThanOrEqual(16 + w / 2);
    expect(Math.abs(t.pos[0] - line.pts[0][0])).toBeCloseTo(59.68, 6);
  });
  test("an area measure registers its text as its own group, so draw: [<id>] reveals label_<id>", () => {
    // area/perimeter draw no dimension line, so nothing else carries the id.
    const s = { elements: [{ ...sq, id: "kv" }, { id: "areal", type: "measure", of: "kv" }], commands: [{ draw: ["kv"] }, { draw: ["areal"] }] };
    const layout = layoutSpec(s as never, heuristicMeasure);
    expect(layout.warnings).toEqual([]);
    expect(layout.pieceGroups.areal).toEqual(["label_areal"]);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s as never, layout) });
    expect(plan.warnings).toEqual([]);
    const draws = plan.steps.filter((st): st is Extract<PlanStep, { kind: "draw" }> => st.kind === "draw");
    expect(draws[1].ids).toContain("label_areal");
  });
});

describe("the measure follows (design §2.3)", () => {
  const sq = { id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]], style: { fill: "#87a878" } };
  const els = [sq,
    { id: "ar", type: "measure", of: "sq", label: "A = {value}" },
    { id: "side", type: "measure", from: { ref: "sq", anchor: "vertex_1" }, to: { ref: "sq", anchor: "vertex_2" }, label: "b = {value}" },
    { id: "p", type: "point", at: { x: 600, y: 600 } },
    { id: "d", type: "measure", from: { ref: "p" }, to: { ref: "sq", anchor: "vertex_3" } }];
  const planOf = (commands: unknown[]) => {
    const s = { elements: els, commands: [{ draw: ["sq", "ar", "side", "p", "d"] }, ...commands] };
    const layout = layoutSpec(s as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    return { layout, plan: planCommands(s.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s as never, layout) }) };
  };
  test("a scale ×2 about a corner writes A ×4 and b ×2, re-points the dimension line, and moves its label", () => {
    const { plan } = planOf([{ move: { target: ["sq"], scale: 2, pivot: { anchor: "bottom_left" } } }]);
    expect(plan.warnings).toEqual([]);
    const st = plan.states[1];
    expect(st.texts.label_ar.label_ar).toBe("A = 40000");
    expect(st.texts.label_side.label_side).toBe("b = 200");
    expect(st.shapes.side.side[1][0]).toBeCloseTo(400, 6); // the line now spans 200 → 400
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.texts?.map((t) => t.id).sort()).toEqual(["label_ar", "label_d", "label_side"]);
    expect(step.extraMorphs?.some((m) => m.id === "side")).toBe(true);
    expect(st.offsets.label_side?.[0]).toBeCloseTo(50, 6); // the label slid to the new midpoint
  });
  test("a mirror keeps the area positive; a morph stretch doubles it; moving a from-ref point changes a segment measure", () => {
    const { layout, plan } = planOf([{ flip: { target: ["sq"] } }, { morph: { target: ["sq"], stretch: [2, 1] } }, { move: { target: ["p"], by: [0, -100] } }]);
    expect(plan.warnings).toEqual([]);
    expect(plan.states[1].texts.label_ar.label_ar).toBe("A = 10000");
    expect(plan.states[2].texts.label_ar.label_ar).toBe("A = 20000");
    // label_d depends on p (from) and sq (to): the flip and the stretch rewrite it, the move of p rewrites it again — every time to a different number
    const layoutText = textOf(layout, "label_d")!;
    const after1 = plan.states[1].texts.label_d.label_d;
    const after3 = plan.states[3].texts.label_d.label_d;
    expect(after1).not.toBe(layoutText);
    expect(after3).not.toBe(plan.states[2].texts.label_d.label_d);
  });
  test("a circle scales by πr² through the pose; a label:false measure re-points its line with no text to slide", () => {
    const s = {
      elements: [
        { id: "c", type: "shape", shape: "circle", x: 500, y: 400, radius: 100 },
        { id: "ca", type: "measure", of: "c", label: "A = {value}" },
        { id: "cw", type: "measure", of: "c", what: "width", label: false },
      ],
      commands: [{ draw: ["c", "ca", "cw"] }, { move: { target: ["c"], scale: 2 } }],
    };
    const layout = layoutSpec(s as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s as never, layout) });
    expect(plan.warnings).toEqual([]);
    const st = plan.states[1];
    expect(st.texts.label_ca.label_ca).toBe("A = 125664"); // π · 200²
    expect(st.texts.label_cw.label_cw).toBe("400"); // the doubled diameter
    expect(segmentLength(st.shapes.cw.cw[0], st.shapes.cw.cw[1])).toBeCloseTo(400, 6);
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    // label: false draws no text, so there is nothing to slide — only the area's label moves.
    expect(step.extraTransforms?.map((t) => t.id)).toEqual(["label_ca"]);
  });
  test("a moved figure's vertical measure slides its wide label clear of the re-pointed line", () => {
    const s = {
      elements: [sq, { id: "h", type: "measure", of: "sq", what: "height", label: "r = {value}" }],
      commands: [{ draw: ["sq", "h", "label_h"] }, { move: { target: ["sq"], by: [120, 0] } }],
    };
    const layout = layoutSpec(s as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s as never, layout) });
    expect(plan.warnings).toEqual([]);
    const st = plan.states[1];
    expect(st.texts.label_h.label_h).toBe("r = 100"); // the height is unchanged by a translation
    const w = heuristicMeasure("r = 100", 24).w; // 7 × 24 × 0.52 = 87.36
    const laidOut = (flattenDrawables(layout.drawables).find((d) => d.id === "label_h") as { pos: [number, number] }).pos;
    const textX = laidOut[0] + (st.offsets.label_h?.[0] ?? 0);
    const lineX = st.shapes.h.h[0][0]; // the re-pointed dimension line
    expect(st.shapes.h.h[0][0]).toBeCloseTo(st.shapes.h.h[1][0], 6); // still vertical
    expect(Math.abs(textX - lineX)).toBeGreaterThanOrEqual(16 + w / 2);
    expect(Math.abs(textX - lineX)).toBeCloseTo(59.68, 6);
  });
});
