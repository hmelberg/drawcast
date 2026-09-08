import { describe, expect, test } from "vitest";
import { alignRing, morphPair, resamplePolyline, stretchPts } from "../src/render/morph";
import { planCommands, type PlanStep } from "../src/render/plan";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planOptionsFor } from "../src/render/index";
import { validateSpec } from "../src/spec/schema";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

type P = [number, number];
const square: P[] = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe("morph geometry", () => {
  test("resamplePolyline spaces k points evenly by arc length; a closed ring excludes the repeated start", () => {
    const open = resamplePolyline([[0, 0], [100, 0]], false, 5);
    expect(open).toEqual([[0, 0], [25, 0], [50, 0], [75, 0], [100, 0]]);
    const ring = resamplePolyline(square, true, 8);
    expect(ring).toHaveLength(8);
    expect(ring[0]).toEqual([0, 0]);
    expect(ring[2]).toEqual([100, 0]);
    expect(ring[4]).toEqual([100, 100]);
  });
  test("alignRing rotates the target's start so a ring does not twist", () => {
    const from = resamplePolyline(square, true, 8);
    const rotated = [...from.slice(3), ...from.slice(0, 3)];
    expect(alignRing(from, rotated)).toEqual(from);
  });
  test("morphPair resamples both sides to K = max(len, len, 24)", () => {
    const { from, to } = morphPair(square, true, [[0, 0], [200, 0], [200, 100], [0, 100], [0, 50]], true);
    expect(from).toHaveLength(24);
    expect(to).toHaveLength(24);
  });
  test("stretchPts scales about the pivot per axis", () => {
    expect(stretchPts([[10, 10]], [0, 0], 2, 1)).toEqual([[20, 10]]);
  });
});

const SPEC = {
  elements: [
    { id: "para", type: "polygon", points: [[200, 250], [550, 250], [700, 500], [350, 500]], style: { fill: "#87a878" } },
    { id: "rekt", type: "polygon", points: [[200, 250], [550, 250], [550, 500], [200, 500]] },
    { id: "dot", type: "shape", shape: "circle", x: 800, y: 600, radius: 20 },
  ],
  commands: [{ draw: ["para", "rekt", "dot"] }],
};

describe("morph planning", () => {
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const opts = { bboxOf: (id: string) => (id === "dot" ? { x: 780, y: 580, w: 40, h: 40 } : { x: 200, y: 250, w: 500, h: 250 }), ...planOptionsFor(SPEC as never, layout) };
  const morphStep = (plan: ReturnType<typeof planCommands>, i: number) => plan.steps[i] as Extract<PlanStep, { kind: "morph" }>;

  test("to {ref} morphs every leaf (outline and wash) to the ref's ring and stores the shape in the state", () => {
    const plan = planCommands([{ draw: ["para", "rekt"] }, { morph: { target: ["para"], to: { ref: "rekt" } } }], layout.order, opts);
    expect(plan.warnings).toEqual([]);
    const step = morphStep(plan, 1);
    expect(step.seconds).toBe(1.5);
    const leafIds = step.items[0].leaves.map((l) => l.leafId).sort();
    expect(leafIds).toEqual(["para", "para_wash"]);
    for (const l of step.items[0].leaves) expect(l.from).toHaveLength(l.to.length);
    const shape = plan.states[1].shapes.para.para;
    const xs = shape.map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(550, 6); // the parallelogram's far corner at 700 has come in to the rectangle's 550
  });
  test("stretch [2, 1] about the element's left edge doubles its width; a morphed id's anchors and box follow", () => {
    const plan = planCommands([{ draw: ["para", "dot"] }, { morph: { target: ["para"], stretch: [2, 1], pivot: { anchor: "left" } } }, { move: { target: ["dot"], to: { ref: "para", anchor: "right" } } }], layout.order, opts);
    expect(plan.warnings).toEqual([]);
    const shape = plan.states[1].shapes.para.para;
    expect(Math.max(...shape.map((p) => p[0]))).toBeCloseTo(1200, 6); // 200 + 2·(700 − 200)
    const mv = plan.steps[2] as Extract<PlanStep, { kind: "transform" }>;
    expect(mv.items[0].to.offset[0]).toBeCloseTo(1200 - 800, 6);
  });
  test("a later rotate turns about the STRETCHED centre, not the layout box's (design §2.4)", () => {
    const plan = planCommands([{ draw: ["para"] }, { morph: { target: ["para"], stretch: [4, 1], pivot: { anchor: "left" } } }, { move: { target: ["para"], rotate: 90 } }], layout.order, opts);
    expect(plan.warnings).toEqual([]);
    const pts = Object.values(plan.states[1].shapes.para).flat();
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2; // 200 + 4·(700−200) stretched about x = 200 → centre 1200
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const mv = plan.steps[2] as Extract<PlanStep, { kind: "transform" }>;
    expect(cx).toBeCloseTo(1200, 6);
    expect(mv.items[0].to.turn.pivot[0]).toBeCloseTo(cx, 6); // the layout box's centre is 450 — a different point entirely
    expect(mv.items[0].to.turn.pivot[1]).toBeCloseTo(cy, 6);
  });
  test("reset tweens back to the layout points and clears the state; a shape circle warns", () => {
    const plan = planCommands([{ draw: ["para", "dot"] }, { morph: { target: ["para"], stretch: [2, 1] } }, { morph: { target: ["para"], reset: true } }, { morph: { target: ["dot"], stretch: [2, 2] } }], layout.order, opts);
    expect(plan.states[2].shapes.para).toBeUndefined();
    expect(plan.warnings.join(" ")).toMatch(/dot/);
  });
  test("the schema requires exactly one of to / stretch / reset", () => {
    const bad = { ...SPEC, commands: [{ morph: { target: ["para"] } }] };
    expect(validateSpec(bad as never).ok).toBe(false);
    const good = { ...SPEC, commands: [{ morph: { target: ["para"], to: [[0, 0], [10, 0], [10, 10]] } }] };
    expect(validateSpec(good as never).ok).toBe(true);
  });
});

describe("setPoints on the SVG backend", () => {
  for (const style of ["clean", "sketchy"] as const) {
    test(`rebuilds the leaf's path with the new points and restores it when unlisted (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const para = mounted.elements.get("para")!;
        para.finish();
        const leaf = () => {
          const out: FakeNode[] = [];
          const walk = (n: FakeNode) => { if (n.dataset.leafId === "para") out.push(n); n.children.forEach(walk); };
          walk(container);
          return out[0];
        };
        // rough.js nests its paths one level down, so read every `d` in the subtree
        const dOf = (n: FakeNode) => {
          const out: string[] = [];
          const walk = (x: FakeNode) => { const d = x.getAttribute("d"); if (d) out.push(d); x.children.forEach(walk); };
          walk(n);
          return out.join("|");
        };
        const before = dOf(leaf());
        expect(before.length).toBeGreaterThan(0);
        para.setPoints!({ para: [[200, 250], [550, 250], [550, 500], [200, 500]] });
        const after = dOf(leaf());
        expect(after).not.toBe(before);
        para.setPoints!({});
        expect(dOf(leaf())).toBe(before);
      } finally {
        restore();
      }
    });
  }
});
