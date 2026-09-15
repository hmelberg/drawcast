// The widget drag ghost rides the LIVE nodes.
//
// Two bugs in one file. (1) `swapGeometry` — the per-frame rebuild every
// preview goes through (a slider, a widget's own patch, an animate tween) —
// used to hand `buildNodes` a throwaway map, so the effects object kept the
// mount-time nodes it closed over. After the first preview those nodes are
// detached: the glow, the focus dim and the ghost all wrote to elements that
// are no longer in the drawing, and nothing moved. (2) The ghost itself must
// COMPOSE with whatever transform the node already carries — the boundary's
// own offset and turn — and put that exact string back when it is cleared, or
// a dragged part loses its rotation and snaps to translate-only.
//
// Driven against the minimal DOM shim (tests/helpers/mini-dom.ts): the vitest
// environment is plain node.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor, type RenderStyle } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const STYLES: RenderStyle[] = ["clean", "sketchy"];

const SPEC = {
  elements: [
    { id: "band", type: "path", points: [[100, 100], [400, 100], [400, 200], [100, 200]], closed: true, style: { color: "#cf4632" } },
    { id: "note", type: "text", text: "Hello", x: 500, y: 300 },
  ],
  commands: [{ draw: ["band", "note"] }],
};

/** Every node carrying this leaf id that is still IN the tree under `root`. */
function liveGroups(root: FakeNode, id: string): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    if (n.dataset.leafId === id) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

const transformOf = (svg: FakeNode, id: string): string => liveGroups(svg, id)[0]?.getAttribute("transform") ?? "";

describe("the drag ghost (BackendEffects.setOffset)", () => {
  for (const style of STYLES) {
    test(`composes a translate with the node's own pose and restores it exactly (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();
        const effects = mounted.effects!;

        // The boundary has already moved and turned the band (a `move` step).
        mounted.elements.get("band")!.setTransform!(10, 20, 30, [250, 150]);
        const base = transformOf(svg, "band");
        expect(base).toContain("translate(10.0 -20.0)");
        expect(base).toContain("rotate(-30.00");

        // The ghost rides on top: y-up dx/dy, SVG's y-down translate, and the
        // pose it was given stays in the string (the rotation survives).
        effects.setOffset!("band", 40, 10);
        const ghosted = transformOf(svg, "band");
        expect(ghosted.startsWith("translate(40.0 -10.0) ")).toBe(true);
        expect(ghosted.endsWith(base)).toBe(true);

        // A second move replaces the ghost, never stacks on it.
        effects.setOffset!("band", 100, 0);
        expect(transformOf(svg, "band")).toBe(`translate(100.0 0.0) ${base}`);

        // (0, 0) puts back exactly what was there before the press.
        effects.setOffset!("band", 0, 0);
        expect(transformOf(svg, "band")).toBe(base);
      } finally {
        restore();
      }
    });

    test(`a part with no pose of its own ghosts and comes back untransformed (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();
        const effects = mounted.effects!;

        expect(transformOf(svg, "note")).toBe("");
        effects.setOffset!("note", 0, 25);
        expect(transformOf(svg, "note")).toBe("translate(0.0 -25.0)");
        effects.setOffset!("note", 0, 0);
        expect(liveGroups(svg, "note")[0].hasAttribute("transform")).toBe(false);
      } finally {
        restore();
      }
    });

    test(`after a preview rebuild the effects write to the nodes that are on screen (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();
        const effects = mounted.effects!;
        const before = liveGroups(svg, "band")[0];

        // What every preview does — a slider, a widget's patch, a tween frame.
        mounted.swapGeometry!(layout, new Set(layout.order), { band: [10, 20] });
        const after = liveGroups(svg, "band")[0];
        expect(after).not.toBe(before); // the node really was rebuilt
        // …and the old one is off the tree (its wrapper was replaced away).
        const rooted = (n: FakeNode): boolean => {
          for (let x: FakeNode | null = n; x; x = x.parentNode) if (x === svg) return true;
          return false;
        };
        expect(rooted(before)).toBe(false);
        expect(rooted(after)).toBe(true);

        // The ghost lands on the LIVE node, on top of the swap's own offset.
        effects.setOffset!("band", 40, 0);
        expect(after.getAttribute("transform")).toBe("translate(40.0 0.0) translate(10.0 -20.0)");
        effects.setOffset!("band", 0, 0);
        expect(after.getAttribute("transform")).toBe("translate(10.0 -20.0)");

        // The bug the ghost inherited: the focus dim (and the glow beside it)
        // were writing to the detached node too. (endFocus is not exercised
        // here — the shim's style bag has no removeProperty.)
        effects.setFocus!(["band"], 0.3);
        expect(after.style.opacity).toBe("0.3");
        expect(before.style.opacity ?? "").toBe("");
      } finally {
        restore();
      }
    });
  }
});
