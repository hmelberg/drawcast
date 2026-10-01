// Formula tiles stand under the formula as LAID OUT (design 2026-10-03 §5.3,
// Task 9 ruling B): a formula in a column, or placed with `at`, takes its tile
// row with it, and the cards geometry's homes are where the tiles are drawn.
import { beforeAll, describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { ensureEngines } from "../src/scenes/engines";
import { formulaBlanks } from "../src/formula/blanks";
import { cardsGeometryIn } from "../src/spec/cards";
import { expandSpec } from "../src/spec/expand";
import { formulaHooksFor } from "../src/render";
import { planCommands } from "../src/render/plan";
import type { Spec } from "../src/spec/types";

const TEX = "A = \\pi \\blank{r^2}";

function check(spec: Spec): void {
  const l = layoutSpec(spec);
  expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
  const bb = elementBBoxes(l);
  const formula = bb.get("area")!;
  const blanksOf = (id: string) => formulaBlanks(id, TEX).map((b) => bb.get(b.part)!);
  const homesOf = (id: string) => {
    const b = bb.get(id);
    return b ? ([b.x + b.w / 2, b.y + b.h / 2] as [number, number]) : null;
  };
  const g = cardsGeometryIn(spec, "area_tiles", blanksOf, homesOf)!;
  const tiles = g.cards.map((c) => bb.get(c)!);
  const left = Math.min(...tiles.map((t) => t.x));
  const right = Math.max(...tiles.map((t) => t.x + t.w));
  const top = Math.max(...tiles.map((t) => t.y + t.h));
  // The row is centred under the formula, about 30 below it.
  expect((left + right) / 2).toBeCloseTo(formula.x + formula.w / 2, 0);
  expect(formula.y - top).toBeGreaterThan(20);
  expect(formula.y - top).toBeLessThan(45);
  // The geometry's homes are where the tiles are drawn.
  g.home.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(tiles[i].x + tiles[i].w / 2, 0);
    expect(p[1]).toBeCloseTo(tiles[i].y + tiles[i].h / 2, 0);
  });
  // …and the right tile's truth is the blank's box.
  const box = bb.get("area_blank_1")!;
  const k = g.truthBin.indexOf(0);
  expect(g.truth[k][0]).toBeCloseTo(box.x + box.w / 2, 0);
}

describe("formula tiles follow the laid-out formula", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });
  const ask = { ask: { question: "Fill it", on: "area", others: ["2r", "d"] } };

  test("a formula inside a column", () => {
    check(
      expandSpec({
        elements: [
          { id: "t1", type: "text", text: "Circles", font_size: 30 },
          { id: "area", type: "math", tex: TEX },
          { id: "t2", type: "text", text: "and their area", font_size: 30 },
          { id: "col", type: "group", members: ["t1", "area", "t2"], layout: "column", gap: 40, fit: "right" },
        ],
        commands: [{ draw: ["col"] }, ask],
      } as never),
    );
  });

  test("a formula placed with at", () => {
    check(
      expandSpec({
        elements: [
          { id: "title", type: "text", text: "The area of a circle", x: 300, y: 650, font_size: 30 },
          { id: "area", type: "math", tex: TEX, at: { ref: "title", side: "below", gap: 40 } },
        ],
        commands: [{ draw: ["title", "area"] }, ask],
      } as never),
    );
  });

  test("a formula near the canvas edge: the row stays on the canvas", () => {
    const spec = expandSpec({
      elements: [{ id: "area", type: "math", tex: TEX, x: 60, y: 40 }],
      commands: [{ draw: ["area"] }, { ask: { question: "Fill it", on: "area", others: ["2r", "d", "\\pi r", "4r^2", "r", "2\\pi r"] } }],
    } as never);
    const bb = elementBBoxes(layoutSpec(spec));
    for (let i = 1; i <= 7; i++) {
      const t = bb.get(`area_tiles_${i}`)!;
      expect(t.x).toBeGreaterThanOrEqual(19.5);
      expect(t.x + t.w).toBeLessThanOrEqual(980.5);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("render's wiring (formulaHooksFor)", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });

  test("cardsFor on the math id: the tiles, offsets into the laid-out boxes, the right tile given way", () => {
    const spec = expandSpec({
      elements: [
        { id: "t1", type: "text", text: "Circles", font_size: 30 },
        { id: "area", type: "math", tex: TEX },
        { id: "col", type: "group", members: ["t1", "area"], layout: "column", gap: 40 },
      ],
      commands: [{ draw: ["col"] }, { ask: { question: "Fill it", on: "area", others: ["2r", "d"] } }],
    } as never);
    const l = layoutSpec(spec);
    const bb = elementBBoxes(l);
    const hooks = formulaHooksFor(spec, bb, (x) => elementBBoxes(x));
    const g = hooks.cardsOn("area")!;
    expect(g.mode).toBe("fill");
    expect(g.id).toBe("area_tiles");
    const rt = hooks.formula("area")!;
    expect(rt.blanks.map((b) => b.tex)).toEqual(["r^2"]);
    expect(rt.boxes(null)[0]).toEqual(bb.get("area_blank_1"));
    expect(rt.patch(["r^2"]).find((e) => e.id === "area")).toMatchObject({ fills: ["r^2"] });
    expect(hooks.formula("t1")).toBeNull();
    const plan = planCommands(spec.commands, l.order, {
      formulaFor: (id) => (hooks.formula(id) ? { blanks: hooks.formula(id)!.blanks.length } : null),
      cardsFor: (id) => {
        const c = hooks.cardsOn(id);
        if (!c) return null;
        const offsets: Record<string, [number, number]> = {};
        c.cards.forEach((card, i) => (offsets[card] = [c.truth[i][0] - c.home[i][0], c.truth[i][1] - c.home[i][1]]));
        return { cards: c.cards, offsets, hides: c.cards.filter((_, i) => c.truthBin[i] >= 0) };
      },
    });
    const k = g.truthBin.indexOf(0);
    const tile = bb.get(g.cards[k])!;
    const box = bb.get("area_blank_1")!;
    const off = plan.states[1].offsets[g.cards[k]];
    expect(tile.x + tile.w / 2 + off[0]).toBeCloseTo(box.x + box.w / 2, 0);
    expect(tile.y + tile.h / 2 + off[1]).toBeCloseTo(box.y + box.h / 2, 0);
    // The ask draws the tiles: drawing the formula (its column) does not.
    for (const c of g.cards) expect(plan.states[0].visible).not.toContain(c);
    expect(plan.states[1].visible).not.toContain(g.cards[k]);
    expect(plan.states[1].visible).toContain(g.cards[(k + 1) % g.cards.length]);
    expect(plan.states[1].visible).not.toContain("area_blank_1");
  });
});
