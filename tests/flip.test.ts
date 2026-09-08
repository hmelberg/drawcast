import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { poseOf } from "../src/render/pose";
import { poseTransform, rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { validateSpec } from "../src/spec/schema";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("flip planning", () => {
  const opts = {
    bboxOf: (id: string) => (id === "tri" ? box(100, 100, 100, 100) : id === "ax" ? box(400, 0, 0, 700) : null),
    anchorOf: (id: string, name: string) => (id === "ax" ? ({ start: [400, 0], end: [400, 700] } as Record<string, [number, number]>)[name] ?? null : null),
  };
  test("a vertical flip about the element's own centre keeps its centre and mirrors", () => {
    const plan = planCommands([{ flip: { target: ["tri"] } }], ["tri"], opts);
    const st = plan.states[0];
    expect(st.turns.tri.mirror).toBe(true);
    const c = poseOf(st.offsets.tri, st.turns.tri)([150, 150]);
    expect(c[0]).toBeCloseTo(150, 6);
    expect(c[1]).toBeCloseTo(150, 6);
    const step = plan.steps[0] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items[0].flip).toEqual({ at: [150, 150], angle: 90 });
    expect(step.seconds).toBe(1.2);
  });
  test("a flip across a drawn line sends the element to the other side", () => {
    const plan = planCommands([{ flip: { target: ["tri"], line: { from: { ref: "ax", anchor: "start" }, to: { ref: "ax", anchor: "end" } } } }], ["tri", "ax"], opts);
    const st = plan.states[0];
    const c = poseOf(st.offsets.tri, st.turns.tri)([150, 150]);
    expect(c[0]).toBeCloseTo(650, 6);
    expect(c[1]).toBeCloseTo(150, 6);
  });
  test("a line whose endpoint does not resolve warns and skips, instead of silently mirroring about the axis default", () => {
    const plan = planCommands([{ flip: { target: ["tri"], line: { from: { ref: "ax", anchor: "start" }, to: { ref: "nope" } } } }], ["tri", "ax"], opts);
    expect(plan.steps.filter((s) => s.kind === "transform")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/line/);
  });
  test("a line with two coincident endpoints warns and skips: atan2(0,0) is not a mirror direction", () => {
    const plan = planCommands([{ flip: { target: ["tri"], line: { from: [400, 300], to: [400, 300] } } }], ["tri", "ax"], opts);
    expect(plan.steps.filter((s) => s.kind === "transform")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/line/);
  });
  test("the schema accepts flip", () => {
    const spec = { elements: [{ id: "tri", type: "polygon", points: [[0, 0], [10, 0], [0, 10]] }], commands: [{ flip: { target: ["tri"], axis: "horizontal" }, speak: "Mirror it." }] };
    expect(validateSpec(spec as never).ok).toBe(true);
  });
  test("a bare-string target validates (the pieces-id form)", () => {
    const spec = { elements: [{ id: "tri", type: "polygon", points: [[0, 0], [10, 0], [0, 10]] }], commands: [{ flip: { target: "tri", axis: "horizontal" } }] };
    expect(validateSpec(spec as never).ok).toBe(true);
  });
});

describe("mirror and squash in the SVG transform", () => {
  test("a mirrored pose scales x by −s about the pivot", () => {
    expect(poseTransform(0, 0, 0, [100, 100], 1, true)).toBe("translate(100.0 650.0) scale(-1.0000 1.0000) translate(-100.0 -650.0)");
  });
  test("a squash prefixes the pose; k ≥ 1 adds nothing", () => {
    const s = poseTransform(0, 0, 0, [0, 0], 1, false, { at: [500, 375], angle: 90, k: 0.5 });
    expect(s).toContain("scale(1 0.5000)");
    expect(s!.startsWith("translate(500.0 375.0) rotate(-90.00)")).toBe(true);
    expect(poseTransform(0, 0, 0, [0, 0], 1, false, { at: [500, 375], angle: 90, k: 1 })).toBeNull();
  });
  test("setTransform writes the mirror onto every group of the element", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const spec = { elements: [{ id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]], style: { fill: "#f2c14e" } }], commands: [{ draw: ["tri"] }] };
      const layout = layoutSpec(spec as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      const mounted = await rendererFor("clean").mount(layout, spec as never, container as never);
      const tri = mounted.elements.get("tri")!;
      tri.setTransform!(0, 0, 0, [200, 166], 1, true);
      const groups: FakeNode[] = [];
      const walk = (n: FakeNode) => { if (n.dataset.leafId === "tri" || n.dataset.leafId === "tri_wash") groups.push(n); n.children.forEach(walk); };
      walk(container);
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) expect(g.getAttribute("transform")).toContain("scale(-1.0000 1.0000)");
    } finally {
      restore();
    }
  });
});
