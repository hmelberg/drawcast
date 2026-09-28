// The focus verb's dim (2026-09-28): one named strength, applied on each
// leaf's fade wrapper — never on the leaf's own node, where it REPLACED the
// authored translucency (inline CSS beats the `opacity` attribute) and, on
// release, snapped a translucent text to full ink. On the wrapper it
// composes with the authored value and with a fade, and ending it hands the
// node back to exactly what it was.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor, type RenderStyle } from "../src/render/svg-backend";
import { FOCUS_DIM } from "../src/render/backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const STYLES: RenderStyle[] = ["clean", "sketchy"];

/** Product of every set opacity (inline style first, else the attribute) from the leaf's node to the root. */
function effectiveOpacity(svg: FakeNode, id: string): number {
  const found: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    if (n.dataset.leafId === id) found.push(n);
    n.children.forEach(walk);
  };
  walk(svg);
  const leaf: FakeNode | null = found[0] ?? null;
  expect(leaf).not.toBeNull();
  let acc = 1;
  for (let n: FakeNode | null = leaf; n; n = n.parentNode) {
    const style = n.style.opacity;
    const v = style !== undefined && style !== "" ? style : n.getAttribute("opacity");
    if (v !== null && v !== undefined && v !== "") acc *= Number(v);
  }
  return acc;
}

const SPEC = {
  elements: [
    { id: "band", type: "path", points: [[100, 100], [400, 100], [400, 200], [100, 200]], closed: true, style: { color: "#cf4632", opacity: 0.4 } },
    { id: "note", type: "text", text: "Hello", x: 500, y: 300, style: { opacity: 0.6 } },
  ],
  commands: [{ draw: ["band", "note"] }],
};

describe("focus dims on the fade wrapper and composes", () => {
  test("the strength is one named value, lighter than the old 0.16", () => {
    expect(FOCUS_DIM).toBeGreaterThanOrEqual(0.3);
    expect(FOCUS_DIM).toBeLessThanOrEqual(0.45);
  });

  for (const style of STYLES) {
    test(`authored translucency and a fade survive a focus, and come back exactly (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();
        const fx = mounted.effects!;
        const band = mounted.elements.get("band")!;

        const noteRest = effectiveOpacity(svg, "note");
        band.setOpacity!(0.5);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.2, 6);

        fx.setFocus!(["band", "note"], FOCUS_DIM);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.2 * FOCUS_DIM, 3);
        expect(effectiveOpacity(svg, "note")).toBeCloseTo(noteRest * FOCUS_DIM, 3);

        // A fade that lands while the focus holds keeps the dim on top.
        band.setOpacity!(0.25);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.4 * 0.25 * FOCUS_DIM, 3);

        fx.endFocus!(["band", "note"]);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.1, 6);
        expect(effectiveOpacity(svg, "note")).toBeCloseTo(noteRest, 6);
      } finally {
        restore();
      }
    });
  }
});
