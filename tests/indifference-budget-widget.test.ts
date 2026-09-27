// indifference_budget's free-play body (2026-09-27): paused, the viewer drags
// the budget line — an end turns it (that good's price), the middle slides it
// (income) — and the optimum, its curves and a price_x_before split follow.
// The body lives in the pack document (economics.yaml `widget:`),
// live with no demo or judge, so free play. Also the template's new params: x_max/y_max (axes that
// hold still) and price_x_before (substitution and income effects).
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene, paramNamesOf } from "../src/scenes/widget-scene";
import { dragMoveEvent, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";

beforeAll(async () => {
  await ensureEnabledPacks(["economics"]);
});

const mod = () => scenes["indifference_budget"];
const sceneOf = (params: Record<string, unknown>): WidgetScene => buildWidgetScene(mod(), params)!;
/** The logical point `t` of the way along the budget line (0 = y-axis end). */
const onLine = (sc: WidgetScene, t: number): Pt => {
  const [a, b] = sc.lines.get("budget_line")![0];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
};
const by = (sc: WidgetScene, p: Pt, dx: number, dy: number): Pt => {
  const [x0, y0] = sc.toLogical([0, 0]);
  const [x1, y1] = sc.toLogical([dx, dy]);
  return [p[0] + x1 - x0, p[1] + y1 - y0];
};
function drag(params: Record<string, unknown>, from: Pt, to: Pt, state: unknown = { said: null }) {
  const sc = sceneOf(params);
  return stepWidget(mod().widget!(), state, dragMoveEvent("budget_line", from, to, sc), sc, paramNamesOf(mod()));
}
const patchOf = (r: ReturnType<typeof drag>) => (r.effects.find((e) => e.patch)?.patch ?? {}) as Record<string, number>;

/** Every complaint the figure makes at these params (the strictest read). */
function lintAt(params: Record<string, unknown>): string[] {
  const l = layoutSpec({ title: "t", template: "indifference_budget", params, commands: [] } as unknown as Spec);
  return [...l.warnings, ...l.issues.map((i) => `[${i.severity}] ${i.message}`)];
}

describe("indifference_budget: the new params", () => {
  test("x_max / y_max hold the axes still: a price change now MOVES the line on the page", () => {
    const at = (px: number, pin: boolean) => mod().layout!({ income: 60, price_x: px, price_y: 6, ...(pin ? { x_max: 26, y_max: 13 } : {}) }).anchors.budget_line;
    // Unpinned, the axes scale with the intercept and the line never moves.
    expect(at(5, false)[0]).toBeCloseTo(at(3, false)[0], 6);
    // Pinned, a dearer x-good pulls the x-intercept in.
    expect(at(5, true)[0]).toBeLessThan(at(3, true)[0] - 100);
  });

  test("a pin too short for the line gives way rather than letting it run off the plot", () => {
    const f = mod().layout!({ income: 100, price_x: 2, x_max: 10 }).frame!;
    expect(f.x[1]).toBeGreaterThanOrEqual(50 * 1.05 - 1e-9);
  });

  test("price_x_before: A, C and B, with substitution + income = the whole move (Cobb-Douglas)", () => {
    const lay = mod().layout!({ income: 100, price_x: 4, price_x_before: 2, price_y: 1 });
    const v = lay.values!;
    // alpha 0.5: A = 25, B = 12.5; C on A's curve at the new prices.
    expect(v.x_before).toBeCloseTo(25, 2);
    expect(v.x).toBeCloseTo(12.5, 2);
    expect(v.x_comp).toBeCloseTo(25 / Math.SQRT2, 1);
    expect(v.substitution + v.income_effect).toBeCloseTo(v.x - v.x_before, 1);
    expect(v.substitution).toBeLessThan(0);
    expect(v.income_effect).toBeLessThan(0);
    for (const id of ["budget_old", "ic_old", "budget_comp", "point_a", "point_c", "substitution_effect", "income_effect", "label_substitution", "label_income"]) expect(lay.order).toContain(id);
  });

  test("the split's figure and the plain one are lint-clean", () => {
    expect(lintAt({})).toEqual([]);
    expect(lintAt({ income: 100, price_x: 4, price_x_before: 2, curves: 1 })).toEqual([]);
    expect(lintAt({ income: 60, price_x: 5, price_x_before: 3, price_y: 6, x_good: "Coffees", y_good: "Sandwiches", curves: 1 })).toEqual([]);
  });

  test("values name the optimum; {consumer.x} reads them in a cast's text", () => {
    const v = mod().layout!({ income: 60, price_x: 3, price_y: 6 }).values!;
    expect(v).toMatchObject({ x: 10, y: 5, x_intercept: 20, y_intercept: 10 });
    const spec = {
      title: "t",
      template: "indifference_budget",
      params: { income: 60, price_x: 3, price_y: 6 },
      elements: [{ id: "note", type: "text", text: "{consumer.x:0} coffees", at: { x: 800, y: 700 } }],
      commands: [{ draw: ["budget_line", "note"] }],
    } as unknown as Spec;
    expect(JSON.stringify(layoutSpec(spec).drawables)).toContain("10 coffees");
  });
});

describe("indifference_budget: the document carries a free-play live body", () => {
  test("live, one part — the budget line — and no manifest widget flag", () => {
    const body = mod().widget!();
    expect(body.live).toBe(true);
    expect(body.parts).toEqual(["budget_line"]);
    expect(mod().manifest.widget).toBeUndefined();
  });

  test("a press near the line takes it; an indifference curve stays the card's", () => {
    const sc = sceneOf({});
    const parts = mod().widget!().parts;
    expect(partAt(sc, onLine(sc, 0.5), 18, parts)).toBe("budget_line");
    const ic = sc.lines.get("ic_3")![0];
    expect(partAt(sc, ic[Math.floor(ic.length / 2)], 18, parts)).toBeNull();
  });
});

describe("indifference_budget: a drag's patch", () => {
  const P = { income: 100, price_x: 2, price_y: 1 };

  test("the x end dragged in: price_x rises, the line turns about the y-intercept, through the pointer", () => {
    const sc = sceneOf(P);
    const from = onLine(sc, 0.95);
    const to = by(sc, from, -15, 0);
    const r = drag(P, from, to);
    expect(r.errors).toEqual([]);
    const patch = patchOf(r);
    expect(Object.keys(patch).sort()).toEqual(["price_x", "x_max", "y_max"]);
    expect(patch.price_x).toBeGreaterThan(2);
    // y-intercept unchanged (income/price_y = 100); the line passes the pointer.
    const [x, y] = sc.toDomain(to)!;
    expect(x / (100 / patch.price_x) + y / 100).toBeCloseTo(1, 2);
    // …and pins the axes where they stood (1.3 × the intercepts).
    expect(patch.x_max).toBeCloseTo(65, 2);
    expect(patch.y_max).toBeCloseTo(130, 2);
    expect(r.effects.some((e) => e.caption === "Changing the price of Good X")).toBe(true);
  });

  test("the y end turns about the x-intercept: price_y", () => {
    const sc = sceneOf({ ...P, y_good: "Housing" });
    const from = onLine(sc, 0.05);
    const r = drag({ ...P, y_good: "Housing" }, from, by(sc, from, 0, 20));
    const patch = patchOf(r);
    expect(Object.keys(patch).sort()).toEqual(["price_y", "x_max", "y_max"]);
    expect(patch.price_y).toBeLessThan(1);
    expect(r.effects.some((e) => e.caption === "Changing the price of Housing")).toBe(true);
  });

  test("the middle slides the line parallel: income, prices untouched", () => {
    const sc = sceneOf(P);
    const from = onLine(sc, 0.5);
    const to = by(sc, from, 5, 10);
    const patch = patchOf(drag(P, from, to));
    expect(Object.keys(patch).sort()).toEqual(["income", "x_max", "y_max"]);
    const [x, y] = sc.toDomain(to)!;
    expect(2 * x + 1 * y).toBeCloseTo(patch.income, 0);
  });

  test("clamps keep the line on the plot and every price positive", () => {
    const sc = sceneOf(P);
    const xEnd = onLine(sc, 0.95);
    const far = patchOf(drag(P, xEnd, by(sc, xEnd, 500, 0)));
    // Within the layout's own give-way bound (1.05 × the intercept), so the pinned frame holds.
    expect(100 / far.price_x).toBeLessThanOrEqual(far.x_max / 1.05);
    const through = patchOf(drag(P, xEnd, by(sc, xEnd, 0, 500)));
    expect(through.price_x).toBeGreaterThan(0);
    const mid = onLine(sc, 0.5);
    const big = patchOf(drag(P, mid, by(sc, mid, 400, 400)));
    expect(big.income / 2).toBeLessThanOrEqual(big.x_max / 1.05);
    expect(big.income / 1).toBeLessThanOrEqual(big.y_max / 1.05);
    const tiny = patchOf(drag(P, mid, by(sc, mid, -400, -400)));
    expect(tiny.income).toBeGreaterThan(0);
  });

  test("an existing pin is kept, and taps and other parts pass through", () => {
    const params = { ...P, x_max: 80, y_max: 150 };
    const sc = sceneOf(params);
    const from = onLine(sc, 0.5);
    const patch = patchOf(drag(params, from, by(sc, from, 3, 0)));
    expect(patch.x_max).toBe(80);
    expect(patch.y_max).toBe(150);
    const body = mod().widget!();
    const names = paramNamesOf(mod());
    expect(stepWidget(body, { said: null }, { type: "click", id: "budget_line", point: from, domain: null }, sc, names).effects).toEqual([]);
    expect(stepWidget(body, { said: null }, dragMoveEvent("ic_2", from, by(sc, from, 3, 0), sc), sc, names).effects).toEqual([]);
  });
});

describe("indifference_budget: live recompute", () => {
  test("a price rise dragged with a split on: A stays, B and C follow, the effects add up", () => {
    const params = { income: 100, price_x: 2, price_x_before: 2, price_y: 1, curves: 1 };
    const sc = sceneOf(params);
    const from = onLine(sc, 0.95);
    const run = runWidget(mod(), params, [dragMoveEvent("budget_line", from, by(sc, from, -20, 0), sc)]);
    expect(run.errors).toEqual([]);
    const v = mod().layout!(run.params).values!;
    expect(run.params.price_x as number).toBeGreaterThan(2);
    expect(v.x_before).toBeCloseTo(25, 2);
    expect(v.x).toBeLessThan(25);
    expect(v.substitution + v.income_effect).toBeCloseTo(v.x - v.x_before, 1);
    // The axes held: the pinned frame is the one pressed on.
    expect(mod().layout!(run.params).frame!.x[1]).toBeCloseTo(sc.toDomain(sc.toLogical([65, 0]))![0], 6);
  });
});

describe("indifference_budget: figures a drag reaches are lint-clean", () => {
  test.each([1.2, 2, 3, 5, 8])("price_x %d on pinned axes, with and without a split", (px) => {
    const pin = { income: 100, price_y: 1, x_max: 65, y_max: 130 };
    expect(lintAt({ ...pin, price_x: px })).toEqual([]);
    expect(lintAt({ ...pin, price_x: px, price_x_before: 2, curves: 1 })).toEqual([]);
  });
});
