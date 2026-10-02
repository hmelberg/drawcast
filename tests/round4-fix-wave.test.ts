// Round 4 fix wave (2026-10-03, task W): engine fixes found by the browser
// check and the generated test casts.
import { beforeAll, describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { ensureEngines } from "../src/scenes/engines";
import { expandSpec } from "../src/spec/expand";
import { cardsPlanFor, formulaHooksFor, guessPartsFor, planOptionsFor } from "../src/render";
import { planCommands } from "../src/render/plan";
import type { Spec } from "../src/spec/types";

const TEX = "A = \\pi \\blank{r^2}";

function planOf(spec: Spec) {
  const l = layoutSpec(spec);
  const bb = elementBBoxes(l);
  const hooks = formulaHooksFor(spec, bb, (x) => elementBBoxes(x));
  return planCommands(spec.commands, l.order, {
    formulaFor: (id) => (hooks.formula(id) ? { blanks: hooks.formula(id)!.blanks.length } : null),
    cardsFor: (id) => cardsPlanFor(hooks.cardsOn(id)),
    guessParts: guessPartsFor(spec, l),
    bboxOf: (id) => bb.get(id) ?? null,
    ...planOptionsFor(spec, l),
  });
}

describe("formula boxes and tiles (fix wave items 1, 2)", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });

  test("drawing a formula draws its blank boxes with it", () => {
    const spec = expandSpec({
      elements: [{ id: "area", type: "math", tex: TEX, x: 500, y: 400 }],
      commands: [{ draw: ["area"] }, { ask: { question: "Fill it", on: "area", others: ["2r", "d"] } }],
    } as never);
    const plan = planOf(spec);
    expect(plan.states[0].visible).toContain("area");
    expect(plan.states[0].visible).toContain("area_blank_1");
    // …until the reveal takes them away.
    expect(plan.states[1].visible).not.toContain("area_blank_1");
  });

  test("after the reveal no tile stays: the right ones give way to the glyphs, the wrong ones go home and leave", () => {
    const spec = expandSpec({
      elements: [{ id: "area", type: "math", tex: TEX, x: 500, y: 400 }],
      commands: [{ draw: ["area"] }, { ask: { question: "Fill it", on: "area", others: ["2r", "d"] } }, { speak: "And so on." }],
    } as never);
    const plan = planOf(spec);
    for (let i = 1; i <= 3; i++) expect(plan.states[1].visible).not.toContain(`area_tiles_${i}`);
    expect(plan.states.at(-1)!.visible.filter((id) => id.startsWith("area_tiles_"))).toEqual([]);
  });

  test("erasing (or hiding) a formula takes its boxes and tiles with it", () => {
    const spec = expandSpec({
      elements: [{ id: "area", type: "math", tex: TEX, x: 500, y: 400 }, { id: "n", type: "text", text: "next", x: 500, y: 200 }],
      commands: [{ draw: ["area"] }, { show: ["area_tiles"] }, { erase: ["area"] }, { draw: ["n"] }, { ask: { question: "Fill it", on: "area", others: ["2r", "d"] } }],
    } as never);
    const plan = planOf(spec);
    expect(plan.states[1].visible).toContain("area_tiles_1");
    expect(plan.states[2].visible.filter((id) => id.startsWith("area"))).toEqual([]);
  });

  test("a tile row wider than the canvas wraps into two rows, all on the canvas", () => {
    const wide = ["\\frac{a+b+c}{2}", "\\sqrt{a^2+b^2+c^2}", "\\frac{\\pi r^2}{4}", "\\frac{2\\pi r}{3}", "\\sqrt{2\\pi r^2}", "\\frac{a b c}{d e f}", "\\frac{x+y}{x-y}"];
    const spec = expandSpec({
      elements: [{ id: "area", type: "math", tex: TEX, x: 120, y: 500 }],
      commands: [{ draw: ["area"] }, { ask: { question: "Fill it", on: "area", others: wide } }],
    } as never);
    const bb = elementBBoxes(layoutSpec(spec));
    const tiles = Array.from({ length: 8 }, (_, i) => bb.get(`area_tiles_${i + 1}`)!);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(19.5);
      expect(t.x + t.w).toBeLessThanOrEqual(980.5);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(tiles.map((t) => Math.round(t.y))).size).toBe(2);
    // No two tiles overlap.
    for (let i = 0; i < tiles.length; i++)
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i], b = tiles[j];
        const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
        expect(overlap).toBe(false);
      }
  });

  test("a formula that drew nothing (a math error) still keeps its tile row on the canvas", () => {
    const spec = expandSpec({
      elements: [{ id: "dist", type: "math", tex: "d = \\blank{\\frac{1}{2}}\\,v\\,t \\badmacro{", x: 60, y: 300 }],
      commands: [{ draw: ["dist"] }, { ask: { question: "Which tile?", on: "dist", others: ["1", "2", "\\frac{1}{4}"] } }],
    } as never);
    const bb = elementBBoxes(layoutSpec(spec));
    for (let i = 1; i <= 4; i++) {
      const t = bb.get(`dist_tiles_${i}`)!;
      expect(t.x).toBeGreaterThanOrEqual(19.5);
      expect(t.x + t.w).toBeLessThanOrEqual(980.5);
    }
  });
});

