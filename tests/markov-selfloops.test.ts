// Markov self-loop round: kit.edgeArrow's selfLoop redrawn as a true loop
// (both endpoints ON the node boundary, arrowhead re-entering the node,
// aimable via loopDir), layoutMarkovModel aims each loop into the least
// crowded angular gap around its state, stay probabilities become loop
// labels, chain layouts shrink crowded nodes, and a transition that would
// spear straight through an intermediate state bows around it instead.

import { describe, expect, test } from "vitest";
import { kit } from "../src/scenes/kit";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";
import { layoutMarkovModel, type MarkovParams } from "../src/scenes/markov_model/layout";
import type { Pt } from "../src/layout/model";

const RX = 78;
const RY = 44;

/** Normalized ellipse radius of p around center c: 1.0 = exactly on the boundary. */
function normRadius(p: Pt, c: Pt, rx = RX, ry = RY): number {
  return Math.hypot((p[0] - c[0]) / rx, (p[1] - c[1]) / ry);
}

function loopStroke(drawables: ReturnType<typeof kit.edgeArrow>["drawables"]): StrokeDrawable {
  return drawables[0] as StrokeDrawable;
}

describe("kit.edgeArrow selfLoop geometry", () => {
  const C: Pt = [500, 400];
  const opts = { selfLoop: true, shorten: { ellipse: [RX, RY] as [number, number] } };

  test("the loop hugs the node: both endpoints sit on the ellipse boundary and no point enters the node", () => {
    const { drawables } = kit.edgeArrow("l", C, C, opts);
    const pts = loopStroke(drawables).pts;
    const first = pts[0];
    const last = pts[pts.length - 1];
    // Endpoints on the boundary (plus the ~3px breathing gap).
    expect(normRadius(first, C)).toBeGreaterThanOrEqual(0.95);
    expect(normRadius(first, C)).toBeLessThanOrEqual(1.35);
    expect(normRadius(last, C)).toBeGreaterThanOrEqual(0.95);
    expect(normRadius(last, C)).toBeLessThanOrEqual(1.35);
    // Nothing dips inside the node — the old ∪ arc tangented the boundary
    // and its midpoint could sit at the anchor itself.
    for (const p of pts) {
      expect(normRadius(p, C)).toBeGreaterThanOrEqual(0.9);
    }
  });

  test("the arrowhead re-enters the node instead of pointing away", () => {
    const { drawables } = kit.edgeArrow("l", C, C, opts);
    const pts = loopStroke(drawables).pts;
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dir: Pt = [tip[0] - prev[0], tip[1] - prev[1]];
    const inward: Pt = [C[0] - tip[0], C[1] - tip[1]];
    expect(dir[0] * inward[0] + dir[1] * inward[1]).toBeGreaterThan(0);
  });

  test("loopDir aims the loop: [1,0] bulges right of the node, [0,-1] below it", () => {
    const right = loopStroke(kit.edgeArrow("l", C, C, { ...opts, loopDir: [1, 0] }).drawables).pts;
    const below = loopStroke(kit.edgeArrow("l", C, C, { ...opts, loopDir: [0, -1] }).drawables).pts;
    const farthest = (pts: Pt[]) =>
      pts.reduce((best, p) => (Math.hypot(p[0] - C[0], p[1] - C[1]) > Math.hypot(best[0] - C[0], best[1] - C[1]) ? p : best));
    const fr = farthest(right);
    const fb = farthest(below);
    expect(fr[0]).toBeGreaterThan(C[0] + RX); // clearly beyond the right edge
    expect(Math.abs(fr[1] - C[1])).toBeLessThan(40); // and roughly level with the center
    expect(fb[1]).toBeLessThan(C[1] - RY); // clearly below the bottom edge
  });
});

