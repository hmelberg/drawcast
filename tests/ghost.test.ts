import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { withMinted } from "../src/render/minted";
import { drawablesForId, leafDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";

const SPEC = {
  elements: [
    { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]], style: { fill: "#f2c14e" } },
    { id: "lbl", type: "label", attach_to: "tri", side: "below", text: "T" },
    { id: "dot", type: "shape", shape: "circle", x: 600, y: 600, radius: 20 },
  ],
  commands: [{ draw: ["tri", "lbl", "dot"] }],
};

function planOf(commands: unknown[]) {
  const spec = { ...SPEC, commands: [...SPEC.commands, ...commands] };
  const layout = layoutSpec(spec as never, heuristicMeasure);
  const bboxes = elementBBoxes(layout, heuristicMeasure);
  const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(spec as never, layout) });
  return { spec, layout, plan };
}

describe("keep and ghost (design §2.1)", () => {
  test("keep mints tri_ghost at the current pose, visible in the same step, below the source, at 0.3", () => {
    const { layout, plan } = planOf([{ move: { target: ["tri"], by: [100, 0] } }, { keep: { target: ["tri"] }, speak: "Keep it." }]);
    expect(plan.warnings).toEqual([]);
    expect(plan.minted.map((m) => m.kind)).toEqual(["ghost"]);
    const g = plan.minted[0] as Extract<(typeof plan.minted)[number], { kind: "ghost" }>;
    expect(g.id).toBe("tri_ghost");
    expect(g.offset).toEqual([100, 0]);
    expect(g.opacity).toBe(0.3);
    expect(g.params).toBeNull(); // tier-2: the ghost reads the layout being wrapped, never layoutAt
    expect(plan.states[2].visible).toContain("tri_ghost");
    expect(plan.states[1].visible).not.toContain("tri_ghost");
    expect(plan.steps[2]).toMatchObject({ kind: "show", ids: ["tri_ghost"], narration: "Keep it." });
    const out = withMinted(layout, plan.minted, () => layout);
    expect(out.order.indexOf("tri_ghost")).toBe(out.order.indexOf("tri") - 1); // right before its source
    const leaves = leafDrawables(drawablesForId(out.drawables, "tri_ghost"));
    expect(leaves.map((d) => d.id).sort()).toEqual(["tri_ghost", "tri_ghost_wash"]);
    const outline = leaves.find((d) => d.id === "tri_ghost") as { pts: [number, number][]; style: { opacity: number }; drawOpts: { mode: string } };
    expect(outline.pts[0]).toEqual([200, 100]); // (100,100) + the offset
    expect(outline.style.opacity).toBeCloseTo(0.3, 6);
    expect(outline.drawOpts.mode).toBe("instant");
    expect(withMinted(layout, [], () => layout)).toBe(layout);
  });
  test("ghost: true on move mints a ghost of every target before the motion; a second keep gets _2", () => {
    const { plan } = planOf([{ move: { target: ["tri", "dot"], by: [50, 50], ghost: true } }, { keep: { target: "tri", opacity: 0.5 } }]);
    expect(plan.warnings).toEqual([]);
    expect(plan.minted.map((m) => m.id)).toEqual(["tri_ghost", "dot_ghost", "tri_ghost_2"]);
    const first = plan.minted[0] as { offset: [number, number] };
    expect(first.offset).toEqual([0, 0]); // minted from the pre-move state
    expect((plan.minted[2] as { opacity: number }).opacity).toBe(0.5);
    expect(plan.states[1].visible).toEqual(expect.arrayContaining(["tri_ghost", "dot_ghost"]));
  });
  test("a ghost of a morphed source carries its current shapes; ghost: [ids] picks targets; a later erase takes the ghost", () => {
    const { plan } = planOf([
      { morph: { target: ["tri"], stretch: [2, 1] } },
      { flip: { target: ["tri"], ghost: ["tri"] } },
      { erase: ["tri_ghost"] },
    ]);
    expect(plan.warnings).toEqual([]);
    const g = plan.minted[0] as { shapes?: Record<string, unknown> };
    expect(g.shapes && Object.keys(g.shapes)).toContain("tri");
    expect(plan.states[plan.states.length - 1].visible).not.toContain("tri_ghost");
  });
  test("the schema accepts keep, ghost on the verbs and a bare-string keep target", () => {
    const ok = (commands: unknown[]) => validateSpec({ ...SPEC, commands } as never).ok;
    expect(ok([{ keep: { target: "tri" } }])).toBe(true);
    expect(ok([{ move: { target: ["tri"], by: [1, 0], ghost: { of: ["tri"], opacity: 0.2 } } }])).toBe(true);
    expect(ok([{ morph: { target: ["tri"], reset: true, ghost: true } }])).toBe(true);
    expect(ok([{ keep: {} }])).toBe(false);
  });
});

describe("ghost under animate (a template)", () => {
  test("ghost: true on animate mints ghosts of the visible template ids from the boundary layout", async () => {
    const { ensureEnabledPacks } = await import("../src/scenes/packs");
    await ensureEnabledPacks(["mathlogic"]);
    const spec = { template: "circle_sectors", params: { n: 4, t: 0 }, elements: [], commands: [{ draw: ["piece_1", "piece_2", "piece_3", "piece_4"] }, { animate: { t: 1 }, ghost: true }] };
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, animateBase: spec.params, ...planOptionsFor(spec as never, layout) });
    expect(plan.warnings).toEqual([]);
    expect(plan.minted.map((m) => m.id)).toEqual(["piece_1_ghost", "piece_2_ghost", "piece_3_ghost", "piece_4_ghost"]);
    expect((plan.minted[0] as { params: Record<string, number> }).params).toEqual({});
    const out = withMinted(layout, plan.minted, (params) => layoutSpec({ ...spec, params: { ...spec.params, ...params } } as never, heuristicMeasure));
    expect(out.order).toContain("piece_1_ghost");
    expect(out.order.indexOf("piece_1_ghost")).toBe(out.order.indexOf("piece_1") - 1);
  });
  test("a template ghost's drawables come from layoutAt, not from whatever layout is being wrapped (a live tween frame)", async () => {
    const { ensureEnabledPacks } = await import("../src/scenes/packs");
    await ensureEnabledPacks(["mathlogic"]);
    const spec = { template: "circle_sectors", params: { n: 4, t: 0 }, elements: [], commands: [{ draw: ["piece_1", "piece_2", "piece_3", "piece_4"] }, { animate: { t: 1 }, ghost: true }] };
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, animateBase: spec.params, ...planOptionsFor(spec as never, layout) });
    const calls: Record<string, number>[] = [];
    const layoutAt = (params: Record<string, number>) => {
      calls.push(params);
      return layout; // stands in for the ghost's own (base) boundary layout
    };
    // A mid-tween frame layout (t partway to 1) is what render() would hand
    // withMinted as the layout being wrapped at THIS tick — if a ghost read
    // it instead of calling layoutAt, its geometry would move with the tween.
    const frameLayout = layoutSpec({ ...spec, params: { ...spec.params, t: 0.5 } } as never, heuristicMeasure);
    withMinted(frameLayout, plan.minted, layoutAt);
    expect(calls).toEqual([{}, {}, {}, {}]); // every ghost minted at the base boundary, routed through layoutAt
  });
});