describe("a scale's answer marker goes with its scale (fix wave item 7)", () => {
  const scaleSpec = (after: unknown[]) =>
    expandSpec({
      elements: [{ id: "s", type: "scale", min: 0, max: 12, value: 5, unit: "months", x: 150, y: 300 }],
      commands: [{ draw: ["s"] }, { ask: { question: "How long?", on: "s", store: "m" } }, ...after],
    } as never);

  test("erasing the scale erases its answer", () => {
    const plan = planOf(scaleSpec([{ erase: ["s"] }]));
    expect(plan.states[1].visible).toContain("s_answer_num");
    expect(plan.states[2].visible.filter((id) => id.startsWith("s_"))).toEqual([]);
  });

  test("moving the scale carries its answer", () => {
    const plan = planOf(scaleSpec([{ move: { target: "s", by: [0, 100] } }]));
    expect(plan.states[2].offsets["s_line"]).toEqual([0, 100]);
    expect(plan.states[2].offsets["s_answer_num"]).toEqual([0, 100]);
    expect(plan.states[2].offsets["s_answer_pin"]).toEqual([0, 100]);
  });
});

describe("market copy marks (fix wave item 4)", async () => {
  const { guessMarks } = await import("../src/guess/marks");
  const { guessParts, guessSetup } = await import("../src/guess/handles");
  const { withOverrides } = await import("../src/render/params");
  const params = { demand: { steepness: "medium" }, supply: { steepness: "medium" }, tax: { amount: 0, side: "seller", kind: "per_unit" } };
  const spec = expandSpec({ template: "supply_demand", params, commands: [] } as unknown as Spec);
  const layout = layoutSpec(spec);
  const setup = guessSetup(spec, params, layout, guessParts(spec, "supply_curve"), {
    end: { params: withOverrides(params, { "tax.amount": 20 }), targets: { "tax.amount": 20 } },
  });
  const h = setup.handles[0];
  const plot = [h.toLogical!([0, 0]), h.toLogical!([100, 100])];
  const inPlot = ([x, y]: [number, number]) =>
    x >= Math.min(plot[0][0], plot[1][0]) - 0.5 && x <= Math.max(plot[0][0], plot[1][0]) + 0.5 && y >= Math.min(plot[0][1], plot[1][1]) - 0.5 && y <= Math.max(plot[0][1], plot[1][1]) + 0.5;

  test("while asked: the copy is solid and thicker, with handle dots at the middle and both ends", () => {
    expect(h.kind).toBe("market");
    const m = guessMarks([h], [[0, 0]], 0, { asking: true });
    const copy = m.lines[0];
    expect(copy.dashed).toBeFalsy();
    expect(copy.width).toBeGreaterThan(3);
    expect(m.dots?.length).toBe(3);
  });

  test("while dragged: the shift from the old curve is bracketed and written, once for a parallel move", () => {
    const m = guessMarks([h], [[-10, -10]], 0, { asking: true });
    const brackets = m.lines.filter((l) => l.pts.length === 2 && l.dashed);
    expect(brackets.length).toBe(2);
    expect(m.texts.length).toBe(1);
    expect(m.texts[0].text.startsWith("−")).toBe(true);
    const turn = guessMarks([h], [[-10, 5]], 0, { asking: true });
    expect(turn.texts.map((x) => x.text[0]).sort()).toEqual(["+", "−"]);
  });

  test("no shift while untouched, with shift: false, or after the question", () => {
    expect(guessMarks([h], [[0, 0]], 0, { asking: true }).texts).toEqual([]);
    expect(guessMarks([h], [[-10, -10]], 0, { asking: true, shift: false }).texts).toEqual([]);
    expect(guessMarks([h], [[-10, -10]], 0).texts).toEqual([]);
  });

  test("the copy is clipped to the plot area", () => {
    for (const asking of [true, false]) {
      const m = guessMarks([h], [[-70, -70]], 0, { asking });
      const copy = m.lines.filter((l) => l.pts.length > 2);
      expect(copy.length).toBeGreaterThan(0);
      for (const l of copy) for (const p of l.pts) expect(inPlot(p as [number, number])).toBe(true);
      for (const d of m.dots ?? []) expect(inPlot(d.at as [number, number])).toBe(true);
    }
  });

  test("after the reveal: a dashed, lighter ghost; gap brackets at least 12 px wide with the gap written; an open dot wider than the equilibrium dot", () => {
    const m = guessMarks([h], [[5, 5]], 1);
    const ghost = m.lines[0];
    expect(ghost.dashed).toBe(true);
    expect(ghost.opacity).toBeLessThan(1);
    expect(m.dots ?? []).toEqual([]);
    const ticks = m.lines.filter((l) => l.pts.length === 2 && Math.abs(l.pts[0][1] - l.pts[1][1]) < 0.01 && Math.abs(l.pts[0][0] - l.pts[1][0]) >= 12);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(m.texts.length).toBeGreaterThanOrEqual(1);
    const ring = m.lines.find((l) => l.closed)!;
    const xs = ring.pts.map((p) => p[0]);
    expect((Math.max(...xs) - Math.min(...xs)) / 2).toBeGreaterThanOrEqual(10);
  });
});

