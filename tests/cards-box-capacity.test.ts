// Every box holds every card (final fix wave E, item 2): a sort box or a
// deck's box wraps into more columns (or its cards shrink) so a card put in
// it is drawn inside it, never hanging below or piled on another card.

import { describe, expect, test } from "vitest";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";

const inside = (g: CardsGeometry, b: number, p: [number, number]): boolean => {
  const box = g.binBoxes[b];
  return (
    p[0] - g.w / 2 >= box.c[0] - box.w / 2 - 0.5 &&
    p[0] + g.w / 2 <= box.c[0] + box.w / 2 + 0.5 &&
    p[1] - g.h / 2 >= box.c[1] - box.h / 2 - 0.5 &&
    p[1] + g.h / 2 <= box.c[1] + box.h / 2 + 0.5
  );
};
const apart = (g: CardsGeometry, ps: [number, number][]): boolean => {
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      if (Math.abs(ps[i][0] - ps[j][0]) < g.w - 0.5 && Math.abs(ps[i][1] - ps[j][1]) < g.h - 0.5) return false;
    }
  return true;
};
const items = (n: number, bins: string[]) => Array.from({ length: n }, (_, i) => ({ text: `Card ${i + 1}`, bin: bins[i % bins.length] }));

describe("every card fits in any one box", () => {
  for (const [n, bins] of [
    [4, ["Fruit", "Not"]],
    [6, ["Fruit", "Not"]],
    [9, ["A", "B", "C"]],
    [8, ["A", "B", "C", "D"]],
  ] as [number, string[]][]) {
    test(`sort: ${n} cards, ${bins.length} boxes — all in box 1, each inside it, none on another`, () => {
      const g = cardsGeometry({ id: "s", type: "cards", bins, items: items(n, bins) } as unknown as CardsElementLike);
      for (let b = 0; b < bins.length; b++) {
        const ps = Array.from({ length: g.cards.length }, (_, j) => g.binSlot(b, j, g.cards.length) as [number, number]);
        expect(ps.every((p) => inside(g, b, p))).toBe(true);
        expect(apart(g, ps)).toBe(true);
      }
    });
  }

  for (const [n, bins] of [
    [12, ["Fruit", "Not"]],
    [30, ["Fruit", "Not"]],
    [30, ["A", "B", "C", "D"]],
  ] as [number, string[]][]) {
    test(`deck: ${n} cards, ${bins.length} boxes — all in one box, each inside it, none on another`, () => {
      const g = cardsGeometry({ id: "d", type: "cards", deck: true, bins, items: items(n, bins) } as unknown as CardsElementLike);
      for (let b = 0; b < bins.length; b++) {
        const ps = Array.from({ length: g.cards.length }, (_, j) => g.binSlot(b, j, g.cards.length) as [number, number]);
        expect(ps.every((p) => inside(g, b, p))).toBe(true);
        expect(apart(g, ps)).toBe(true);
      }
      // The dealt card's text is large: ≥ 26 canvas units, about 10 px on a 390 px phone.
      expect((g.font ?? 15) * (g.deckScale ?? 1)).toBeGreaterThanOrEqual(26);
      // The boxes stay above the dealt card.
      expect(g.binBoxes.every((box) => box.c[1] - box.h / 2 > g.home[0][1] + (g.h * (g.deckScale ?? 1)) / 2)).toBe(true);
    });
  }
});

test("select: the cards' text is read on a phone (≥ 26 canvas units, about 10 px at 390 px)", () => {
  const g = cardsGeometry({ id: "m", type: "cards", select: "Mammals", items: ["Whale", "Shark", "Bat", "Penguin", "Hedgehog", "Crocodile", "Octopus", "Dolphin"] } as unknown as CardsElementLike);
  expect(g.font ?? 20).toBeGreaterThanOrEqual(26);
});

describe("sort with many boxes stays on the canvas (fix round 2)", () => {
  for (const k of [3, 4, 5])
    for (let n = 6; n <= 12; n++) {
      test(`${k} boxes, ${n} cards: boxes, tray and every slot inside 1000×750; all cards fit in any one box`, () => {
        const bins = ["A", "B", "C", "D", "E"].slice(0, k);
        const g = cardsGeometry({ id: "s", type: "cards", bins, items: items(n, bins) } as unknown as CardsElementLike);
        const m = g.cards.length;
        const onCanvas = (p: [number, number], w: number, h: number) => p[0] - w / 2 >= 0 && p[0] + w / 2 <= 1000 && p[1] - h / 2 >= 0 && p[1] + h / 2 <= 750;
        for (const bx of g.binBoxes) expect(onCanvas(bx.c as [number, number], bx.w, bx.h)).toBe(true);
        for (const p of g.home) expect(onCanvas(p as [number, number], g.w, g.h)).toBe(true);
        for (let b = 0; b < g.binBoxes.length; b++) {
          const ps = Array.from({ length: m }, (_, j) => g.binSlot(b, j, m) as [number, number]);
          expect(ps.every((p) => inside(g, b, p))).toBe(true);
          expect(apart(g, ps)).toBe(true);
        }
      });
    }
});
