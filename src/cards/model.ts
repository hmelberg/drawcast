// The viewer's arrangement of a cards element (spec 2026-10-01-rank-and-sort):
// which slot each card is in (rank) or which box (sort), where that puts each
// card, how a drop changes it, how it scores, and the marks it leaves. Pure;
// ui/cards-gate.ts drags, render/player.ts reveals.

import type { Pt } from "../layout/model";
import type { CardsGeometry } from "../spec/cards";
import { GUESS_COLOR, type GuessMarks } from "../guess/marks";

export interface Arrangement {
  /** rank: slot s holds card order[s]. */
  order: number[];
  /** sort: the cards in each box, in the order they were put there. */
  boxes: number[][];
}

const same = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

/** As drawn: the shuffled order (rank), every card in the row (sort). */
export function initialArrangement(g: CardsGeometry): Arrangement {
  if (g.mode === "rank") {
    const order = g.slots.map((s) => g.home.findIndex((h) => same(h, s)));
    return { order, boxes: [] };
  }
  return { order: [], boxes: g.bins.map(() => []) };
}

/** Where every card stands in this arrangement. */
export function positions(g: CardsGeometry, a: Arrangement): Pt[] {
  if (g.mode === "rank") {
    const out: Pt[] = g.home.slice();
    a.order.forEach((card, s) => (out[card] = g.slots[s]));
    return out;
  }
  const out: Pt[] = g.home.slice();
  a.boxes.forEach((cards, b) => cards.forEach((card, j) => (out[card] = g.binSlot(b, j))));
  return out;
}

/** The arrangement after card `card` is let go at `p` (logical). */
export function drop(g: CardsGeometry, a: Arrangement, card: number, p: Pt): Arrangement {
  if (g.mode === "rank") {
    let best = 0;
    let bestD = Infinity;
    g.slots.forEach((s, i) => {
      const d = Math.hypot(s[0] - p[0], s[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const order = a.order.filter((c) => c !== card);
    order.splice(best, 0, card);
    return { order, boxes: [] };
  }
  const boxes = a.boxes.map((cards) => cards.filter((c) => c !== card));
  const b = g.binBoxes.findIndex((box) => Math.abs(p[0] - box.c[0]) <= box.w / 2 + 10 && Math.abs(p[1] - box.c[1]) <= box.h / 2 + 10);
  if (b >= 0) boxes[b].push(card);
  return { order: [], boxes };
}

/** The card under `p` at these positions, or -1. */
export function cardAt(g: CardsGeometry, pos: Pt[], p: Pt): number {
  for (let i = pos.length - 1; i >= 0; i--) {
    if (Math.abs(p[0] - pos[i][0]) <= g.w / 2 && Math.abs(p[1] - pos[i][1]) <= g.h / 2) return i;
  }
  return -1;
}

/** Card i is where the truth puts it. */
export function rightCards(g: CardsGeometry, a: Arrangement): boolean[] {
  if (g.mode === "rank") {
    const right = g.cards.map(() => false);
    a.order.forEach((card, s) => (right[card] = card === s));
    return right;
  }
  const right = g.cards.map(() => false);
  a.boxes.forEach((cards, b) => cards.forEach((card) => (right[card] = g.truthBin[card] === b)));
  return right;
}

export function scoreCards(g: CardsGeometry, a: Arrangement, tolerance = 0): { within: number; count: number; ok: boolean } {
  const within = rightCards(g, a).filter(Boolean).length;
  const count = g.cards.length;
  return { within, count, ok: within >= Math.ceil(count * (1 - Math.max(0, Math.min(1, tolerance))) - 1e-9) };
}

/** "3,0,4,1,2" (rank: the card in each slot) or "0|1,3|2" (sort: each box's cards). */
export function encodeArrangement(g: CardsGeometry, a: Arrangement): string {
  return g.mode === "rank" ? a.order.join(",") : a.boxes.map((cards) => cards.join(",")).join("|");
}

export function decodeArrangement(g: CardsGeometry, s: string): Arrangement | null {
  const n = g.cards.length;
  const ok = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < n;
  if (g.mode === "rank") {
    const order = s.split(",").map(Number);
    if (order.length !== n || !order.every(ok) || new Set(order).size !== n) return null;
    return { order, boxes: [] };
  }
  const parts = s.split("|");
  if (parts.length !== g.bins.length) return null;
  const boxes = parts.map((p) => (p.trim() === "" ? [] : p.split(",").map(Number)));
  const all = boxes.flat();
  if (!all.every(ok) || new Set(all).size !== all.length) return null;
  return { order: [], boxes };
}

const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

/**
 * What the viewer's answer leaves once the cards stand true. Rank: over each
 * card the viewer had wrong, the place they gave it ("you: 4th") — every
 * slot holds some card, so an outline there would say nothing. Sort: a
 * dashed outline round each card they got wrong, where it truly belongs.
 */
export function cardsMarks(g: CardsGeometry, a: Arrangement): GuessMarks {
  const right = rightCards(g, a);
  if (g.mode === "rank") {
    const texts = g.cards.flatMap((_, i) => {
      if (right[i]) return [];
      const slot = a.order.indexOf(i);
      const [x, y] = g.truth[i];
      const column = g.slots.length > 1 && Math.abs(g.slots[0][0] - g.slots[1][0]) < 1;
      return [{ at: (column ? [x + g.w / 2 + 12, y] : [x, y + g.h / 2 + 18]) as Pt, text: `you: ${ordinal(slot + 1)}`, anchor: (column ? "start" : "middle") as "start" | "middle" }];
    });
    return { color: GUESS_COLOR, lines: [], texts };
  }
  // Sort: an outline round each card the viewer got wrong (or never
  // placed), where it now truly stands — an outline where it USED to stand
  // could fall on another card that belongs there.
  const lines = g.cards.flatMap((_, i) => {
    if (right[i]) return [];
    const [x, y] = g.truth[i];
    const w = g.w / 2 + 5, h = g.h / 2 + 4;
    return [{ pts: [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]] as Pt[], closed: true, dashed: true }];
  });
  return { color: GUESS_COLOR, lines, texts: [] };
}
