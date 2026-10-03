// Cards above the boxes (round 7 §5): drop by default (the cards on top,
// the boxes below), side (a column of cards on the left), rise (as before) —
// every layout on the canvas, the counter's row included.
import { describe, expect, test } from "vitest";
import { HEAD_ROOM_Y, cardsGeometry, counterAt, sortLayout, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

type P = [number, number];
const items = (n: number, bins: string[]) => Array.from({ length: n }, (_, i) => ({ text: `Card ${i + 1}`, bin: bins[i % bins.length] }));
const BINS = [["Fruit", "Not"], ["A", "B", "C"], ["A", "B", "C", "D"]];
const onCanvas = (p: P, w: number, h: number) => p[0] - w / 2 >= -0.5 && p[0] + w / 2 <= 1000.5 && p[1] - h / 2 >= -0.5 && p[1] + h / 2 <= 750.5;
const boxTop = (g: CardsGeometry) => Math.max(...g.binBoxes.map((b) => b.c[1] + b.h / 2));
const boxBottom = (g: CardsGeometry) => Math.min(...g.binBoxes.map((b) => b.c[1] - b.h / 2));
const boxLeft = (g: CardsGeometry) => Math.min(...g.binBoxes.map((b) => b.c[0] - b.w / 2));
const inside = (g: CardsGeometry, b: number, p: P) => {
  const box = g.binBoxes[b];
  return Math.abs(p[0] - box.c[0]) + g.w / 2 <= box.w / 2 + 0.5 && Math.abs(p[1] - box.c[1]) + g.h / 2 <= box.h / 2 + 0.5;
};
const allOnCanvas = (g: CardsGeometry) => {
  for (const bx of g.binBoxes) expect(onCanvas(bx.c as P, bx.w, bx.h)).toBe(true);
  for (const p of [...g.home, ...g.truth]) expect(onCanvas(p as P, g.w, g.h)).toBe(true);
  expect(counterAt(g)[1] - 12).toBeGreaterThanOrEqual(0);
};
/** The highest anything reaches: the tray, or the dealt card at its size. */
const topOf = (g: CardsGeometry) => Math.max(...g.home.map((p) => p[1] + (g.h * (g.deck ? g.deckScale ?? 1 : 1)) / 2), ...g.binBoxes.map((b) => b.c[1] + b.h / 2));
/** The counter (20 high) clear of every card where it can stand (tray, dealt card, truth slots). */
const counterClear = (g: CardsGeometry) => {
  const [cx, cy] = counterAt(g);
  const s = g.deck ? g.deckScale ?? 1 : 1;
  for (const p of g.home) expect(Math.abs(p[1] - cy) >= (g.h * s) / 2 + 10 || Math.abs(p[0] - cx) >= (g.w * s) / 2 + 40).toBe(true);
  for (const p of g.truth) expect(Math.abs(p[1] - cy) >= g.h / 2 + 10 || Math.abs(p[0] - cx) >= g.w / 2 + 40).toBe(true);
};

describe("drop (the default): the cards above the boxes", () => {
  // Spec §11: 2–4 boxes × 4–14 cards — a sort holds up to 8 (more: a deck, below).
  for (const bins of BINS)
    for (let n = 4; n <= 8; n++) {
      test(`sort: ${n} cards, ${bins.length} boxes`, () => {
        const g = cardsGeometry({ id: "s", type: "cards", bins, items: items(n, bins) } as CardsElementLike);
        expect(g.layout).toBe("drop");
        expect(Math.min(...g.home.map((p) => p[1] - g.h / 2))).toBeGreaterThan(boxTop(g));
        allOnCanvas(g);
        counterClear(g);
        // The headline's strip is left free (Review Focus 6).
        expect(topOf(g)).toBeLessThanOrEqual(HEAD_ROOM_Y + 0.5);
        for (let b = 0; b < bins.length; b++) for (let j = 0; j < n; j++) expect(inside(g, b, g.binSlot(b, j, n) as P)).toBe(true);
      });
    }
  for (const bins of [["Fruit", "Not"], ["A", "B", "C", "D"]])
    for (const n of [12, 14, 30]) {
      test(`deck: ${n} cards, ${bins.length} boxes — the dealt card over the boxes`, () => {
        const g = cardsGeometry({ id: "d", type: "cards", deck: true, bins, items: items(n, bins) } as CardsElementLike);
        const s = g.deckScale!;
        const [, cy] = g.home[0];
        expect(cy - (g.h * s) / 2).toBeGreaterThan(boxTop(g));
        expect(topOf(g)).toBeLessThanOrEqual(HEAD_ROOM_Y + 0.5);
        allOnCanvas(g);
        counterClear(g);
      });
    }
  for (const n of [4, 6, 8, 10, 14])
    test(`select: ${n} cards above the one box`, () => {
      const g = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: Array.from({ length: n }, (_, i) => (i % 2 ? `Fish ${i}` : { text: `Mammal ${i}`, in: true })) } as CardsElementLike);
      expect(g.layout).toBe("drop");
      expect(Math.min(...g.home.map((p) => p[1] - g.h / 2))).toBeGreaterThan(boxTop(g));
      expect(topOf(g)).toBeLessThanOrEqual(HEAD_ROOM_Y + 0.5);
      allOnCanvas(g);
      counterClear(g);
      for (let j = 0; j < Math.ceil(n / 2); j++) expect(inside(g, 0, g.binSlot(0, j, n) as P)).toBe(true);
    });
  test("an explicit y is the top of the whole block (the tray), not the boxes' top", () => {
    const g = cardsGeometry({ id: "s", type: "cards", y: 600, bins: ["A", "B"], items: items(6, ["A", "B"]) } as CardsElementLike);
    expect(Math.max(...g.home.map((p) => p[1] + g.h / 2))).toBeCloseTo(600, 5);
    allOnCanvas(g);
  });
});

