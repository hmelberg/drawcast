// A label's spot is chosen by an argmin over eight sides at six rings, and
// every tween frame re-runs that solve from scratch (render/index.ts's
// Reprojector.frame). Where the near candidates score alike — a curve's
// obstacle boxes blanketing the plot area — the winner changes from frame to
// frame and the label teleports across the figure. The pin is the fix: the
// boundary's placement is handed to every frame of the tween, so the label
// rides its anchor and the solve happens once, at the settle.

import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { leafDrawables, type Drawable, type Pt } from "../src/layout/model";
import { obstacleBoxes, placeLabels, type LabelRequest } from "../src/layout/labels";
import { defaultDrawOpts, defaultStyle } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

const wave = (bundledExamples as { request?: string; spec: Spec }[]).find(
  (e) => e.request === "Why does a higher frequency squeeze the wave?",
)!.spec;

const posOf = (drawables: Drawable[], id: string): Pt | null => {
  for (const d of leafDrawables(drawables)) {
    if (d.id !== id) continue;
    if (d.kind === "text" || d.kind === "image") return d.pos;
    if (d.kind === "stroke" && d.shapeHint?.type === "circle") return d.shapeHint.c;
    if (d.pts.length > 0) return d.pts[0];
  }
  return null;
};

describe("a label pinned at the boundary rides its anchor through the tween", () => {
  test("the label never moves further in one frame than the thing it names", () => {
    // The boundary the animate starts from: one honest solve, whose placement
    // every frame of the sweep then inherits.
    const at = (f: number) => ({ ...wave, vars: { ...(wave.vars ?? {}), f, t: 2 } }) as Spec;
    const boundary = layoutSpec(at(1), heuristicMeasure);
    const pins = boundary.labelPins;
    expect(Object.keys(pins)).toContain("lbl");

    let prevLabel = posOf(boundary.drawables, "lbl")!;
    let prevAnchor = posOf(boundary.drawables, "dot")!;
    let worst = 0;
    for (let i = 1; i <= 60; i++) {
      const l = layoutSpec(at(1 + (3 * i) / 60), heuristicMeasure, undefined, pins);
      const label = posOf(l.drawables, "lbl")!;
      const anchor = posOf(l.drawables, "dot")!;
      const labelMoved = Math.hypot(label[0] - prevLabel[0], label[1] - prevLabel[1]);
      const anchorMoved = Math.hypot(anchor[0] - prevAnchor[0], anchor[1] - prevAnchor[1]);
      worst = Math.max(worst, labelMoved - anchorMoved);
      prevLabel = label;
      prevAnchor = anchor;
    }
    // Rigidly attached: the only slack is the canvas clamp rounding.
    expect(worst).toBeLessThan(1);
  });
});

// The wiring lives in render/index.ts's reprojector, which needs a DOM to
// build. No jsdom here, so this pins the SOURCE — the same treatment
// tests/on-demand-auto-path.test.ts gives its own DOM-only seam.
describe("the reprojector carries the boundary's pins into its frames", () => {
  const reprojectorBlock = async (): Promise<string> => {
    const src = await readFile(new URL("../src/render/index.ts", import.meta.url), "utf8");
    const start = src.indexOf("player.reprojector = {");
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf("\n    };", start);
    return src.slice(start, end);
  };

  test("frame() hands the stored pins to the layout it paints", async () => {
    const block = await reprojectorBlock();
    const frame = block.slice(block.indexOf("frame:"), block.indexOf("commit:"));
    expect(frame).toContain("labelPins");
  });

  test("commit() refreshes the pins from the boundary it settles on", async () => {
    const block = await reprojectorBlock();
    const commit = block.slice(block.indexOf("commit:"));
    expect(commit).toMatch(/labelPins = \w+\.labelPins/);
  });
});

describe("placeLabels honours a pin", () => {
  const req = (anchor: Pt): LabelRequest => ({
    id: "lbl",
    anchor,
    side: "above-right",
    text: "one point rides the wave",
    fontSize: 19,
    style: defaultStyle({}),
    drawOpts: defaultDrawOpts("sketch"),
  });

  test("a pinned label takes the anchor's move and skips the search", () => {
    const first = placeLabels([req([500, 400])], [], heuristicMeasure);
    const pin = first[0].pin;

    // A wall of text right where the label sits would push an unpinned label
    // to the other side; the pinned one stays where the boundary put it.
    const wall = obstacleBoxes(
      [
        {
          id: "wall",
          kind: "text",
          pos: [first[0].text.pos[0], first[0].text.pos[1]],
          text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          fontSize: 30,
          anchor: "middle",
          z: 2,
          style: defaultStyle({}),
          drawOpts: defaultDrawOpts("sketch"),
        },
      ],
      heuristicMeasure,
    );
    const unpinned = placeLabels([req([520, 400])], wall, heuristicMeasure);
    const pinned = placeLabels([req([520, 400])], wall, heuristicMeasure, { lbl: pin });

    expect(pinned[0].text.pos[0]).toBeCloseTo(first[0].text.pos[0] + 20, 5);
    expect(pinned[0].text.pos[1]).toBeCloseTo(first[0].text.pos[1], 5);
    expect(unpinned[0].text.pos).not.toEqual(pinned[0].text.pos);
  });
});
