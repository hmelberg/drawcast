// The scratch card's look and place (Hans 2026-09-28: "ugly and slow" — a
// border sketched round twice). Now: a weak grey wash of paper with one thin
// clean border, fading in whole; pasted ON the figure (top layer), outside
// the overlap rules and label placement; at the middle of the left edge when
// no place is given; erased words-first, paper last.

import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { drawablesForId, flattenDrawables, leafDrawables, Z_TOP, type AreaDrawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { isExactArea, rendererFor } from "../src/render/svg-backend";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { validateSpec } from "../src/spec/schema";
import { SCRATCH_PAPER } from "../src/spec/scratch";
import type { Spec } from "../src/spec/types";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const card = (extra: object = {}) => ({ id: "calc", type: "scratch", work: ["3 × 4 = 12", "so twelve"], ...extra });
const specWith = (elements: object[], commands: object[] = []): Spec => ({ elements, commands } as unknown as Spec);

describe("the card's look", () => {
  const layout = () => layoutSpec(expandSpec(specWith([card()], [{ draw: ["calc"] }])), heuristicMeasure);

  test("a flat grey wash (exact, not hatch) and one thin clean border, both fading in", () => {
    const leaves = leafDrawables(drawablesForId(layout().drawables, "calc_box"));
    const wash = leaves.find((d) => d.kind === "area") as AreaDrawable;
    const edge = leaves.find((d) => d.kind === "stroke") as StrokeDrawable;
    expect(isExactArea(wash)).toBe(true);
    expect(wash.style.fill).toBe(SCRATCH_PAPER);
    expect(wash.style.opacity).toBeGreaterThan(0.9);
    expect(edge.style.roughness).toBe(0);
    expect(edge.style.strokeWidth).toBeLessThan(2);
    for (const d of [wash, edge]) {
      expect(d.drawOpts.mode).toBe("fade");
      expect(d.drawOpts.duration).toBeLessThanOrEqual(400);
    }
  });

  test("every part of it paints in the top layer, its words with no paper halo", () => {
    const l = layout();
    for (const id of ["calc_box", "calc_line_1", "calc_line_2"]) {
      for (const d of leafDrawables(drawablesForId(l.drawables, id))) expect(d.z, d.id).toBe(Z_TOP);
    }
    const words = leafDrawables(drawablesForId(l.drawables, "calc_line_1"))[0] as TextDrawable;
    expect(words.halo).toBe(false);
  });

  test("a mark on one of its lines (an answer box) is on the card too, or the paper would hide it", () => {
    const spec = expandSpec(specWith([card(), { id: "ring", type: "annotation", target: "calc_line_2", kind: "box" }], [{ draw: ["calc", "ring"] }]));
    const l = layoutSpec(spec, heuristicMeasure);
    const ring = leafDrawables(drawablesForId(l.drawables, "ring"));
    expect(ring.length).toBeGreaterThan(0);
    for (const d of ring) expect(d.z, d.id).toBe(Z_TOP);
  });

  test("the expanded card validates (draw mode fade is in the schema)", () => {
    expect(validateSpec(expandSpec(specWith([card()], [{ draw: ["calc"] }]))).errors).toEqual([]);
  });

  test("rendered sketchy, the border is ONE clean path (no double pass), and the fade reveal ends on the node's own values", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const spec = expandSpec(specWith([card()], [{ draw: ["calc"] }]));
      const l = layoutSpec(spec, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      const mounted = await rendererFor("sketchy").mount(l, spec, container as never);
      const svg = container.children[0];
      const nodes: FakeNode[] = [];
      const walk = (n: FakeNode) => {
        if (n.dataset.leafId === "calc_box") nodes.push(n);
        n.children.forEach(walk);
      };
      walk(svg);
      expect(nodes.length).toBe(1);
      const paths: FakeNode[] = [];
      const collect = (n: FakeNode) => {
        if (n.tagName === "path") paths.push(n);
        n.children.forEach(collect);
      };
      collect(nodes[0]);
      expect(paths.length).toBe(1);
      expect((paths[0].getAttribute("d") ?? "").match(/M/g)?.length).toBe(1);

      const box = mounted.elements.get("calc_box")!;
      box.setProgress(0);
      expect(nodes[0].style.opacity).toBe("0.000");
      // The paper's two leaves fade one after the other: at 0.75 the border is half up.
      box.setProgress(0.75);
      expect(Number(nodes[0].style.opacity)).toBeCloseTo(0.5 * Number(nodes[0].getAttribute("opacity") ?? "1"), 3);
      box.finish();
      expect(nodes[0].style.opacity).toBe("");
    } finally {
      restore();
    }
  });
});

describe("the card's place", () => {
  const centre = (el: object) => {
    const box = expandSpec(specWith([el])).elements!.find((e) => e.id === "calc_box")! as { points: [number, number][] };
    const xs = box.points.map((p) => p[0]);
    const ys = box.points.map((p) => p[1]);
    return { x0: Math.min(...xs), cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };

  test("no place given: the middle of the left edge", () => {
    const c = centre(card());
    expect(c.x0).toBeCloseTo(60, 0);
    expect(c.cy).toBeCloseTo(375, 0);
  });

  test("a place or an x still wins", () => {
    expect(centre(card({ at: { place: "top_right" } })).cx).toBeGreaterThan(700);
    expect(centre(card({ x: 500, y: 400 })).cx).toBeCloseTo(500, 0);
    expect(centre(card({ at: { place: "right" } })).cy).toBeCloseTo(375, 0);
  });
});

describe("pasted on top: no overlap warnings for what it covers, no labels pushed about", () => {
  const figure = [
    { id: "slash", type: "arrow", from: { x: 40, y: 300 }, to: { x: 400, y: 450 } },
    { id: "words", type: "text", text: "under the card", x: 150, y: 375 },
    { id: "dot", type: "point", at: { x: 158, y: 372 } },
    { id: "lab", type: "label", text: "Dot", attach_to: "dot" },
  ];
  const cmds = [{ draw: ["slash", "words", "dot", "lab"] }, { draw: ["calc"] }];

  test("a card over a stroke and over words raises no overlap issue", () => {
    const l = layoutSpec(expandSpec(specWith([...figure, card()], cmds)), heuristicMeasure);
    const overlaps = l.issues.filter((i) => i.rule.startsWith("overlap") && i.ids.some((id) => id.startsWith("calc")));
    expect(overlaps).toEqual([]);
  });

  test("a label lands where it would with no card at all", () => {
    const pinOf = (els: object[]) => {
      const l = layoutSpec(expandSpec(specWith(els, cmds)), heuristicMeasure);
      const t = flattenDrawables(l.drawables).find((d) => d.id === "lab") as TextDrawable;
      return t.pos;
    };
    expect(pinOf([...figure, card()])).toEqual(pinOf(figure));
  });
});

describe("erasing a card: its words first, its paper last", () => {
  test("erase of the group puts the box after the lines", () => {
    const spec = expandSpec(specWith([card()]));
    const l = layoutSpec(spec, heuristicMeasure);
    const plan = planCommands([{ draw: ["calc"] }, { erase: ["calc"] }], l.order, planOptionsFor(spec, l));
    const erase = plan.steps.find((s) => s.kind === "erase") as Extract<PlanStep, { kind: "erase" }>;
    expect(erase.ids).toEqual(["calc_line_1", "calc_line_2", "calc_box"]);
  });
});
