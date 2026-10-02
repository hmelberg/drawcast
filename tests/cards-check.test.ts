// check: each (round 7 §3.5): a sort, select or deck judges each card as it
// is dropped — the first drop is the answer, the card goes to its right box.
import { describe, expect, test } from "vitest";
import { authoredCards, cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { allChecked, checkDrop, checkTally, decodeArrangement, encodeArrangement, fadedCards, initialArrangement, isPlaced, placeRight, positions, putIn, scoreCards } from "../src/cards/model";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const two: CardsElementLike = { id: "c", type: "cards", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Tax", bin: "Fixed" }] };
const zoo: CardsElementLike = { id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }] };

describe("check: each is the default for sort, select and deck", () => {
  test("geometry", () => {
    expect(cardsGeometry(two).each).toBe(true);
    expect(cardsGeometry(zoo).each).toBe(true);
    expect(cardsGeometry({ ...two, deck: true }).each).toBe(true);
    expect(cardsGeometry({ ...two, check: "end" }).each).toBeUndefined();
    expect(cardsGeometry({ id: "r", type: "cards", items: ["A", "B", "C"] }).each).toBeUndefined();
  });

  test("carried through the expansion", () => {
    const spec = expandSpec({ elements: [{ ...two, check: "end" } as never], commands: [] } as unknown as Spec);
    expect(authoredCards(spec)[0].check).toBe("end");
  });
});

describe("checkDrop", () => {
  const g = cardsGeometry(two);

  test("right: first recorded, the card in its box", () => {
    const r = checkDrop(g, initialArrangement(g), 1, 1);
    expect(r.ok).toBe(true);
    expect(r.arr.first).toEqual([null, 1, null]);
    expect(r.arr.boxes).toEqual([[], [1]]);
  });

  test("wrong: first is where it was dropped, the card goes to its right box", () => {
    const r = checkDrop(g, initialArrangement(g), 0, 1);
    expect(r.ok).toBe(false);
    expect(r.arr.first).toEqual([1, null, null]);
    expect(r.arr.boxes).toEqual([[0], []]);
  });

  test("a placed card is final: a second drop keeps its first box", () => {
    const a = checkDrop(g, initialArrangement(g), 0, 1).arr;
    const b = checkDrop(g, a, 0, 0);
    expect(b.arr.first![0]).toBe(1);
    expect(b.ok).toBe(false);
  });

  test("select: in → the box; out → back to the tray; Done judges the rest (-1)", () => {
    const z = cardsGeometry(zoo);
    expect(checkDrop(z, initialArrangement(z), 0, 0).ok).toBe(true);
    const out = checkDrop(z, initialArrangement(z), 1, 0);
    expect(out.ok).toBe(false);
    expect(out.arr.boxes).toEqual([[]]);
    expect(positions(z, out.arr)[1]).toEqual(z.home[1]);
    // A missed in-card: wrong, and it goes in; an untapped out-card: right where it stands.
    const missed = checkDrop(z, initialArrangement(z), 2, -1);
    expect(missed.ok).toBe(false);
    expect(missed.arr.boxes).toEqual([[2]]);
    expect(checkDrop(z, initialArrangement(z), 1, -1).ok).toBe(true);
  });

  test("the last card: allChecked once every card has a first box; the tally", () => {
    let a = initialArrangement(g);
    for (const [card, box] of [[0, 0], [1, 0], [2, 0]] as const) {
      expect(allChecked(g, a)).toBe(false);
      a = checkDrop(g, a, card, box).arr;
    }
    expect(allChecked(g, a)).toBe(true);
    expect(checkTally(g, a)).toEqual({ right: 2, wrong: 1 });
    expect(isPlaced(a, 1)).toBe(true);
  });

  test("putIn lands a card where it was dropped, nothing judged", () => {
    expect(putIn(initialArrangement(g), 0, 1).boxes).toEqual([[], [0]]);
    expect(putIn({ order: [], boxes: [[], [0]] }, 0, -1).boxes).toEqual([[], []]);
  });

  test("the faded set: the cards whose first drop was wrong", () => {
    let a = initialArrangement(g);
    const r1 = checkDrop(g, a, 0, 1);
    expect(r1.faded).toEqual([0]);
    a = checkDrop(g, r1.arr, 1, 1).arr;
    expect(fadedCards(g, a)).toEqual([0]);
    expect(checkDrop(g, a, 2, 1).faded).toEqual([0, 2]);
  });

  test("placeRight: the truth slot, whatever the order the cards come in — the last card leaves every card at its truth", () => {
    // Tax (2) before Rent (0): Rent still takes the first slot of Fixed.
    const a = placeRight(g, placeRight(g, initialArrangement(g), 2), 0);
    expect(a.boxes).toEqual([[0, 2], []]);
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0]]) {
      let b = initialArrangement(g);
      for (const c of order) b = checkDrop(g, b, c, c === 1 ? 0 : 1).arr; // every first drop wrong
      expect(positions(g, b)).toEqual(g.truth);
    }
    // A deck's truth slots follow its deal.
    const d = cardsGeometry({ ...two, deck: true });
    let b = initialArrangement(d);
    for (const c of [...d.deal!].reverse()) b = checkDrop(d, b, c, d.truthBin[c]).arr;
    expect(positions(d, b)).toEqual(d.truth);
  });
});

describe("scoring and encoding", () => {
  const g = cardsGeometry(two);

  test("with first: the first drops count, not where the cards end", () => {
    let a = initialArrangement(g);
    a = checkDrop(g, a, 0, 1).arr;
    a = checkDrop(g, a, 1, 1).arr;
    a = checkDrop(g, a, 2, 0).arr;
    expect(scoreCards(g, a)).toEqual({ within: 2, count: 3, ok: false });
  });

  test("without first: the final boxes (check: end, older answers)", () => {
    expect(scoreCards(g, { order: [], boxes: [[0, 2], [1]] })).toEqual({ within: 3, count: 3, ok: true });
  });

  test("first round-trips; old strings still decode", () => {
    const a = checkDrop(g, initialArrangement(g), 0, 1).arr;
    const s = encodeArrangement(g, a);
    expect(s).toBe("0|;1,,");
    expect(decodeArrangement(g, s)).toEqual(a);
    expect(decodeArrangement(g, "0,2|1")).toEqual({ order: [], boxes: [[0, 2], [1]] });
    expect(decodeArrangement(g, "0|;5,,")).toBeNull();
    expect(decodeArrangement(g, "0|;1,")).toBeNull();
    expect(decodeArrangement(g, "0|;1,,;2")).toBeNull();
  });

  test("select: -1 (the tray) round-trips", () => {
    const z = cardsGeometry(zoo);
    const a = checkDrop(z, initialArrangement(z), 1, -1).arr;
    expect(decodeArrangement(z, encodeArrangement(z, a))).toEqual(a);
  });
});
