// Every branch label must read as the label of ITS branch. Reviewers found
// "Grows (p=0.53)" sitting on the edge to "Never operated" and "Stable
// (p=0.45)" on the edge to 12.6 — each label had slid into the neighbouring
// branch's wedge (2026-09-27). Asserted on the finished layout, under the
// test metrics and under narrower and wider ones (the browser's real font is
// neither), for the failing tree, plain fans and the bundled examples.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { leafDrawables, type Pt } from "../src/layout/model";
import { bboxOfText } from "../src/layout/geometry";
import { heuristicMeasure, type MeasureFn } from "../src/layout/measure";
import examples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";
import type { DecisionTreeParams, TreeNode } from "../src/scenes/decision_tree/layout";
import type { Spec } from "../src/spec/types";

const t = (id: string, label: string, payoff: number): TreeNode => ({ id, type: "terminal", label, payoff });

const aneurysm: DecisionTreeParams = {
  root: {
    id: "choice",
    type: "decision",
    label: "Small aneurysm",
    children: [
      { label: "Repair now", node: t("repair", "Repaired", 12.4) },
      {
        label: "Watch",
        node: {
          id: "watch",
          type: "chance",
          label: "Surveillance",
          children: [
            { label: "Bursts", probability: 0.02, node: t("burst", "Rupture", 2) },
            { label: "Grows", probability: 0.53, node: t("grow", "Repaired later", 12.6) },
            { label: "Stable", probability: 0.45, node: t("stable", "Never operated", 13) },
          ],
        },
      },
    ],
  },
};

const twoArms: DecisionTreeParams = {
  root: {
    id: "choice",
    type: "decision",
    label: "Treatment choice",
    children: [
      {
        label: "Surgery",
        node: {
          id: "surgery",
          type: "chance",
          label: "Surgery",
          children: [
            { label: "Success", probability: 0.9, node: t("s_ok", "Full recovery", 9.5) },
            { label: "Complication", probability: 0.1, node: t("s_bad", "Complication", 4) },
          ],
        },
      },
      {
        label: "Medication",
        node: {
          id: "med",
          type: "chance",
          label: "Medication",
          children: [
            { label: "Controlled", probability: 0.7, node: t("m_ok", "Controlled", 7.5) },
            { label: "Not controlled", probability: 0.3, node: t("m_bad", "Still ill", 5) },
          ],
        },
      },
    ],
  },
};

const fan = (n: number): DecisionTreeParams => ({
  root: {
    id: "r",
    type: "chance",
    label: "Outcome",
    children: Array.from({ length: n }, (_, i) => ({ label: `Way ${i + 1}`, probability: Number((1 / n).toFixed(2)), node: t(`t${i}`, `End ${i + 1}`, i) })),
  },
});

const bundled = [...(examples as { spec?: Spec }[]), ...(fewshots as { spec?: Spec }[])]
  .map((e) => e.spec)
  .filter((s): s is Spec => s?.template === "decision_tree");

const specOf = (params: DecisionTreeParams): Spec => ({ title: "t", template: "decision_tree", params, commands: [] }) as unknown as Spec;

const scaled = (k: number): MeasureFn => (text, size) => {
  const m = heuristicMeasure(text, size);
  return { w: m.w * k, h: m.h };
};

type Seg = [Pt, Pt];
const mid = ([a, b]: Seg): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const lineY = ([a, b]: Seg, x: number) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);

