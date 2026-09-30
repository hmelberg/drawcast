import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const SPEC = { elements: [{ id: "t", type: "text", text: "Hi", x: 500, y: 375 }], commands: [{ draw: ["t"] }] };

async function mounted() {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor("clean").mount(layout, SPEC as never, container as never);
  for (const el of r.elements.values()) el.finish();
  const svg = container.children[0];
  return { restore, effects: r.effects!, overlay: svg.children[svg.children.length - 1] };
}

describe("the box effect", () => {
  test("a box with no leaves draws a mark round the given box, at the level's opacity", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setHighlight(["md:left"], "box", 0.5, { x: 100, y: 300, w: 200, h: 200 });
      expect(overlay.children.length).toBe(1);
      expect(Number(overlay.children[0].style.opacity)).toBeCloseTo(0.5, 3);
      effects.endHighlight(["md:left"]);
      expect(overlay.children.length).toBe(0);
    } finally {
      restore();
    }
  });
});
