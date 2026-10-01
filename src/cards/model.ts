// The viewer's answer on a cards element (specs 2026-10-01-rank-and-sort,
// 2026-10-02-more-ways-to-answer): which slot each card is in (rank), which
// box (sort), which value on the line (place), which partner (match), which
// card of each pair (compare), which option (decide); where that puts the
// cards, how a drop changes it, how it scores, and the marks it leaves.
// Pure; ui/cards-gate.ts works it, render/player.ts reveals it.

import type { Pt } from "../layout/model";
import type { CardsGeometry } from "../spec/cards";
import { GUESS_COLOR, type GuessMarks, type GuessMarkLine, type GuessMarkText } from "../guess/marks";

export interface Arrangement {
  /** rank: slot s holds card order[s]. */
  order: number[];
  /** sort: the cards in each box, in the order they were put there. */
  boxes: number[][];
  /** place: each card's value on the line, or null (still in the row). */
  values?: (number | null)[];
  /** match: each left card's chosen partner (a right index), or -1. */
  links?: number[];
  /** compare: each pair's pick (0 = first card, 1 = second), or -1. */
  picks?: number[];
  /** decide: the option chosen, or -1. */
  choice?: number;
}

const same = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

/** As drawn: nothing answered yet. */
export function initialArrangement(g: CardsGeometry): Arrangement {
  switch (g.mode) {
    case "rank":
      return { order: g.slots.map((s) => g.home.findIndex((h) => same(h, s))), boxes: [] };
    case "sort":
      return { order: [], boxes: g.bins.map(() => []) };
    case "place":
      return { order: [], boxes: [], values: g.cards.map(() => null) };
    case "match":
      return { order: [], boxes: [], links: Array.from({ length: g.pairs ?? 0 }, () => -1) };
    case "compare":
      return { order: [], boxes: [], picks: (g.rows ?? []).map(() => -1) };
    case "decide":
      return { order: [], boxes: [], choice: -1 };
  }
}

/** Where every card stands in this arrangement. */
export function positions(g: CardsGeometry, a: Arrangement): Pt[] {
  if (g.mode === "rank") {
    const out: Pt[] = g.home.slice();
    a.order.forEach((card, s) => (out[card] = g.slots[s]));
    return out;
  }
  if (g.mode === "sort") {
    const out: Pt[] = g.home.slice();
    a.boxes.forEach((cards, b) => cards.forEach((card, j) => (out[card] = g.binSlot(b, j))));
    return out;
  }
  if (g.mode === "place" && g.placeAt) return g.placeAt(a.values ?? g.cards.map(() => null));
  return g.home.slice();
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
    return { ...a, order };
  }
  if (g.mode === "sort") {
    const boxes = a.boxes.map((cards) => cards.filter((c) => c !== card));
    const b = g.binBoxes.findIndex((bx) => Math.abs(p[0] - bx.c[0]) <= bx.w / 2 + 10 && Math.abs(p[1] - bx.c[1]) <= bx.h / 2 + 10);
    if (b >= 0) boxes[b].push(card);
    return { ...a, boxes };
  }
  if (g.mode === "place" && g.scale) {
    const sg = g.scale;
    const values = (a.values ?? g.cards.map(() => null)).slice();
    // Over the line (anywhere above its numbers): placed at the value under it; elsewhere back to the row.
    const onLine = p[0] >= sg.x0 - 20 && p[0] <= sg.x1 + 20 && p[1] >= sg.y - 30;
    values[card] = onLine ? sg.valueAtX(p[0]) : null;
    return { ...a, values };
  }
  if (g.mode === "match") {
    const n = g.pairs ?? 0;
    const links = (a.links ?? []).slice();
    // A drag from a left card to a right one, or the other way round.
    const target = cardAt(g, positions(g, a), p);
    if (target < 0) return a;
    const left = card < n ? card : target < n ? target : -1;
    const right = card >= n ? card - n : target >= n ? target - n : -1;
    if (left < 0 || right < 0) return a;
    for (let i = 0; i < links.length; i++) if (links[i] === right) links[i] = -1;
    links[left] = right;
    return { ...a, links };
  }
  return a;
}

/** The card under `p` at these positions, or -1. */
export function cardAt(g: CardsGeometry, pos: Pt[], p: Pt): number {
  for (let i = pos.length - 1; i >= 0; i--) {
    if (Math.abs(p[0] - pos[i][0]) <= g.w / 2 && Math.abs(p[1] - pos[i][1]) <= g.h / 2) return i;
  }
  return -1;
}

/** compare: the right pick of pair r (0 or 1; a tie accepts the first). */
export function rightPick(g: CardsGeometry, r: number): number {
  const [a, b] = g.rows![r];
  return (g.values![a] ?? 0) >= (g.values![b] ?? 0) ? 0 : 1;
}

