import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { poseOf } from "../src/render/pose";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[], commands: unknown[] = []): Spec => ({ elements, commands }) as unknown as Spec;

describe("pieces of triangles (design §2.4)", () => {
  test("a regular hexagon fans into six triangles from the centre with sector-like geometry and apex/base anchors", () => {
    const out = layoutSpec(spec([{ id: "t", type: "pieces", of: "triangles", x: 300, y: 400, radius: 120, sides: 6, style: { fill: "#f2c14e" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.t).toHaveLength(6);
    const g = out.pieces.t_1;
    expect(g.apex).toEqual([300, 400]);
    expect(g.halfAngle).toBeCloseTo(30, 6);
    expect(g.radius).toBeCloseTo(120, 6);
    expect(g.height).toBeCloseTo(120 * Math.cos(Math.PI / 6), 6);
    expect(out.namedAnchors.t_1.apex).toEqual([300, 400]);
    expect(Math.hypot(out.namedAnchors.t_1.base[0] - 300, out.namedAnchors.t_1.base[1] - 400)).toBeCloseTo(g.height!, 6);
    const tri = flattenDrawables(out.drawables).find((d) => d.id === "t_1") as { pts: [number, number][] };
    expect(tri.pts).toHaveLength(3);
  });
  test("zipping the six triangles makes a parallelogram of height = apothem", () => {
    const s = spec([{ id: "t", type: "pieces", of: "triangles", x: 300, y: 400, radius: 120, sides: 6, style: { fill: "#f2c14e" } }], [{ draw: ["t"] }, { arrange: { target: "t", layout: "zipper", at: [650, 400] } }]);
    const layout = layoutSpec(s, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s, layout) });
    expect(plan.warnings).toEqual([]);
    const st = plan.states[1];
    const apexY = (id: string) => poseOf(st.offsets[id], st.turns[id])(layout.pieces[id].apex)[1];
    const h = layout.pieces.t_1.height!;
    expect(apexY("t_1")).toBeCloseTo(400 - h / 2, 6);
    expect(apexY("t_2")).toBeCloseTo(400 + h / 2, 6);
  });
  test("a polygon given by points fans from vertex_1 by default, or from the named vertex", () => {
    const out = layoutSpec(spec([{ id: "q", type: "pieces", of: "triangles", points: [[100, 100], [400, 100], [400, 300], [100, 300]], from: "vertex_2" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.q).toHaveLength(2);
    expect(out.pieces.q_1.apex).toEqual([400, 100]);
  });
});

describe("pieces of halving", () => {
  test("halves alternate vertical then horizontal; the remainder is <id>_rest; all in the group", () => {
    const out = layoutSpec(spec([{ id: "h", type: "pieces", of: "halving", x: 500, y: 375, width: 400, height: 400, n: 3, style: { fill: "#2f6b8f" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.h).toEqual(["h_1", "h_2", "h_3", "h_rest"]);
    const box = (id: string) => { const d = flattenDrawables(out.drawables).find((x) => x.id === id) as { pts: [number, number][] }; const xs = d.pts.map((p) => p[0]), ys = d.pts.map((p) => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
    expect(box("h_1")).toEqual({ x: 300, y: 175, w: 200, h: 400 });
    expect(box("h_2")).toEqual({ x: 500, y: 375, w: 200, h: 200 });
    expect(box("h_3")).toEqual({ x: 500, y: 175, w: 100, h: 200 });
    expect(box("h_rest")).toEqual({ x: 600, y: 175, w: 100, h: 200 });
  });
});