describe("layoutMarkovModel self-loop placement and labels", () => {
  const wellSickDead: MarkovParams = {
    states: ["Well", "Sick", "Dead"],
    transitions: [
      { from: "Well", to: "Sick", label: "0.10" },
      { from: "Sick", to: "Well", label: "0.30" },
      { from: "Sick", to: "Dead", label: "0.05" },
      { from: "Well", to: "Dead", label: "0.01" },
    ],
    self_loops: ["Well", "Sick"],
  };
  const RING_CENTER: Pt = [500, 380];

  test("ring self-loops point away from the ring's interior, into the state's free space", () => {
    const r = layoutMarkovModel(wellSickDead);
    for (const slug of ["well", "sick"]) {
      const c = r.anchors[`state_${slug}`];
      const loop = flattenDrawables(r.drawables).find((d) => d.id === `loop_${slug}`) as StrokeDrawable;
      expect(loop, `loop_${slug}`).toBeDefined();
      const farthest = loop.pts.reduce((best, p) =>
        Math.hypot(p[0] - c[0], p[1] - c[1]) > Math.hypot(best[0] - c[0], best[1] - c[1]) ? p : best,
      );
      // The loop's bulge direction (state center → farthest loop point) must
      // be roughly radially outward — within ~60° of the ring's outward
      // direction at that state — never aimed into the ring's interior.
      const bulgeLen = Math.hypot(farthest[0] - c[0], farthest[1] - c[1]);
      const outwardLen = Math.hypot(c[0] - RING_CENTER[0], c[1] - RING_CENTER[1]);
      const dot =
        ((farthest[0] - c[0]) / bulgeLen) * ((c[0] - RING_CENTER[0]) / outwardLen) +
        ((farthest[1] - c[1]) / bulgeLen) * ((c[1] - RING_CENTER[1]) / outwardLen);
      expect(dot, `loop_${slug} must bulge outward, not into the ring`).toBeGreaterThan(0.5);
    }
  });

  test("a {state, label} self-loop entry captions the stay probability", () => {
    const r = layoutMarkovModel({
      ...wellSickDead,
      self_loops: [{ state: "Well", label: "0.89" }, "Sick"],
    });
    expect(r.order).toContain("loop_well");
    expect(r.order).toContain("loop_sick");
    const label = r.labels.find((l) => l.id === "loop_label_well");
    expect(label).toBeDefined();
    expect(label!.text).toBe("0.89");
    // The plain-string entry draws its loop without a label.
    expect(r.labels.some((l) => l.id === "loop_label_sick")).toBe(false);
  });

  test("chain layouts with 5 states shrink the ellipses so neighbors keep clear air between them", () => {
    const r = layoutMarkovModel({
      states: ["A", "B", "C", "D", "E"],
      transitions: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "D" },
        { from: "D", to: "E" },
      ],
      layout: "chain",
    });
    const flat = flattenDrawables(r.drawables);
    const slugs = ["a", "b", "c", "d", "e"];
    for (let i = 0; i < slugs.length - 1; i++) {
      const left = flat.find((d) => d.id === `state_${slugs[i]}`) as StrokeDrawable;
      const right = flat.find((d) => d.id === `state_${slugs[i + 1]}`) as StrokeDrawable;
      const leftMax = Math.max(...left.pts.map((p) => p[0]));
      const rightMin = Math.min(...right.pts.map((p) => p[0]));
      expect(rightMin - leftMax, `${slugs[i]}→${slugs[i + 1]} gap`).toBeGreaterThanOrEqual(6);
    }
  });

  test("a transition through an intermediate state bows around it (the classic HTA row)", () => {
    const r = layoutMarkovModel({
      states: ["Well", "Sick", "Dead"],
      transitions: [
        { from: "Well", to: "Sick", label: "0.10" },
        { from: "Sick", to: "Dead", label: "0.05" },
        { from: "Well", to: "Dead", label: "0.01" },
      ],
      layout: "chain",
      self_loops: ["Well", "Sick"],
    });
    const sick = r.anchors["state_sick"];
    const t2 = flattenDrawables(r.drawables).find((d) => d.id === "t_2") as StrokeDrawable;
    expect(t2.pts.length, "the through-transition must be bowed, not straight").toBeGreaterThan(2);
    for (const p of t2.pts) {
      expect(normRadius(p, sick), "the bow must clear Sick's ellipse").toBeGreaterThanOrEqual(1.05);
    }
    // The probability label belongs on the bow's convex (outer) side — a
    // fixed "above the line" nudge would shove it back toward the very
    // state the bow just swerved around.
    const label = r.labels.find((l) => l.id === "t_label_2");
    expect(label).toBeDefined();
    const first = t2.pts[0];
    const last = t2.pts[t2.pts.length - 1];
    const chordMid: Pt = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    const pathMid = t2.pts[Math.floor((t2.pts.length - 1) / 2)];
    const bulge: Pt = [pathMid[0] - chordMid[0], pathMid[1] - chordMid[1]];
    const off: Pt = [label!.anchor[0] - pathMid[0], label!.anchor[1] - pathMid[1]];
    expect(off[0] * bulge[0] + off[1] * bulge[1], "label must sit on the convex side").toBeGreaterThan(0);
  });
});
