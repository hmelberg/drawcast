import { beforeAll, describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { fitRegion } from "../src/layout/regions";
import { flattenDrawables } from "../src/layout/model";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { FONT_FLOOR } from "../src/lint/lint";
import type { BBox } from "../src/layout/geometry";
import type { Spec } from "../src/spec/types";

const inside = (b: BBox, r: BBox, slack = 0) =>
  b.x >= r.x - slack && b.y >= r.y - slack && b.x + b.w <= r.x + r.w + slack && b.y + b.h <= r.y + r.h + slack;

const CODE = "beta, gamma = 0.3, 0.1\nprint(beta / gamma)";
const sir = (params: object = {}, elements: object[] = []): Spec =>
  ({ template: "sir_compartments", params, elements, commands: [{ draw: ["box_S"] }] }) as unknown as Spec;

beforeAll(async () => {
  await ensureEnabledPacks(["evidence", "data"]);
});

describe("template box — a template without a native box is fitted", () => {
  test("box: \"right\" puts every template drawable inside the right region (labels may spill by one label height)", () => {
    const r = layoutSpec(sir({ box: "right" }));
    expect(r.fit).toBeDefined();
    expect(r.fit!.box).toEqual(fitRegion("right"));
    expect(r.fit!.s).toBeLessThan(1);
    const R = fitRegion("right");
    for (const [id, b] of elementBBoxes(r)) {
      expect(inside(b, R, FONT_FLOOR * 1.25), id).toBe(true);
    }
  });

  test("a rectangle works the same way", () => {
    const box = { x: 100, y: 400, w: 300, h: 200 };
    const r = layoutSpec(sir({ box }));
    expect(r.fit!.box).toEqual(box);
    for (const [id, b] of elementBBoxes(r)) expect(inside(b, box, FONT_FLOOR * 1.25), id).toBe(true);
  });

  test("no text drawn below the floor, so font-too-small never fires on a fitted template", () => {
    const r = layoutSpec(sir({ box: { x: 60, y: 95, w: 200, h: 120 } }));
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "text") expect(d.fontSize, d.id).toBeGreaterThanOrEqual(FONT_FLOOR);
    }
    expect(r.issues.filter((i) => i.rule === "font-too-small")).toEqual([]);
  });

  test("an invalid box is ignored with a warning, and the template keeps the canvas", () => {
    const r = layoutSpec(sir({ box: "middle" }));
    expect(r.fit).toBeUndefined();
    expect(r.warnings.some((w) => /box .*"middle".*left, right, top, bottom, full/.test(w))).toBe(true);
  });

  test("without a box and without a code element nothing is fitted", () => {
    const r = layoutSpec(sir());
    expect(r.fit).toBeUndefined();
    const all = [...elementBBoxes(r).values()];
    const x0 = Math.min(...all.map((b) => b.x)), x1 = Math.max(...all.map((b) => b.x + b.w));
    expect(x1 - x0).toBeGreaterThan(500); // the chain spans most of the canvas, as it always has
  });
});

describe("template box — the split default reaches every template", () => {
  test("a code panel beside sir_compartments gets the split's invented box: no overlap, no lint", () => {
    const r = layoutSpec(sir({}, [{ id: "sim", type: "code", language: "python", show: "code", code: CODE }]));
    expect(r.fit).toBeDefined();
    expect(r.issues.filter((i) => i.rule === "overlap-code-figure")).toEqual([]);
    // frame: "none" (the default) draws no chrome of its own — the panel's
    // own id ("sim") carries no ink, so elementBBoxes has nothing to union.
    // r.panes is the field LayoutResult already exposes for exactly this
    // rectangle (the code pane's text area — code.ts, ctx.panes[el.id]).
    const code = r.panes!["sim"]!;
    // the figure sits to the right of the script
    expect(r.fit!.box.x).toBeGreaterThanOrEqual(code.x + code.w - 1);
  });

  test("a data-only script (show: none) still leaves the template the whole canvas", () => {
    const r = layoutSpec(sir({}, [{ id: "feed", type: "code", language: "python", show: "none", code: CODE }]));
    expect(r.fit).toBeUndefined();
  });
});

describe("template box — a native box is resolved, never fitted", () => {
  const chart = (box: unknown) =>
    layoutSpec({ template: "bar_chart", params: { labels: ["a", "b", "c"], values: [1, 2, 3], box } } as unknown as Spec);

  test("bar_chart given a NAME receives the rectangle and lays itself out in it", () => {
    const r = chart("right");
    expect(r.fit).toBeUndefined();
    const R = fitRegion("right");
    for (const [id, b] of elementBBoxes(r)) {
      if (id === "title") continue;
      expect(inside(b, R, 40), id).toBe(true); // axis labels hang just outside the plot area
    }
    // "fit-scale" lands in Task 4 — the union doesn't know it yet.
    expect(r.issues.filter((i) => (i.rule as string) === "fit-scale")).toEqual([]);
  });

  test("bar_chart given a rectangle behaves as it did before this round", () => {
    const box = { x: 470, y: 95, w: 460, h: 560 };
    expect(chart(box).fit).toBeUndefined();
    expect(chart(box).warnings).toEqual([]);
  });
});
