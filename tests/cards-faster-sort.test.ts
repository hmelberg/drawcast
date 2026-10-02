// Faster sorting (spec 2026-10-03-round6 §7): a tap sends a card to a box
// (sort and fill); "tap all the …" (`select`, a one-box sort whose items are
// in or out); and the deck (`deck: true`): one large card at a time, up to 30.
import { describe, expect, test } from "vitest";
import { cardsElements, cardsGeometry, authoredCards, type CardsElementLike } from "../src/spec/cards";
import { cardsTruth, decodeArrangement, encodeArrangement, initialArrangement, positions, rightCards, scoreCards, tapCard, tapTarget } from "../src/cards/model";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";

const two: CardsElementLike = {
  id: "costs",
  type: "cards",
  bins: ["Fixed", "Variable"],
  items: [
    { text: "Rent", bin: "Fixed" },
    { text: "Flour", bin: "Variable" },
    { text: "Insurance", bin: "Fixed" },
  ],
};
const three: CardsElementLike = { ...two, bins: ["Fixed", "Variable", "Mixed"], items: [...(two.items as never[]), { text: "Phone", bin: "Mixed" }] };

describe("tap to move", () => {
  test("two boxes: row → box 1 → box 2 → row (a tap on a card in the last box takes it out)", () => {
    const g = cardsGeometry(two);
    let a = initialArrangement(g);
    expect(tapTarget(g, a, 0)).toBe(0);
    a = tapCard(g, a, 0);
    expect(a.boxes[0]).toEqual([0]);
    a = tapCard(g, a, 0);
    expect(a.boxes).toEqual([[], [0]]);
    a = tapCard(g, a, 0);
    expect(a.boxes).toEqual([[], []]);
    expect(positions(g, a)[0]).toEqual(g.home[0]);
  });

  test("more boxes: row → 1 → 2 → 3 → row", () => {
    const g = cardsGeometry(three);
    let a = initialArrangement(g);
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      a = tapCard(g, a, 1);
      seen.push(a.boxes.findIndex((b) => b.includes(1)));
    }
    expect(seen).toEqual([0, 1, 2, -1]);
    expect(positions(g, a)[1]).toEqual(g.home[1]);
  });

  test("fill: a tile goes to the first empty blank, then on, and from the last blank back to the row", () => {
    const g = cardsGeometry({ id: "t", type: "cards", fill: "m", items: [{ text: "a", blank: 1 }, { text: "b", blank: 2 }, { text: "c" }] });
    let a = initialArrangement(g);
    a = tapCard(g, a, 1);
    expect(a.boxes).toEqual([[1], []]);
    a = tapCard(g, a, 0);
    expect(a.boxes).toEqual([[1], [0]]);
    // In the last blank → back to the row.
    a = tapCard(g, a, 0);
    expect(a.boxes).toEqual([[1], []]);
    expect(positions(g, a)[0]).toEqual(g.home[0]);
    // In blank 1 → on to blank 2.
    a = tapCard(g, a, 1);
    expect(a.boxes).toEqual([[], [1]]);
  });
});

const animals: CardsElementLike = {
  id: "zoo",
  type: "cards",
  select: "Mammals",
  items: [{ text: "Whale", in: true }, { text: "Shark", in: false }, { text: "Bat", in: true }, "Trout"],
};

