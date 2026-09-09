import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { unrollRings } from "../src/render/arrange";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[], commands: unknown[] = []): Spec => ({ elements, commands }) as unknown as Spec;

describe("pieces of rings (design §2.4)", () => {
  test("n annuli of equal width, innermost first, each an outer stroke, an inner stroke and a keyhole wash, with ring geometry", () => {
    const out = layoutSpec(spec([{ id: "r", type: "pieces", of: "rings", x: 300, y: 400, radius: 120, n: 4, style: { fill: "#2f6b8f" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.r).toEqual(["r_1", "r_2", "r_3", "r_4"]);
    expect(out.pieces.r_1.ring).toEqual({ rIn: 0, rOut: 30 });
    expect(out.pieces.r_4.ring).toEqual({ rIn: 90, rOut: 120 });
    expect(out.pieces.r_4.apex).toEqual([300, 400]);
    expect(out.pieces.r_4.radius).toBe(120);
    const ids = flattenDrawables(out.drawables).map((d) => d.id);
    expect(ids).toContain("r_4");
    expect(ids).toContain("r_4_body");
    expect(ids).toContain("r_4_wash");
    expect(ids).not.toContain("r_1_body");
    const wash = flattenDrawables(out.drawables).find((d) => d.id === "r_4_wash") as { pts: [number, number][] };
    const radii = wash.pts.map((p) => Math.hypot(p[0] - 300, p[1] - 400));
    expect(Math.max(...radii)).toBeCloseTo(120, 6);
    expect(Math.min(...radii)).toBeCloseTo(90, 6);
  });
  test("unrollRings: strip k is 2π·r_mid long and (rOut − rIn) high, stacked bottom-up with left ends aligned", () => {
    const piece = (k: number) => ({ id: `r_${k}`, box: { x: 0, y: 0, w: 1, h: 1 }, centre: [0, 0] as [number, number], pose: { offset: [0, 0] as [number, number], turn: undefined }, piece: { apex: [300, 400] as [number, number], centroid: [300, 400] as [number, number], midAngle: 90, halfAngle: 180, radius: 30 * k, ring: { rIn: 30 * (k - 1), rOut: 30 * k } } });
    const out = unrollRings([piece(1), piece(2), piece(3), piece(4)], [600, 400]);
    expect(out.map((o) => o.id)).toEqual(["r_1", "r_2", "r_3", "r_4"]);
    const len = (r: { rect: [number, number][] }) => r.rect[1][0] - r.rect[0][0];
    expect(len(out[3] as never)).toBeCloseTo(2 * Math.PI * 105, 6);
    expect(len(out[0] as never)).toBeCloseTo(2 * Math.PI * 15, 6);
    expect(out[0].rect[0][1]).toBeCloseTo(400 - 60, 6); // four strips of 30 → 120 high, centred on 400
    expect(out[3].rect[0][1]).toBeCloseTo(400 + 30, 6);
    expect(out[0].rect[0][0]).toBeCloseTo(out[3].rect[0][0], 6); // left ends aligned
    expect(out[3].rect[2][1] - out[3].rect[0][1]).toBeCloseTo(30, 6);
  });
  test("arrange unroll morphs every ring's leaves into its strip; a non-ring target warns and is laid out as a row", () => {
    const s = spec([{ id: "r", type: "pieces", of: "rings", x: 300, y: 400, radius: 120, n: 3, style: { fill: "#2f6b8f" } }, { id: "sq", type: "polygon", points: [[700, 100], [760, 100], [760, 160], [700, 160]] }],
      [{ draw: ["r", "sq"] }, { arrange: { target: "r", layout: "unroll", at: [600, 400], duration: 2 } }, { arrange: { target: ["sq"], layout: "unroll" } }]);
    const layout = layoutSpec(s, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s, layout) });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.extraMorphs?.map((m) => m.id)).toEqual(["r_1", "r_2", "r_3"]);
    const r3 = step.extraMorphs!.find((m) => m.id === "r_3")!;
    expect(r3.leaves.map((l) => l.leafId).sort()).toEqual(["r_3", "r_3_body", "r_3_wash"]);
    const xs = r3.leaves[0].to.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * Math.PI * 100, 0); // the resampled rectangle keeps its corners within a unit
    expect(plan.states[1].shapes.r_3).toBeDefined();
    expect(plan.warnings.join(" ")).toMatch(/unroll/);
  });
});