describe("the poster keeps the answers back (fix wave item 6)", async () => {
  const { posterOf } = await import("../src/render/plan");
  test("a cast with no answer on the figure: the poster is the finished drawing", () => {
    const plan = planCommands([{ draw: ["a"] }, { speak: "Hi." }, { draw: ["b"] }], ["a", "b"], {});
    expect(posterOf(plan)).toEqual({ at: plan.steps.length, hide: [] });
  });
  test("a tree pick: the poster is the boundary before the first answer-on-the-figure ask, without the best and prune marks", () => {
    const ids = ["edge_start_a", "best_start_a", "prune_start_b", "value_a", "n"];
    const plan = planCommands(
      [{ draw: ids.slice(0, 4) }, { speak: "Which?" }, { ask: { question: "Pick", pick: "start", store: "c" } }, { draw: ["n"] }],
      ids,
      {},
    );
    const p = posterOf(plan);
    expect(p.at).toBe(2);
    expect(p.hide.sort()).toEqual(["best_start_a", "prune_start_b"]);
  });
  test("a formula ask and a guess ask count too", () => {
    const f = planCommands([{ draw: ["area"] }, { ask: { question: "Fill", on: "area", others: ["d"] } }], ["area", "area_blank_1"], { formulaFor: (id) => (id === "area" ? { blanks: 1 } : null) });
    expect(posterOf(f).at).toBe(1);
    const g = planCommands([{ draw: ["bar"] }, { speak: "Guess." }, { ask: { question: "How tall?", on: "bar" } }], ["bar"], { guessParts: () => ({ parts: ["bar"], shows: ["bar"] }) });
    expect(posterOf(g).at).toBe(2);
  });
});

describe("lint (fix wave item 9)", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });
  test("a colors key on a math element with steps may match a later step's TeX", () => {
    const spec = expandSpec({
      elements: [{ id: "eq", type: "math", tex: "W = F\\,d", x: 500, y: 600, colors: { v: "#2f6b8f", q: "#aa0000" }, steps: ["W = m\\frac{v}{t}\\cdot d", "W = \\frac{1}{2}mv^2"] }],
      commands: [{ draw: ["eq"] }, { step: "eq" }, { step: "eq" }],
    } as never);
    const l = layoutSpec(spec);
    const warned = l.warnings.filter((w) => w.includes("colors key"));
    expect(warned.some((w) => w.includes('"v"'))).toBe(false);
    expect(warned.some((w) => w.includes('"q"'))).toBe(true);
  });
});

describe("boundary params carry a tree's answers (fix wave item 10)", async () => {
  const { boundaryParams } = await import("../src/render/plan");
  test("a boundary before a tree ask: its blanks are '?' in the params a widget or the tray lays out from", () => {
    const plan = planCommands([{ draw: ["value_treat"] }, { ask: { question: "EV?", blanks: ["value_treat"] } }], ["value_treat"], {});
    expect(boundaryParams(plan, 1)).toEqual({ answers: { value_treat: "?" } });
    expect(boundaryParams(plan, 2)).toEqual({});
  });
});