describe("tap all the … (select)", () => {
  const g = cardsGeometry(animals);
  test("a one-box sort: in cards belong in the box, the rest stay in the row", () => {
    expect(g.mode).toBe("sort");
    expect(g.bins).toEqual(["Mammals"]);
    expect(g.truthBin).toEqual([0, -1, 0, -1]);
    expect(g.truth[1]).toEqual(g.home[1]);
    expect(g.truth[3]).toEqual(g.home[3]);
    // The box holds every card side by side, not one tall column.
    const ys = new Set([g.binSlot(0, 0)[1], g.binSlot(0, 1)[1], g.binSlot(0, 2)[1], g.binSlot(0, 3)[1]]);
    expect(ys.size).toBe(1);
    for (let j = 0; j < 4; j++) {
      const p = g.binSlot(0, j);
      const b = g.binBoxes[0];
      expect(Math.abs(p[0] - b.c[0]) + g.w / 2).toBeLessThanOrEqual(b.w / 2);
    }
  });

  test("tapping moves a card in or out; Answer judges every card", () => {
    let a = initialArrangement(g);
    expect(rightCards(g, a)).toEqual([false, true, false, true]);
    a = tapCard(g, a, 0);
    a = tapCard(g, a, 2);
    expect(scoreCards(g, a)).toEqual({ within: 4, count: 4, ok: true });
    a = tapCard(g, a, 1);
    expect(rightCards(g, a)).toEqual([true, false, true, true]);
    a = tapCard(g, a, 1);
    expect(a.boxes[0]).toEqual([0, 2]);
    expect(decodeArrangement(g, encodeArrangement(g, a))).toEqual(a);
    expect(encodeArrangement(g, cardsTruth(g))).toBe("0,2");
  });

  test("validates, expands with the box titled by select, and carries it back", () => {
    const spec = expandSpec({ commands: [], elements: [animals as never] } as Spec);
    expect(validateSpec(spec).ok).toBe(true);
    expect(spec.elements!.find((e) => e.id === "zoo_bin_1_title")?.text).toBe("Mammals");
    expect(authoredCards(spec)[0].select).toBe("Mammals");
    const none = validateSpec({ commands: [], elements: [{ ...animals, items: ["Shark", "Trout"] }] } as never);
    expect(JSON.stringify(none)).toMatch(/in: true/);
    const both = validateSpec({ commands: [], elements: [{ ...animals, bins: ["A", "B"] }] } as never);
    expect(both.ok).toBe(false);
  });
});

const many = (n: number): CardsElementLike => ({
  id: "deck",
  type: "cards",
  deck: true,
  bins: ["Virus", "Bacteria"],
  items: Array.from({ length: n }, (_, i) => ({ text: `Germ ${i + 1}`, bin: i % 5 === 0 ? "Bacteria" : "Virus" })),
});

