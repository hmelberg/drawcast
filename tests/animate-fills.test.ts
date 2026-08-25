// The animate command's cheap tween frames must paint an ALREADY-DRAWN
// element exactly the way the settled frame paints it.
//
// A tween frame goes through swapGeometry (src/render/svg-backend.ts), which
// rebuilds nodes for the reprojected layout and deliberately attaches NO
// handles — no getTotalLength, no per-leaf prepare/setProgress — because a
// frame runs every rAF tick. That only works while a freshly built node
// already looks fully drawn. Strokes satisfy it (no dash-offset = whole path);
// fills must too, or every shaded region flickers for the length of the tween
// (the reported bug: the chess board's dark squares lose their green while a
// piece glides).
//
// These tests drive the real backend against the minimal DOM shim in
// tests/helpers/mini-dom.ts, since the vitest environment is plain node.

import { describe, expect, test } from "vitest";
import gamesYaml from "../src/scenes/packs/games.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import { ensureEngines } from "../src/scenes/engines";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor, type RenderStyle } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import type { LayoutResult } from "../src/layout/layout";

const STYLES: RenderStyle[] = ["clean", "sketchy"];

function num(v: string | null | undefined, dflt: number): number {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? dflt : n;
}

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
 * What one <path> actually puts on the paper: fill and stroke paints with
 * their effective alphas, inherited group opacity and the dash-offset reveal
 * folded in. Comparing this string between two renders answers "does it look
 * the same" without depending on which channel carried the value (inline
 * style vs presentation attribute).
 */
function paintOf(p: FakeNode, stopAt: FakeNode): string {
  let inherited = 1;
  for (let n: FakeNode | null = p; n && n !== stopAt.parentNode; n = n.parentNode) {
    inherited *= num(n.style.opacity ?? n.getAttribute("opacity"), 1);
  }
  const fill = p.getAttribute("fill") ?? "none";
  const fillAlpha = fill === "none" ? 0 : inherited * num(p.style.fillOpacity ?? p.getAttribute("fill-opacity"), 1);
  const stroke = p.getAttribute("stroke") ?? "none";
  // strokeDashoffset 0 (or absent) = the whole path is drawn.
  const revealed = num(p.style.strokeDashoffset, 0) === 0 ? 1 : 0;
  const strokeAlpha = stroke === "none" ? 0 : inherited * revealed;
  return `fill ${fill}@${fillAlpha.toFixed(3)} / stroke ${stroke}@${strokeAlpha.toFixed(3)}`;
}

/** The paint of every path belonging to `id`, in document order. */
function paintFor(svg: FakeNode, id: string): string[] {
  return leafGroups(svg, id).flatMap((g) => g.querySelectorAll("path").map((p) => paintOf(p, g)));
}

/**
 * Total ink an element lays down: fill alpha plus stroke alpha over all its
 * paths. Shading that vanished reads as a drop here whichever channel carried
 * it — clean paints a region as one filled path, sketchy as hachure strokes.
 */
function ink(paints: string[]): number {
  return paints.reduce((acc, s) => acc + [...s.matchAll(/@([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0), 0);
}

async function mountFor(style: RenderStyle, layout: LayoutResult, spec: unknown, doc: unknown) {
  const container = new FakeNode("div", doc as never);
  const mounted = await rendererFor(style).mount(layout, spec as never, container as never);
  // The player's applyScene at a step boundary: everything visible is finished.
  for (const el of mounted.elements.values()) el.finish();
  return { mounted, svg: container.children[0] };
}

describe("animate tween frames keep already-drawn fills", () => {
  for (const style of STYLES) {
    test(`chess: a plies_shown tween frame paints the dark squares like the settled frame (${style})`, async () => {
      await ensureEngines(["chess"]);
      registerPack("games", gamesYaml);
      const spec = {
        title: "Scholar's Mate",
        template: "chess_board",
        params: { moves: ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"], plies_shown: 0, coords: false },
        commands: [
          { draw: ["board", "sq_a1", "sq_c1", "sq_b8", "piece_e2"] },
          { animate: { plies_shown: 1 }, duration: 1.3 },
        ],
      };
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(spec as never, heuristicMeasure);
        const bboxes = elementBBoxes(layout, heuristicMeasure);
        const plan = planCommands(spec.commands as never, layout.order, {
          bboxOf: (id) => bboxes.get(id) ?? null,
          ...domainMapping(undefined),
          animateBase: spec.params,
        });
        const { mounted, svg } = await mountFor(style, layout, spec, doc);

        const settled = paintFor(svg, "sq_a1");
        expect(settled.length).toBeGreaterThan(0);
        expect(ink(settled)).toBeGreaterThan(0);

        // One tween frame, exactly as Player.runAction("animate") drives it:
        // the reprojected layout at an interpolated param, the boundary's
        // visibility set, the boundary's offsets.
        const before = plan.states[0];
        const frame = layoutSpec(
          { ...spec, params: withOverrides(spec.params, { ...before.params, plies_shown: 0.4 }) } as never,
          heuristicMeasure,
        );
        mounted.swapGeometry!(frame, new Set(before.visible), before.offsets);

        expect(paintFor(svg, "sq_a1")).toEqual(settled);
      } finally {
        restore();
      }
    });

    test(`supply_demand: a demand_shift tween frame keeps the shaded region's fill (${style})`, async () => {
      const spec = {
        template: "supply_demand",
        params: { regions: ["consumer_surplus"], demand_shift: { direction: "right", amount: 0 } },
        commands: [{ draw: ["axes", "demand_curve", "supply_curve", "cs_region"] }, { animate: { "demand_shift.amount": 20 }, duration: 1 }],
      };
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(spec as never, heuristicMeasure);
        const { mounted, svg } = await mountFor(style, layout, spec, doc);

        const settled = paintFor(svg, "cs_region");
        expect(settled.length).toBeGreaterThan(0);
        expect(ink(settled)).toBeGreaterThan(0);

        const frame = layoutSpec(
          { ...spec, params: withOverrides(spec.params, { "demand_shift.amount": 9 }) } as never,
          heuristicMeasure,
        );
        mounted.swapGeometry!(frame, new Set(layout.order), {});

        const tween = paintFor(svg, "cs_region");
        expect(ink(tween)).toBeCloseTo(ink(settled), 6);
        expect(tween).toEqual(settled);
      } finally {
        restore();
      }
    });
  }
});