describe("side: the cards a column on the left, the boxes on the right", () => {
  for (const bins of BINS)
    for (let n = 4; n <= 8; n++) {
      test(`sort: ${n} cards, ${bins.length} boxes`, () => {
        const g = cardsGeometry({ id: "s", type: "cards", arrange: "side", bins, items: items(n, bins) } as CardsElementLike);
        expect(g.layout).toBe("side");
        expect(Math.max(...g.home.map((p) => p[0] + g.w / 2))).toBeLessThan(boxLeft(g));
        allOnCanvas(g);
        counterClear(g);
        expect(topOf(g)).toBeLessThanOrEqual(HEAD_ROOM_Y + 0.5);
        // Readable on a phone: the cards never narrow to the 16-unit text (4 boxes: the tray takes a quarter).
        expect(g.w).toBeGreaterThanOrEqual(90);
        // 8 in a column over the caption band (page frame 2026-10-04): the boxes' column of 8 takes it to 15.
        expect(g.font ?? 20).toBeGreaterThanOrEqual(n === 8 ? 15 : 18);
      });
    }
  for (const n of [4, 6, 8])
    test(`select: ${n} cards in a column, the box on the right`, () => {
      const g = cardsGeometry({ id: "z", type: "cards", select: "Mammals", arrange: "side", items: Array.from({ length: n }, (_, i) => (i % 2 ? `Fish ${i}` : { text: `Mammal ${i}`, in: true })) } as CardsElementLike);
      expect(g.layout).toBe("side");
      expect(Math.max(...g.home.map((p) => p[0] + g.w / 2))).toBeLessThan(boxLeft(g));
      allOnCanvas(g);
      counterClear(g);
    });
  test("a deck of 8: the dealt card on the left of the boxes", () => {
    const g = cardsGeometry({ id: "d", type: "cards", deck: true, arrange: "side", bins: ["A", "B"], items: items(8, ["A", "B"]) } as CardsElementLike);
    expect(g.layout).toBe("side");
    expect(g.home[0][0] + (g.w * g.deckScale!) / 2).toBeLessThan(boxLeft(g));
    allOnCanvas(g);
  });
  test("more than 8 cards fall back to drop; lint says so", () => {
    expect(sortLayout({ arrange: "side" }, 12)).toBe("drop");
    const el = { id: "d", type: "cards", deck: true, arrange: "side", bins: ["A", "B"], items: items(12, ["A", "B"]) };
    expect(cardsGeometry(el as CardsElementLike).layout).toBe("drop");
    const spec = { elements: [el], commands: [] } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "cards-side")).toHaveLength(1);
  });
});

describe("rise: the boxes on top, as before", () => {
  test("sort: the boxes' top at 660, the cards below them, the counter between", () => {
    const g = cardsGeometry({ id: "s", type: "cards", arrange: "rise", bins: ["A", "B"], items: items(6, ["A", "B"]) } as CardsElementLike);
    expect(g.layout).toBe("rise");
    expect(boxTop(g)).toBeCloseTo(660, 5);
    expect(Math.max(...g.home.map((p) => p[1] + g.h / 2))).toBeLessThan(boxBottom(g));
    counterClear(g);
  });
  for (const n of [4, 12, 30])
    test(`deck of ${n}: the counter clear of the dealt card under the boxes`, () => {
      const g = cardsGeometry({ id: "d", type: "cards", deck: true, arrange: "rise", bins: ["A", "B"], items: items(n, ["A", "B"]) } as CardsElementLike);
      allOnCanvas(g);
      counterClear(g);
    });
  test("rank keeps row and column", () => {
    const col = cardsGeometry({ id: "r", type: "cards", arrange: "column", items: ["A", "B", "C"] } as CardsElementLike);
    expect(col.slots[0][0]).toBeCloseTo(col.slots[1][0], 5);
    expect(col.layout).toBeUndefined();
  });
});
