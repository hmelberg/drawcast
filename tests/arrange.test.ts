import { describe, expect, test } from "vitest";
import { arrangeTargets } from "../src/render/arrange";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { planCommands, type PlanStep } from "../src/render/plan";
import { poseOf } from "../src/render/pose";
import type { Spec } from "../src/spec/types";

const box = (x: number, y: number, w = 40, h = 20) => ({ x, y, w, h });
const item = (id: string, x: number, y: number) => ({ id, box: box(x, y), centre: [x + 20, y + 10] as [number, number], pose: { offset: [0, 0] as [number, number], turn: undefined } });

describe("row / stack / grid / ring", () => {
  test("row lays boxes left to right with the gap, centred on at", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 500, 500), item("c", 100, 300)], "row", { at: [500, 375], gap: 10 });
    // total width 3*40 + 2*10 = 140 → starts at 430
    expect(out.map((o) => o.centre)).toEqual([[450, 375], [500, 375], [550, 375]]);
    expect(out.every((o) => o.rotate === undefined)).toBe(true);
  });
  test("stack goes bottom to top", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0)], "stack", { at: [500, 375], gap: 10 });
    expect(out.map((o) => o.centre)).toEqual([[500, 360], [500, 390]]);
  });
  test("grid wraps at columns", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0), item("c", 0, 0)], "grid", { at: [500, 375], gap: 10, columns: 2 });
    expect(out[0].centre![1]).toBe(out[1].centre![1]);
    expect(out[2].centre![1]).toBeLessThan(out[0].centre![1]);
  });
  test("ring spaces centres evenly around at", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0), item("c", 0, 0), item("d", 0, 0)], "ring", { at: [500, 375], gap: 10 });
    const r = Math.hypot(out[0].centre![0] - 500, out[0].centre![1] - 375);
    for (const o of out) expect(Math.hypot(o.centre![0] - 500, o.centre![1] - 375)).toBeCloseTo(r, 6);
  });
  test("with no at, the arrangement is centred on the targets' current centroid", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 100, 0)], "row", { gap: 0 });
    const mid = (out[0].centre![0] + out[1].centre![0]) / 2;
    expect(mid).toBeCloseTo(70, 6); // centres at 20 and 120 → centroid 70
  });
});

describe("zipper", () => {
  const piece = (k: number, n: number) => {
    const step = 360 / n;
    const mid = (k + 0.5) * step;
    return { id: `p_${k + 1}`, box: box(0, 0), centre: [0, 0] as [number, number], pose: { offset: [0, 0] as [number, number], turn: undefined }, piece: { apex: [300, 375] as [number, number], centroid: [0, 0] as [number, number], midAngle: mid, halfAngle: step / 2, radius: 120 } };
  };
  test("alternates pieces up and down along a line, apexes stepping by r·sin(halfAngle), rotated about the apex", () => {
    const n = 12;
    const out = arrangeTargets(Array.from({ length: n }, (_, k) => piece(k, n)), "zipper", { at: [600, 375], gap: 0 });
    const s = 120 * Math.sin((15 * Math.PI) / 180);
    expect(out[1].apexTo![0] - out[0].apexTo![0]).toBeCloseTo(s, 6);
    expect(out[0].apexTo![1]).toBeCloseTo(375 - 60, 6); // even: apex below the line, pointing up
    expect(out[1].apexTo![1]).toBeCloseTo(375 + 60, 6); // odd: apex above, pointing down
    expect(out[0].rotate).toBeCloseTo(90 - 15, 6); // mid-angle 15° → 90°
    expect(out[1].rotate).toBeCloseTo(-90 - 45, 6); // mid-angle 45° → -90°
    expect(out[0].pivotNow).toEqual([300, 375]);
    // the row is centred on at.x
    const xs = out.map((o) => o.apexTo![0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(600, 6);
  });
  test("a piece already turned by an earlier rotate still ends up pointing up", () => {
    const turned = { ...piece(0, 12), pose: { offset: [0, 0] as [number, number], turn: { deg: 30, pivot: [300, 375] as [number, number] } } };
    const out = arrangeTargets([turned], "zipper", { at: [600, 375], gap: 0 });
    // mid-angle 15° is already at 45°; the delta must take it the rest of the way to 90°
    expect(out[0].rotate).toBeCloseTo(90 - 15 - 30, 6);
  });
  test("an element without piece geometry falls back to row placement", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0)], "zipper", { at: [500, 375], gap: 10 });
    expect(out.map((o) => o.centre)).toEqual([[475, 375], [525, 375]]);
  });
});

describe("end to end: a pieces circle zipped by the verb", () => {
  test("every slice's apex lands on the zip line and its mid-direction points up or down", () => {
    const spec = {
      elements: [{ id: "kake", type: "pieces", of: "sectors", x: 300, y: 375, radius: 120, n: 12, style: { fill: "#f4c" } }],
    } as unknown as Spec;
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    const plan = planCommands([{ draw: ["kake"] }, { arrange: { target: "kake", layout: "zipper", at: [650, 375] } }], layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      pieceOf: (id) => layout.pieces[id] ?? null,
      expandId: (id) => layout.pieceGroups[id] ?? null,
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items).toHaveLength(12);
    const apexes = step.items.map((it, k) => {
      const g = layout.pieces[it.id];
      const apex = poseOf(it.to.offset, it.to.turn)(g.apex);
      // even slices sit below the midline pointing up, odd ones above pointing down
      expect(apex[1]).toBeCloseTo(375 + (k % 2 === 0 ? -60 : 60), 6);
      const dir = (((g.midAngle + it.to.turn.deg) % 360) + 360) % 360;
      expect(dir).toBeCloseTo(k % 2 === 0 ? 90 : 270, 6);
      return apex[0];
    });
    expect((Math.min(...apexes) + Math.max(...apexes)) / 2).toBeCloseTo(650, 6);
  });
});