/** Which answers are right: per card (rank, sort, place), per left card
 *  (match), per pair (compare), the one choice (decide). */
export function rightCards(g: CardsGeometry, a: Arrangement, tolerance = 0.05): boolean[] {
  switch (g.mode) {
    case "rank": {
      const right = g.cards.map(() => false);
      a.order.forEach((card, s) => (right[card] = card === s));
      return right;
    }
    case "sort": {
      const right = g.cards.map(() => false);
      a.boxes.forEach((cards, b) => cards.forEach((card) => (right[card] = g.truthBin[card] === b)));
      return right;
    }
    case "place": {
      const sg = g.scale;
      return g.cards.map((_, i) => {
        const v = a.values?.[i];
        const t = g.values?.[i];
        if (v === null || v === undefined || t === undefined || !sg) return false;
        if (sg.kind === "log" && v > 0 && t > 0) return Math.abs(Math.log10(v / t)) / (Math.log10(sg.max) - Math.log10(sg.min)) <= tolerance + 1e-9;
        return Math.abs(v - t) / (sg.max - sg.min) <= tolerance + 1e-9;
      });
    }
    case "match":
      return (a.links ?? []).map((r, i) => r === i);
    case "compare":
      return (a.picks ?? []).map((p, r) => p === rightPick(g, r));
    case "decide":
      return [(a.choice ?? -1) >= 0 && g.best?.[a.choice!] === true];
  }
}

export function scoreCards(g: CardsGeometry, a: Arrangement, tolerance = 0): { within: number; count: number; ok: boolean } {
  // Place judges each card within a tolerance of the line (default 5 % of
  // it); the others are exact, and `tolerance` is the share of misses allowed.
  const right = g.mode === "place" ? rightCards(g, a, tolerance > 0 ? tolerance : 0.05) : rightCards(g, a);
  const within = right.filter(Boolean).length;
  const count = right.length;
  const share = g.mode === "place" ? 0 : Math.max(0, Math.min(1, tolerance));
  return { within, count, ok: within >= Math.ceil(count * (1 - share) - 1e-9) };
}

/** place: the mean distance from the truth, in the scale's units (null: nothing placed). */
export function placeOff(g: CardsGeometry, a: Arrangement): number | null {
  const diffs: number[] = [];
  g.cards.forEach((_, i) => {
    const v = a.values?.[i];
    const t = g.values?.[i];
    if (typeof v === "number" && typeof t === "number") diffs.push(Math.abs(v - t));
  });
  return diffs.length === 0 ? null : diffs.reduce((s, d) => s + d, 0) / diffs.length;
}

export function encodeArrangement(g: CardsGeometry, a: Arrangement): string {
  switch (g.mode) {
    case "rank":
      return a.order.join(",");
    case "sort":
      return a.boxes.map((cards) => cards.join(",")).join("|");
    case "place":
      return (a.values ?? []).map((v) => (v === null ? "" : String(v))).join(",");
    case "match":
      return (a.links ?? []).join(",");
    case "compare":
      return (a.picks ?? []).join(",");
    case "decide":
      return String(a.choice ?? -1);
  }
}

export function decodeArrangement(g: CardsGeometry, s: string): Arrangement | null {
  const n = g.cards.length;
  const ok = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < n;
  const nums = (t: string): number[] => (t.trim() === "" ? [] : t.split(",").map(Number));
  switch (g.mode) {
    case "rank": {
      const order = nums(s);
      if (order.length !== n || !order.every(ok) || new Set(order).size !== n) return null;
      return { order, boxes: [] };
    }
    case "sort": {
      const parts = s.split("|");
      if (parts.length !== g.bins.length) return null;
      const boxes = parts.map(nums);
      const all = boxes.flat();
      if (!all.every(ok) || new Set(all).size !== all.length) return null;
      return { order: [], boxes };
    }
    case "place": {
      const parts = s.split(",");
      if (parts.length !== n) return null;
      const values = parts.map((t) => (t.trim() === "" ? null : Number(t)));
      if (values.some((v) => v !== null && !Number.isFinite(v))) return null;
      return { order: [], boxes: [], values };
    }
    case "match": {
      const links = nums(s);
      const k = g.pairs ?? 0;
      if (links.length !== k || links.some((v) => !Number.isInteger(v) || v < -1 || v >= k)) return null;
      return { order: [], boxes: [], links };
    }
    case "compare": {
      const picks = nums(s);
      if (picks.length !== (g.rows ?? []).length || picks.some((v) => v !== -1 && v !== 0 && v !== 1)) return null;
      return { order: [], boxes: [], picks };
    }
    case "decide": {
      const choice = Number(s);
      if (!Number.isInteger(choice) || choice < -1 || choice >= n) return null;
      return { order: [], boxes: [], choice };
    }
  }
}

const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