function distToSegment(p: Pt, [a, b]: Seg): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/** Each branch label with its box, its own edge, and the other edges leaving the same parent. */
function branchLabels(spec: Spec, measure: MeasureFn) {
  const r = layoutSpec(structuredClone(spec), measure);
  const leaves = leafDrawables(r.drawables);
  const edges = new Map<string, Seg>();
  for (const d of leaves) if (d.kind === "stroke" && d.id.startsWith("edge_")) edges.set(d.id, [d.pts[0], d.pts[d.pts.length - 1]]);
  const out: { id: string; centre: Pt; corners: Pt[]; own: Seg; siblings: [string, Seg][] }[] = [];
  for (const d of leaves) {
    if (d.kind !== "text" || !d.id.startsWith("branchlabel_")) continue;
    const edgeId = d.id.replace(/^branchlabel_/, "edge_");
    const own = edges.get(edgeId)!;
    // Siblings share the parent end of the edge.
    const siblings = [...edges.entries()].filter(([k, e]) => k !== edgeId && dist(e[0], own[0]) < 1);
    const b = bboxOfText(d, measure);
    const corners: Pt[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    out.push({ id: d.id, centre: d.pos, corners, own, siblings });
  }
  return out;
}

const cases: [string, Spec][] = [
  ["the aneurysm tree (a three-way fan under a decision)", specOf(aneurysm)],
  ["two arms of two-way fans", specOf(twoArms)],
  ["a three-way fan", specOf(fan(3))],
  ["a four-way fan", specOf(fan(4))],
  ...bundled.map((s): [string, Spec] => [`bundled "${s.title}"`, s]),
];

describe.each([0.85, 1, 1.15])("branch labels belong to their own branch (text width ×%s)", (k) => {
  test.each(cases)("%s", (_name, spec) => {
    const labels = branchLabels(spec, scaled(k));
    expect(labels.length).toBeGreaterThan(0);
    for (const { id, centre, corners, own, siblings } of labels) {
      // Along its own branch: not run out past the child node, where it
      // reads as a note on the next column (the old "Grows (p=0.53)" ran
      // 80 units past its triangle, under the terminal below).
      for (const c of corners) {
        expect(c[0], `${id}: runs past its branch`).toBeGreaterThanOrEqual(own[0][0] - 30);
        expect(c[0], `${id}: runs past its branch`).toBeLessThanOrEqual(own[1][0] + 30);
      }
      for (const [sib, edge] of siblings) {
        // Nearer its own edge than any sibling — by midpoint and by the line.
        expect(dist(centre, mid(own)), `${id}: nearer the midpoint of ${sib}`).toBeLessThan(dist(centre, mid(edge)));
        expect(distToSegment(centre, own), `${id}: nearer the line of ${sib}`).toBeLessThan(distToSegment(centre, edge));
        // Never across a sibling: the whole box is on the side of the
        // sibling's line that its own branch is on.
        for (const c of corners) {
          const ownSide = Math.sign(lineY(own, c[0]) - lineY(edge, c[0]));
          expect(Math.sign(c[1] - lineY(edge, c[0])), `${id}: crosses ${sib}`).toBe(ownSide);
        }
      }
    }
    // No two labels share the wedge between two sibling branches: the wedge
    // is counted by how many of the fan's lines run above the label.
    const seen = new Map<string, string>();
    for (const l of labels) {
      const fanLines = [l.own, ...l.siblings.map(([, e]) => e)];
      const over = fanLines.filter((e) => lineY(e, l.centre[0]) > l.centre[1]).length;
      if (over === 0 || over === fanLines.length) continue; // outside the fan
      const wedge = `${l.own[0].map(Math.round).join(",")}#${over}`;
      expect(seen.get(wedge), `${l.id} shares a wedge with ${seen.get(wedge)}`).toBeUndefined();
      seen.set(wedge, l.id);
    }
  });
});

test("the failing tree's outer labels sit outside their fan", () => {
  const byId = new Map(branchLabels(specOf(aneurysm), heuristicMeasure).map((l) => [l.id, l]));
  const above = (id: string) => {
    const l = byId.get(id)!;
    return l.centre[1] > lineY(l.own, l.centre[0]); // logical y is up
  };
  expect(above("branchlabel_watch_burst")).toBe(true);
  expect(above("branchlabel_watch_stable")).toBe(false);
});