describe("the deck", () => {
  const g = cardsGeometry(many(30));
  test("up to 30 cards, one stack in the middle, dealt in a shuffled order", () => {
    expect(g.mode).toBe("sort");
    expect(g.deck).toBe(true);
    expect(g.cards).toHaveLength(30);
    const deal = g.deal!;
    expect([...deal].sort((a, b) => a - b)).toEqual(g.cards.map((_, i) => i));
    expect(deal.every((v, i) => v === i)).toBe(false);
    // The top card stands at the deck's centre; the rest just under it.
    const [cx, cy] = g.home[deal[0]];
    expect(cx).toBeCloseTo(500, 0);
    for (const p of g.home) expect(Math.hypot(p[0] - cx, p[1] - cy)).toBeLessThan(12);
  });

  test("large when dealt, and it stands over the boxes, under the top (round 7 §5: drop)", () => {
    const s = g.deckScale!;
    expect(s * g.w).toBeGreaterThanOrEqual(240);
    expect(s * g.w).toBeLessThanOrEqual(400);
    const [, cy] = g.home[g.deal![0]];
    const boxTop = Math.max(...g.binBoxes.map((b) => b.c[1] + b.h / 2));
    expect(cy - (s * g.h) / 2).toBeGreaterThan(boxTop);
    expect(cy + (s * g.h) / 2).toBeLessThanOrEqual(750);
  });


  test("the truth: every card inside its box, none overlapping, all on the canvas", () => {
    g.truth.forEach((p, i) => {
      const b = g.binBoxes[g.truthBin[i]];
      expect(Math.abs(p[0] - b.c[0]) + g.w / 2).toBeLessThanOrEqual(b.w / 2 + 0.5);
      expect(Math.abs(p[1] - b.c[1]) + g.h / 2).toBeLessThanOrEqual(b.h / 2 + 0.5);
      expect(p[1] + g.h / 2).toBeLessThanOrEqual(750);
    });
    for (let i = 0; i < g.truth.length; i++)
      for (let j = i + 1; j < g.truth.length; j++) {
        const [a, b] = [g.truth[i], g.truth[j]];
        expect(Math.abs(a[0] - b[0]) >= g.w - 0.5 || Math.abs(a[1] - b[1]) >= g.h - 0.5).toBe(true);
      }
    // The truth arrangement puts the cards exactly where the truth says (in deal order).
    expect(positions(g, cardsTruth(g))).toEqual(g.truth);
  });

  test("dealt into boxes in deal order, the cards fill the boxes as the truth does", () => {
    let a = initialArrangement(g);
    for (const card of g.deal!) a = { ...a, boxes: a.boxes.map((b, k) => (k === g.truthBin[card] ? [...b, card] : b)) };
    expect(positions(g, a)).toEqual(g.truth);
    expect(scoreCards(g, a).ok).toBe(true);
  });

  test("expands with the top card drawn last, and a smaller font", () => {
    const els = cardsElements(many(12));
    const cards = els.filter((e) => /^deck_\d+$/.test(e.id));
    const g12 = cardsGeometry(many(12));
    expect(cards[cards.length - 1].id).toBe(g12.cards[g12.deal![0]]);
    expect(cards.every((c) => (c.font_size as number) < 20)).toBe(true);
    const spec = expandSpec({ commands: [], elements: [many(12) as never] } as Spec);
    expect(authoredCards(spec)[0].deck).toBe(true);
    // Only the top card is drawn with the group: a stack's texts would show through.
    const group = els.find((e) => e.id === "deck")!;
    expect((group.members as string[]).filter((m) => /^deck_\d+$/.test(m))).toEqual([g12.cards[g12.deal![0]]]);
  });

  test("a drawn and asked deck of 30 lays out and lints clean (its stack is one composition)", () => {
    const spec = expandSpec({ commands: [{ draw: ["deck"] }, { ask: { question: "Which?", on: "deck" } }], elements: [many(30) as never] } as Spec);
    expect(layoutSpec(spec).issues).toEqual([]);
    expect(lintCommands(spec)).toEqual([]);
  });

  test("lint: a deck card's text too long for its small card is named", () => {
    const long = { ...many(30), items: (many(30).items as { text: string; bin: string }[]).map((it, i) => (i === 3 ? { ...it, text: "Severe acute respiratory syndrome coronavirus" } : it)) };
    const spec = expandSpec({ commands: [{ draw: ["deck"] }, { ask: { question: "Which?", on: "deck" } }], elements: [long as never] } as Spec);
    const w = lintCommands(spec).filter((i) => i.rule === "deck-text");
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/item 4/);
  });

  test("validation: a deck may hold 30 cards; a sort without it 8", () => {
    expect(validateSpec({ commands: [], elements: [many(30) as never] } as Spec).ok).toBe(true);
    expect(JSON.stringify(validateSpec({ commands: [], elements: [many(31) as never] } as Spec))).toMatch(/30/);
    const plain = { ...many(9), deck: undefined };
    expect(JSON.stringify(validateSpec({ commands: [], elements: [plain as never] } as Spec))).toMatch(/2–8/);
    const deckRank = { id: "r", type: "cards", deck: true, items: ["a", "b", "c"] };
    expect(validateSpec({ commands: [], elements: [deckRank as never] } as Spec).ok).toBe(false);
  });

  test("a small deck and four boxes fit too", () => {
    for (const el of [many(4), { ...many(30), bins: ["A", "B", "C", "D"], items: Array.from({ length: 30 }, (_, i) => ({ text: `x${i}`, bin: "ABCD"[i % 4] })) }]) {
      const d = cardsGeometry(el as CardsElementLike);
      for (const p of d.truth) {
        expect(p[1] - d.h / 2).toBeGreaterThanOrEqual(0);
        expect(p[0] - d.w / 2).toBeGreaterThanOrEqual(0);
        expect(p[0] + d.w / 2).toBeLessThanOrEqual(1000);
      }
      expect(d.deckScale! * d.w).toBeGreaterThanOrEqual(240);
    }
  });
});