const outline = (c: Pt, w: number, h: number, dashed = true): GuessMarkLine => ({
  pts: [[c[0] - w, c[1] - h], [c[0] + w, c[1] - h], [c[0] + w, c[1] + h], [c[0] - w, c[1] + h]],
  closed: true,
  dashed,
});

/** match: the lines between linked cards (left's right edge → right's left edge). */
export function matchLines(g: CardsGeometry, links: number[], pos: Pt[]): GuessMarkLine[] {
  const n = g.pairs ?? 0;
  return links.flatMap((r, i) => (r < 0 ? [] : [{ pts: [[pos[i][0] + g.w / 2, pos[i][1]], [pos[n + r][0] - g.w / 2, pos[n + r][1]]] as Pt[] }]));
}

/**
 * What the viewer's answer leaves once the cards stand true, in the guess
 * colour. Rank: "you: 4th" by each card they had wrong. Sort: an outline
 * round each card they got wrong, where it truly belongs. Place: an outline
 * where each wrong card was put. Match: the true lines solid, their wrong
 * links dashed. Compare: a tick or a cross by each pick. Decide: the choice.
 */
export function cardsMarks(g: CardsGeometry, a: Arrangement): GuessMarks {
  const right = rightCards(g, a);
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  const w = g.w / 2 + 5, h = g.h / 2 + 4;
  switch (g.mode) {
    case "rank": {
      const column = g.slots.length > 1 && Math.abs(g.slots[0][0] - g.slots[1][0]) < 1;
      g.cards.forEach((_, i) => {
        if (right[i]) return;
        const [x, y] = g.truth[i];
        texts.push({ at: column ? [x + g.w / 2 + 12, y] : [x, y + g.h / 2 + 18], text: `you: ${ordinal(a.order.indexOf(i) + 1)}`, anchor: column ? "start" : "middle" });
      });
      break;
    }
    case "sort":
      g.cards.forEach((_, i) => !right[i] && lines.push(outline(g.truth[i], w, h)));
      break;
    case "place": {
      // A pin from each card to its true point; for a miss, a dashed line
      // from the card to the point the viewer chose — an outline where it
      // stood would fall on the true cards.
      const sg = g.scale;
      if (!sg) break;
      lines.push(...placePins(g, g.truth));
      g.cards.forEach((_, i) => {
        const v = a.values?.[i];
        if (right[i] || v === null || v === undefined) return;
        const [x, y] = g.truth[i];
        lines.push({ pts: [[x, y - g.h / 2], [sg.xAt(v), sg.y]], dashed: true });
      });
      break;
    }
    case "match": {
      const k = g.pairs ?? 0;
      for (const l of matchLines(g, Array.from({ length: k }, (_, i) => i), g.truth)) lines.push({ ...l, dashed: false });
      for (const l of matchLines(g, (a.links ?? []).map((r, i) => (r !== i ? r : -1)), g.truth)) lines.push({ ...l, dashed: true });
      break;
    }
    case "compare":
      (g.rows ?? []).forEach(([c0, c1], r) => {
        const pick = a.picks?.[r] ?? -1;
        if (pick < 0) return;
        const [x, y] = g.home[pick === 0 ? c0 : c1];
        lines.push(outline([x, y], w, h, !right[r]));
        texts.push({ at: [x + g.w / 2 + 16, y], text: right[r] ? "✓" : "✗", anchor: "start" });
      });
      break;
    case "decide":
      if ((a.choice ?? -1) >= 0) lines.push(outline(g.home[a.choice!], w, h, false));
      break;
  }
  return { color: GUESS_COLOR, lines, texts };
}

/** The true answer as an arrangement (what the reveal and the learner log compare against). */
export function cardsTruth(g: CardsGeometry): Arrangement {
  switch (g.mode) {
    case "rank":
      return { order: g.cards.map((_, i) => i), boxes: [] };
    case "sort":
      return { order: [], boxes: g.bins.map((_, b) => g.truthBin.map((t, i) => (t === b ? i : -1)).filter((i) => i >= 0)) };
    case "place":
      return { order: [], boxes: [], values: (g.values ?? []).slice() };
    case "match":
      return { order: [], boxes: [], links: Array.from({ length: g.pairs ?? 0 }, (_, i) => i) };
    case "compare":
      return { order: [], boxes: [], picks: (g.rows ?? []).map((_, r) => rightPick(g, r)) };
    case "decide":
      return { order: [], boxes: [], choice: Math.max(-1, (g.best ?? []).indexOf(true)) };
  }
}

/** place: a pin from each card standing on the line down to its point. */
export function placePins(g: CardsGeometry, pos: Pt[]): GuessMarkLine[] {
  const sg = g.scale;
  if (!sg) return [];
  return pos.flatMap(([x, y]) => (y > sg.y ? [{ pts: [[x, y - g.h / 2], [x, sg.y]] as Pt[] }] : []));
}
