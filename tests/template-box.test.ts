import { beforeAll, describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes, domainMapping, inverseDomainMapping } from "../src/layout/layout";
import { fitRegion } from "../src/layout/regions";
import { flattenDrawables } from "../src/layout/model";
import { plotArea } from "../src/layout/canvas";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { FONT_FLOOR, FIT_SCALE_FLOOR } from "../src/lint/lint";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
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
    expect(r.issues.filter((i) => i.rule === "fit-scale")).toEqual([]);
  });

  test("bar_chart given a rectangle behaves as it did before this round", () => {
    const box = { x: 470, y: 95, w: 460, h: 560 };
    expect(chart(box).fit).toBeUndefined();
    expect(chart(box).warnings).toEqual([]);
  });
});

describe("template box — domain coordinates follow the fit", () => {
  // Tier-3 elements with literal x/y (text, shape, path, math) are CANVAS
  // placement and deliberately do not follow the fit — that is how a note
  // sits beside a fitted template — while domain-unit placement (point,
  // curves, regions) follows the figure.
  test("a freehand point at domain (50, 50) lands at the fitted image of the plot centre", () => {
    const r = layoutSpec(sir({ box: "left" }, [{ id: "t", type: "point", at: { x: 50, y: 50 } }]));
    const { s, dx, dy } = r.fit!;
    const plot = plotArea();
    const cx = (plot.x0 + plot.x1) / 2, cy = (plot.y0 + plot.y1) / 2;
    const b = elementBBoxes(r).get("t")!;
    expect(b.x + b.w / 2).toBeCloseTo(cx * s + dx, 0);
    expect(b.y + b.h / 2).toBeCloseTo(cy * s + dy, 0);
  });

  test("domainMapping and its inverse compose the fit and round-trip", () => {
    const fit = { s: 0.5, dx: 300, dy: 100, box: fitRegion("right") };
    const fwd = domainMapping({ x: [0, 100], y: [0, 100] }, fit);
    const inv = inverseDomainMapping({ x: [0, 100], y: [0, 100] }, fit);
    const plain = domainMapping({ x: [0, 100], y: [0, 100] });
    const p = plain.toLogical([25, 75]);
    expect(fwd.toLogical([25, 75])).toEqual([p[0] * 0.5 + 300, p[1] * 0.5 + 100]);
    const back = inv(fwd.toLogical([25, 75]));
    expect(back[0]).toBeCloseTo(25, 6);
    expect(back[1]).toBeCloseTo(75, 6);
    // deltas scale by s and ignore the offset
    const d = plain.deltaToLogical([10, 10]);
    expect(fwd.deltaToLogical([10, 10])).toEqual([d[0] * 0.5, d[1] * 0.5]);
  });

  test("without a fit both mappings are unchanged", () => {
    const a = domainMapping({ x: [0, 10], y: [0, 10] }).toLogical([5, 5]);
    const b = domainMapping({ x: [0, 10], y: [0, 10] }, undefined).toLogical([5, 5]);
    expect(a).toEqual(b);
  });
});

describe("template box — tier-2 ink stays inside the fitted plot", () => {
  test("point guides land inside the fitted plot, not the unfitted one", () => {
    const el = { id: "p", type: "point", at: { x: 50, y: 50 }, guides: true };
    const spec = (box?: unknown) =>
      ({
        template: "sir_compartments",
        params: box !== undefined ? { box } : {},
        domain: { x: [0, 100], y: [0, 100] },
        elements: [el],
        commands: [{ draw: ["p"] }],
      }) as unknown as Spec;

    // First: with no box, the guide reaches the UNFITTED plot.x0 — proves the
    // fitted assertion below actually discriminates rather than passing vacuously.
    const unfitted = layoutSpec(spec());
    const plot = plotArea();
    const unfittedGuide = flattenDrawables(unfitted.drawables).find((d) => d.id === "p_guides");
    expect(unfittedGuide?.kind === "stroke" && unfittedGuide.pts.some((pt) => Math.abs(pt[0] - plot.x0) < 1)).toBe(true);

    const r = layoutSpec(spec("right"));
    expect(r.fit).toBeDefined();
    const { s, dx, dy } = r.fit!;
    const fitX0 = plot.x0 * s + dx;
    for (const d of flattenDrawables(r.drawables)) {
      if (!d.id.startsWith("p_")) continue;
      if (d.kind !== "stroke") continue;
      for (const pt of d.pts) expect(pt[0], `${d.id} x`).toBeGreaterThanOrEqual(fitX0 - 1);
    }
  });

  test("a line through two domain points stays inside the fitted plot", () => {
    const spec = {
      template: "sir_compartments",
      params: { box: "right" },
      domain: { x: [0, 100], y: [0, 100] },
      elements: [{ id: "ln", type: "line", through: [[10, 10], [90, 90]] }],
      commands: [{ draw: ["ln"] }],
    } as unknown as Spec;
    const r = layoutSpec(spec);
    expect(r.fit).toBeDefined();
    const { s, dx, dy } = r.fit!;
    const plot = plotArea();
    const fitPlot = {
      x0: plot.x0 * s + dx, x1: plot.x1 * s + dx,
      y0: plot.y0 * s + dy, y1: plot.y1 * s + dy,
    };
    const line = flattenDrawables(r.drawables).find((d) => d.id === "ln");
    expect(line?.kind).toBe("stroke");
    if (line?.kind !== "stroke") throw new Error("expected a stroke");
    expect(line.pts.length).toBeGreaterThan(0);
    for (const pt of line.pts) {
      expect(pt[0], "x").toBeGreaterThanOrEqual(fitPlot.x0 - 1);
      expect(pt[0], "x").toBeLessThanOrEqual(fitPlot.x1 + 1);
      expect(pt[1], "y").toBeGreaterThanOrEqual(fitPlot.y0 - 1);
      expect(pt[1], "y").toBeLessThanOrEqual(fitPlot.y1 + 1);
    }
  });
});

