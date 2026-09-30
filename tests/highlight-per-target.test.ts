// highlight circle / box / underline on several targets: one mark per target
// (2026-09-30 test runs: two labels at opposite sides of a freehand figure
// got ONE ring round the whole figure between them). Targets close enough
// that their marks would touch are one visual unit and share one.
import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { markClusters, rendererFor } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

async function mount(spec: object) {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(spec as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor("clean").mount(layout, spec as never, container as never);
  for (const el of r.elements.values()) el.finish();
  const svg = container.children[0];
  const overlay = svg.children[svg.children.length - 1];
  return { restore, effects: r.effects!, overlay, boxes: elementBBoxes(layout, heuristicMeasure) };
}

const SPEC = {
  elements: [
    { id: "body", type: "path", points: [[250, 250], [400, 520], [600, 520], [750, 250], [500, 180], [250, 250]], closed: true },
    { id: "cold_lbl", type: "text", text: "cold side", x: 150, y: 420 },
    { id: "hot_lbl", type: "text", text: "hot side", x: 860, y: 420 },
    { id: "hot_sub", type: "text", text: "(red)", x: 860, y: 390 },
  ],
  commands: [{ draw: ["body", "cold_lbl", "hot_lbl", "hot_sub"] }],
};

describe("one mark per target", () => {
  for (const effect of ["circle", "box", "underline"] as const) {
    test(`${effect} on two labels far apart draws two marks, each round its own label`, async () => {
      const { restore, effects, overlay, boxes } = await mount(SPEC);
      try {
        const ids = ["cold_lbl", "hot_lbl"];
        effects.setHighlight(ids, effect, 1, ids.map((id) => boxes.get(id)!), undefined, 1000);
        expect(overlay.children).toHaveLength(2);
        // Neither mark reaches into the middle of the figure between the
        // labels (x 420–580; every y here is near 330, every radius small).
        for (const mark of overlay.children) {
          const nums = mark.querySelectorAll("path").flatMap((p) => (p.getAttribute("d") ?? "").match(/-?[\d.]+/g)!.map(Number));
          expect(nums.filter((v) => v > 420 && v < 580)).toEqual([]);
        }
      } finally {
        restore();
      }
    });
  }

  test("targets that touch are one visual unit: one mark", async () => {
    const { restore, effects, overlay, boxes } = await mount(SPEC);
    try {
      const ids = ["hot_lbl", "hot_sub"];
      effects.setHighlight(ids, "circle", 1, ids.map((id) => boxes.get(id)!), undefined, 1000);
      expect(overlay.children).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("a single union box (the old call) still draws one mark", async () => {
    const { restore, effects, overlay } = await mount(SPEC);
    try {
      effects.setHighlight(["cold_lbl", "hot_lbl"], "box", 1, { x: 100, y: 400, w: 800, h: 40 }, undefined, 1000);
      expect(overlay.children).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("markClusters", () => {
  const b = (x: number, y: number, w = 50, h = 20) => ({ box: { x, y, w, h } });
  test("far apart stay apart; near ones merge, transitively", () => {
    expect(markClusters([b(0, 0), b(500, 0)])).toHaveLength(2);
    expect(markClusters([b(0, 0), b(60, 0)])).toHaveLength(1);
    const chain = markClusters([b(0, 0), b(200, 0), b(60, 0), b(130, 0)]);
    expect(chain).toHaveLength(1);
    expect(chain[0].box).toEqual({ x: 0, y: 0, w: 250, h: 20 });
  });
});
