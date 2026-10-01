// Round 4 fix wave (2026-10-03, task W): engine fixes found by the browser
// check and the generated test casts.
import { beforeAll, describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { ensureEngines } from "../src/scenes/engines";
import { expandSpec } from "../src/spec/expand";
import { cardsPlanFor, formulaHooksFor, planOptionsFor } from "../src/render";
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
