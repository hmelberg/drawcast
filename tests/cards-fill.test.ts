import { beforeAll, describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { drawablesForId } from "../src/layout/model";
import { ensureEngines } from "../src/scenes/engines";
import { formulaBlanks } from "../src/formula/blanks";
import { authoredCards, cardsGeometry, cardsGeometryIn, cardsElements, type CardsElementLike } from "../src/spec/cards";
import { cardsMarks, cardsTruth, decodeArrangement, drop, encodeArrangement, initialArrangement, positions, rightCards, scoreCards } from "../src/cards/model";
import { expandFormulaTiles, expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const tiles: CardsElementLike = { id: "area_tiles", type: "cards", fill: "area", items: [{ text: "r^2", blank: 1 }, { text: "2r" }, { text: "d" }] };
const blanksOf = (id: string) => (id === "area" ? [{ x: 100, y: 100, w: 40, h: 30 }] : null);

describe("fill", () => {
  const g = cardsGeometry(tiles, undefined, blanksOf);

  test("geometry: the blanks are the boxes; wrong tiles have no box", () => {
    expect(g.mode).toBe("fill");
    expect(g.truthBin).toEqual([0, -1, -1]);
    expect(g.binBoxes).toHaveLength(1);
    expect(g.binBoxes[0].c).toEqual([120, 115]);
    expect(g.binSlot(0, 0)).toEqual([120, 115]);
    expect(g.truth[0]).toEqual([120, 115]);
    expect(g.truth[1]).toEqual(g.home[1]);
    expect(g.texts).toEqual(["r^2", "2r", "d"]);
    expect(g.cards).toEqual(["area_tiles_1", "area_tiles_2", "area_tiles_3"]);
  });

  test("one tile per box: a drop on a full box swaps, the old tile goes home", () => {
    let a = initialArrangement(g);
    expect(a.boxes).toEqual([[]]);
    a = drop(g, a, 1, g.binBoxes[0].c);
    expect(a.boxes[0]).toEqual([1]);
    a = drop(g, a, 0, g.binBoxes[0].c);
    expect(a.boxes[0]).toEqual([0]);
    const pos = positions(g, a);
    expect(pos[1]).toEqual(g.home[1]);
    expect(pos[0]).toEqual(g.binSlot(0, 0));
    a = drop(g, a, 0, [900, 900]);
    expect(a.boxes[0]).toEqual([]);
  });

  test("two blanks close together: a tile goes to the NEAREST box within reach, not the first (final review 2026-10-03)", () => {
    const two: CardsElementLike = { id: "f_tiles", type: "cards", fill: "f", items: [{ text: "a", blank: 1 }, { text: "b", blank: 2 }, { text: "c" }] };
    const near = (id: string) => (id === "f" ? [{ x: 100, y: 100, w: 30, h: 30 }, { x: 140, y: 100, w: 30, h: 30 }] : null);
    const g2 = cardsGeometry(two, undefined, near);
    const [b1, b2] = g2.binBoxes;
    // Both boxes are within reach of a point just right of the middle (the reach is tile-width based).
    const p: [number, number] = [(b1.c[0] + b2.c[0]) / 2 + 6, b2.c[1]];
    expect(Math.abs(p[0] - b1.c[0])).toBeLessThanOrEqual(Math.max(b1.w, g2.w) / 2 + 10);
    expect(drop(g2, initialArrangement(g2), 0, p).boxes).toEqual([[], [0]]);
    expect(drop(g2, initialArrangement(g2), 0, [b2.c[0] - 3, b2.c[1]]).boxes).toEqual([[], [0]]);
    expect(drop(g2, initialArrangement(g2), 0, [b1.c[0] + 3, b1.c[1]]).boxes).toEqual([[0], []]);
  });

  test("scoring counts the blanks, not the tiles", () => {
    expect(scoreCards(g, { order: [], boxes: [[0]] })).toEqual({ within: 1, count: 1, ok: true });
    expect(scoreCards(g, { order: [], boxes: [[1]] })).toEqual({ within: 0, count: 1, ok: false });
    expect(scoreCards(g, { order: [], boxes: [[]] })).toEqual({ within: 0, count: 1, ok: false });
    expect(rightCards(g, cardsTruth(g))).toEqual([true]);
    expect(cardsTruth(g).boxes).toEqual([[0]]);
  });

  test("a tile equal to the blank after spaces and outer braces is right", () => {
    const dup = cardsGeometry({ ...tiles, items: [{ text: "r^2", blank: 1 }, { text: "{r^2 }" }] }, undefined, blanksOf);
    expect(scoreCards(dup, { order: [], boxes: [[1]] }).ok).toBe(true);
  });

  test("encode/decode round-trips; bad strings are refused", () => {
    for (const a of [{ order: [], boxes: [[0]] }, { order: [], boxes: [[]] }, { order: [], boxes: [[2]] }]) {
      expect(decodeArrangement(g, encodeArrangement(g, a))).toEqual(a);
    }
    expect(decodeArrangement(g, "0,1")).toBeNull();
    expect(decodeArrangement(g, "0|1")).toBeNull();
    expect(decodeArrangement(g, "7")).toBeNull();
  });

  test("marks: a wrong tile in a box leaves a struck-through copy above it", () => {
    const m = cardsMarks(g, { order: [], boxes: [[1]] });
    expect(m.texts).toHaveLength(1);
    expect(m.texts[0].text).toBe("2r");
    expect(m.texts[0].anchor).toBe("middle");
    expect(m.texts[0].at[0]).toBeCloseTo(120);
    expect(m.texts[0].at[1]).toBeGreaterThan(130);
    expect(m.lines).toHaveLength(1);
    expect(cardsMarks(g, { order: [], boxes: [[0]] }).texts).toHaveLength(0);
  });

  test("elements: each tile is a box with its TeX (the node's tex)", () => {
    const els = cardsElements(tiles);
    const card = els.find((e) => e.id === "area_tiles_1")!;
    expect(card.type).toBe("node");
    expect(card.text).toBeUndefined();
    expect(card.tex).toBe("r^2");
    expect(card.font_size).toBe(22);
    expect(card.height).toBe(48);
    expect(card.width).toBeGreaterThanOrEqual(56);
  });
});

describe("the expansion", () => {
  const math = { id: "area", type: "math", tex: "A = \\pi \\blank{r^2}", x: 500, y: 400 };
  const spec = (ask: Record<string, unknown>): Spec => ({ elements: [math], commands: [{ draw: ["area"] }, { ask: { question: "Fill it", on: "area", ...ask } }] } as never);

  test("an ask with others adds the tiles as a cards element", () => {
    const out = expandFormulaTiles(spec({ others: ["2r", "d"] }));
    const el = out.elements!.find((e) => e.id === "area_tiles") as unknown as CardsElementLike;
    expect(el.type).toBe("cards");
    expect(el.fill).toBe("area");
    expect(el.items).toHaveLength(3);
    expect(el.items).toContainEqual({ text: "r^2", blank: 1 });
    expect(el.items).toContainEqual({ text: "2r" });
    expect(el.items).toContainEqual({ text: "d" });
  });

  test("the shuffle is seeded by the content: the right tile's place varies by question, the same question always the same (final review 2026-10-03)", () => {
    const rightAt = (id: string, blank: string, others: string[]): number => {
      const m = { id, type: "math", tex: `y = \\blank{${blank}}`, x: 500, y: 400 };
      const out = expandFormulaTiles({ elements: [m], commands: [{ ask: { question: "?", on: id, others } }] } as never);
      const el = out.elements!.find((e) => e.id === `${id}_tiles`) as unknown as CardsElementLike;
      return el.items.findIndex((it) => typeof it === "object" && it !== null && "blank" in it);
    };
    // Deterministic: movies and the round-trip see the same row every time.
    expect(rightAt("f", "x^2", ["2x", "x", "1"])).toBe(rightAt("f", "x^2", ["2x", "x", "1"]));
    // Same count, different content: the right tile is not always in the same place.
    const places = new Set<number>();
    for (const [id, blank, others] of [
      ["f", "x^2", ["2x", "x", "1"]], ["g", "2x", ["x^2", "x", "2"]], ["h", "\\pi r^2", ["2\\pi r", "r", "d"]],
      ["k", "mc^2", ["mc", "m", "c^2"]], ["eq", "b^2 - 4ac", ["b^2", "4ac", "2a"]], ["area", "r^2", ["2r", "d", "r"]],
    ] as [string, string, string[]][]) places.add(rightAt(id, blank, others));
    expect(places.size).toBeGreaterThan(1);
  });

  test("expandSpec: the tiles expand like any cards, validate, and read back", () => {
    const out = expandSpec(spec({ others: ["2r", "d"] }));
    expect(validateSpec(out).ok).toBe(true);
    const back = authoredCards(out).find((c) => c.id === "area_tiles")!;
    expect(back.fill).toBe("area");
    expect(back.items).toHaveLength(3);
    const g = cardsGeometryIn(out, "area_tiles", blanksOf)!;
    expect(g.mode).toBe("fill");
    expect([...g.truthBin].sort()).toEqual([-1, -1, 0]);
  });

  test("once per formula; a typed-only ask adds nothing", () => {
    const twice = expandFormulaTiles({ elements: [math], commands: [{ ask: { question: "a", on: "area", others: ["d"] } }, { ask: { question: "b", on: "area", others: ["d"] } }] } as never);
    expect(twice.elements!.filter((e) => e.id === "area_tiles")).toHaveLength(1);
    const typed = spec({});
    expect(expandFormulaTiles(typed)).toBe(typed);
    const noBlanks = { elements: [{ id: "area", type: "math", tex: "A = \\pi r^2" }], commands: [{ ask: { question: "a", on: "area", others: ["d"] } }] } as never as Spec;
    expect(expandFormulaTiles(noBlanks)).toBe(noBlanks);
  });
});

describe("tiles in layout (real mathjax)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });

  test("each tile draws its TeX with it; the tiles stand under the formula; the truth is the blank's box", () => {
    const spec = expandSpec({ elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}", x: 500, y: 400 }], commands: [{ draw: ["area"] }, { ask: { question: "Fill it", on: "area", others: ["2r", "d"] } }] } as never);
    const l = layoutSpec(spec);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    const ids = drawablesForId(l.drawables, "area_tiles_1").map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["area_tiles_1", "area_tiles_1_text"]));
    const bb = elementBBoxes(l);
    const blanksOf = (id: string) => formulaBlanks(id, "A = \\pi \\blank{r^2}").map((b) => bb.get(b.part)!);
    // The tiles are drawn where layout puts them (under the formula as laid out).
    const homesOf = (id: string) => {
      const b = bb.get(id);
      return b ? ([b.x + b.w / 2, b.y + b.h / 2] as [number, number]) : null;
    };
    const g = cardsGeometryIn(spec, "area_tiles", blanksOf, homesOf)!;
    const formula = bb.get("area")!;
    g.home.forEach((p, i) => {
      // Drawn where the geometry says, below the formula.
      const tile = bb.get(g.cards[i])!;
      expect(tile.x + tile.w / 2).toBeCloseTo(p[0], 0);
      expect(tile.y + tile.h / 2).toBeCloseTo(p[1], 0);
      expect(tile.y + tile.h).toBeLessThan(formula.y);
    });
    const right = g.truthBin.indexOf(0);
    const box = bb.get("area_blank_1")!;
    expect(g.truth[right][0]).toBeCloseTo(box.x + box.w / 2);
  });
});