describe("template box — no domain: coordinates are canvas coordinates and never follow the fit", () => {
  test("domainMapping with no domain is the identity, even with a fit", () => {
    const fit = { s: 0.5, dx: 300, dy: 100, box: fitRegion("right") };
    const m = domainMapping(undefined, fit);
    expect(m.toLogical([500, 300])).toEqual([500, 300]);
    expect(m.deltaToLogical([100, 0])).toEqual([100, 0]);
  });

  test("a no-domain move.to on a boxed template lands at the literal canvas coordinates, not the fitted image", () => {
    const spec = {
      template: "sir_compartments",
      params: { box: "left" },
      elements: [{ id: "n", type: "text", text: "note", x: 700, y: 300 }],
      commands: [{ draw: ["n"] }, { move: { target: "n", to: { x: 700, y: 300 } } }],
    } as unknown as Spec;
    const layout = layoutSpec(spec);
    expect(layout.fit).toBeDefined();
    const bboxes = elementBBoxes(layout);
    const plan = planCommands(spec.commands, layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.template ? spec.params ?? {} : null,
      varsBase: spec.vars ?? null,
      ...planOptionsFor(spec, layout),
    });
    expect(plan.warnings).toEqual([]);
    const step = plan.steps.find((st) => st.kind === "transform");
    if (!step || step.kind !== "transform") throw new Error("expected a transform step");
    const item = step.items.find((it) => it.id === "n")!;
    // Same place it already was: a move.to that repeats a canvas coordinate
    // a freehand element was already placed at must be a no-op offset.
    expect(item.to.offset[0]).toBeCloseTo(0, 6);
    expect(item.to.offset[1]).toBeCloseTo(0, 6);
  });
});

describe("template box — the planner's domain mapping composes the fit", () => {
  test("a domain-unit move.to on a boxed template lands on the fitted figure", () => {
    const spec = {
      template: "sir_compartments",
      params: { box: "left" },
      domain: { x: [0, 100], y: [0, 100] },
      commands: [{ draw: ["box_s"] }, { move: { target: "box_s", to: { x: 50, y: 50 } } }],
    } as unknown as Spec;
    const layout = layoutSpec(spec);
    expect(layout.fit).toBeDefined();
    const { s, dx, dy } = layout.fit!;
    const plot = plotArea();
    const cx = (plot.x0 + plot.x1) / 2, cy = (plot.y0 + plot.y1) / 2;
    const bboxes = elementBBoxes(layout);
    const before = bboxes.get("box_s")!;
    const beforeCentre: [number, number] = [before.x + before.w / 2, before.y + before.h / 2];
    // Planned the same way render() plans it (src/render/index.ts) — WITH the
    // layout's fit, so a domain-unit destination on a boxed template lands
    // where the figure now is, not where the standard plot area used to be.
    const plan = planCommands(spec.commands, layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.template ? spec.params ?? {} : null,
      varsBase: spec.vars ?? null,
      ...planOptionsFor(spec, layout),
    });
    expect(plan.warnings).toEqual([]);
    const step = plan.steps.find((st) => st.kind === "transform");
    if (!step || step.kind !== "transform") throw new Error("expected a transform step");
    const item = step.items.find((it) => it.id === "box_s")!;
    expect(beforeCentre[0] + item.to.offset[0]).toBeCloseTo(cx * s + dx, 0);
    expect(beforeCentre[1] + item.to.offset[1]).toBeCloseTo(cy * s + dy, 0);
  });
});

describe("template box — fit-scale lint", () => {
  test("a box too small for the template warns once, naming the scale and the way out", () => {
    const r = layoutSpec(sir({ box: { x: 60, y: 95, w: 200, h: 120 } }));
    expect(r.fit!.s).toBeLessThan(FIT_SCALE_FLOOR);
    const hits = r.issues.filter((i) => i.rule === "fit-scale");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warn");
    expect(hits[0].ids).toEqual(["sir_compartments"]);
    expect(hits[0].message).toMatch(/fitted at 0\.\d+/);
    expect(hits[0].message).toMatch(/taller region|native box/);
  });

  test("a comfortable box does not warn", () => {
    const r = layoutSpec(sir({ box: "full" }));
    expect(r.fit!.s).toBeGreaterThanOrEqual(FIT_SCALE_FLOOR);
    expect(r.issues.filter((i) => i.rule === "fit-scale")).toEqual([]);
  });

  test("the overlap hint now names the region words", () => {
    const r = layoutSpec(sir({}, [{ id: "sim", type: "code", language: "python", show: "code", code: CODE, x: 500, width: 880 }]));
    const hit = r.issues.find((i) => i.rule === "overlap-code-figure");
    expect(hit).toBeDefined();
    expect(hit!.message).toMatch(/box: "left"|box: "right"/);
  });
});
