// The fade verb's opacity must LAYER on top of whatever translucency the
// author already gave a drawable — never replace it.
//
// drawLeaf writes a stroke/area drawable's authored `style.opacity` as the
// `opacity` ATTRIBUTE on the leaf's own <g>. For a long time fade wrote the
// same attribute on the same node for those kinds, so the first applyScene —
// which runs after every animate step, every scrub, stop(), showPoster(),
// setMode("instant") and replay, and calls setOpacity(1) for every unfaded
// element — REMOVED it. Every translucent stroke in the library (a code pane's
// highlighter bands at 0.42, the ECG grid, the dashed 3-D guides, kit's depth
// fade) jumped to full ink the moment the movie touched a boundary.
//
// The fix: every leaf kind gets a wrapper <g> that fade alone owns, so the
// authored attribute and the fade attribute sit on different nodes and SVG's
// nested-opacity compositing multiplies them.
//
// Driven against the minimal DOM shim (tests/helpers/mini-dom.ts): the vitest
// environment is plain node.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor, type RenderStyle } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const STYLES: RenderStyle[] = ["clean", "sketchy"];

/** Every node carrying this leaf id, anywhere under `root`. */
function leafGroups(root: FakeNode, id: string): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    if (n.dataset.leafId === id) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * The effective opacity a leaf's paths inherit: the product of every `opacity`
 * (attribute or inline style) from the leaf's own group up to the svg root —
 * exactly what SVG's nested-opacity compositing produces on screen.
 */
function effectiveOpacity(svg: FakeNode, id: string): number {
  const groups = leafGroups(svg, id);
  expect(groups.length).toBeGreaterThan(0);
  let acc = 1;
  for (let n: FakeNode | null = groups[0]; n; n = n.parentNode) {
    const style = n.style.opacity;
    const attr = n.getAttribute("opacity");
    const v = Number(style ?? attr);
    if ((style ?? attr) !== null && (style ?? attr) !== undefined && (style ?? attr) !== "" && Number.isFinite(v)) acc *= v;
  }
  return acc;
}

const SPEC = {
  elements: [
    { id: "band", type: "path", points: [[100, 100], [400, 100], [400, 200], [100, 200]], closed: true, style: { color: "#cf4632", opacity: 0.4 } },
    { id: "note", type: "text", text: "Hello", x: 500, y: 300 },
  ],
  commands: [{ draw: ["band", "note"] }],
};

describe("fade never destroys an authored opacity", () => {
  for (const style of STYLES) {
    test(`a translucent stroke keeps its 0.4 through applyScene's setOpacity(1) (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();
        const band = mounted.elements.get("band")!;

        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.4, 6);

        // What Player.applyScene does for EVERY element on every scene apply.
        band.setOpacity!(1);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.4, 6);

        // A fade composes with the authored value rather than replacing it.
        band.setOpacity!(0.5);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.2, 6);

        // …and undoing the fade returns to the authored translucency, not to 1.
        band.setOpacity!(1);
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.4, 6);

        // Text has no authored opacity here, so it simply follows the fade.
        const note = mounted.elements.get("note")!;
        expect(effectiveOpacity(svg, "note")).toBeCloseTo(1, 6);
        note.setOpacity!(0.5);
        expect(effectiveOpacity(svg, "note")).toBeCloseTo(0.5, 6);
        note.setOpacity!(1);
        expect(effectiveOpacity(svg, "note")).toBeCloseTo(1, 6);
      } finally {
        restore();
      }
    });

    test(`a handle-less tween frame carries the scene's turns and fades (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();

        // Exactly what Player.runAction("animate") hands the reprojector.
        mounted.swapGeometry!(layout, new Set(layout.order), { band: [10, 20] }, { band: { deg: 30, pivot: [250, 150], scale: 2 } }, { band: 0.5 });

        const g = leafGroups(svg, "band")[0];
        const t = g.getAttribute("transform") ?? "";
        expect(t).toContain("translate(10.0 -20.0)");
        expect(t).toContain("rotate(-30.00");
        expect(t).toContain("scale(2.0000)");
        // fade 0.5 × authored 0.4
        expect(effectiveOpacity(svg, "band")).toBeCloseTo(0.2, 6);
      } finally {
        restore();
      }
    });
  }
});
