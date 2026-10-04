// The viewer's answer on a cards element (specs 2026-10-01-rank-and-sort,
// 2026-10-02-more-ways-to-answer): which slot each card is in (rank), which
// box (sort), which value on the line (place), which partner (match), which
// card of each pair (compare), which option (decide); where that puts the
// cards, how a drop changes it, how it scores, and the marks it leaves.
// Pure; ui/cards-gate.ts works it, render/player.ts reveals it.

import type { Pt } from "../layout/model";
import type { CardsGeometry } from "../spec/cards";
import { GUESS_COLOR, type GuessMarks, type GuessMarkLine, type GuessMarkText } from "../guess/marks";
import { normTeX } from "../formula/expr";
import { RIGHT, WRONG } from "../guess/reveal";

export interface Arrangement {
  /** rank: slot s holds card order[s]. */
  order: number[];
  /** sort: the cards in each box, in the order they were put there; fill: at most one tile per blank. */
  boxes: number[][];
  /** place: each card's value on the line, or null (still in the row). */
  values?: (number | null)[];
  /** match: each left card's chosen partner (a right index), or -1. */
  links?: number[];
  /** compare: each pair's pick (0 = first card, 1 = second), or -1. */
  picks?: number[];
  /** decide: the option chosen, or -1. */
  choice?: number;
  /** sort under check: each (round 7 §3.5): each card's first box (-1: the tray), null until judged. */
  first?: (number | null)[];
}

const same = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

/** As drawn: nothing answered yet. */
export function initialArrangement(g: CardsGeometry): Arrangement {
  switch (g.mode) {
    case "rank":
      return { order: g.slots.map((s) => g.home.findIndex((h) => same(h, s))), boxes: [] };
    case "sort":
      return { order: [], boxes: g.bins.map(() => []) };
    case "fill":
      return { order: [], boxes: g.binBoxes.map(() => []) };
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
  if (g.mode === "sort" || g.mode === "fill") {
    const out: Pt[] = g.home.slice();
    a.boxes.forEach((cards, b) => cards.forEach((card, j) => (out[card] = g.binSlot(b, j, cards.length))));
    return out;
  }
  if (g.mode === "place" && g.placeAt) return g.placeAt(a.values ?? g.cards.map(() => null));
  return g.home.slice();
}

/** place: the value a card let go at `p` takes — over the line (anywhere
 *  above its numbers), the snapped value under it; elsewhere null (back to the row). */
export function placeValueAt(g: CardsGeometry, p: Pt): number | null {
  const sg = g.scale;
  if (!sg) return null;
  const onLine = p[0] >= sg.x0 - 20 && p[0] <= sg.x1 + 20 && p[1] >= sg.y - 30;
  return onLine ? sg.valueAtX(p[0]) : null;
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
  if (g.mode === "fill") {
    // One tile per box: a drop on a full box swaps — the old tile goes home.
    const boxes = g.binBoxes.map((_, k) => (a.boxes[k] ?? []).filter((c) => c !== card));
    const pad = 10;
    // The reach is tile-sized, so two blanks side by side overlap: of the
    // boxes within reach, the nearest takes it (not the first in order).
    let k = -1;
    let kd = Infinity;
    g.binBoxes.forEach((bx, i) => {
      const inReach = Math.abs(p[0] - bx.c[0]) <= Math.max(bx.w, g.w) / 2 + pad && Math.abs(p[1] - bx.c[1]) <= Math.max(bx.h, g.h) / 2 + pad;
      const d = Math.hypot(p[0] - bx.c[0], p[1] - bx.c[1]);
      if (inReach && d < kd) {
        kd = d;
        k = i;
      }
    });
    if (k >= 0) boxes[k] = [card];
    return { ...a, boxes };
  }
  if (g.mode === "place" && g.scale) {
    const values = (a.values ?? g.cards.map(() => null)).slice();
    values[card] = placeValueAt(g, p);
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

/** sort / fill: the box card `card` is in, or -1 (the row). */
export function boxOf(a: Arrangement, card: number): number {
  return a.boxes.findIndex((b) => b.includes(card));
}

/**
 * Tap to move (round 6 §7): where a tap sends card `card` — a box index, or
 * -1 for the row. Round the boxes and back: row → 1 → 2 → … → row (one box,
 * select: in and out), so a tap on a card in the last box takes it out.
 * Fill: from the row to the first empty blank (else blank 1), then on.
 */
export function tapTarget(g: CardsGeometry, a: Arrangement, card: number): number {
  const k = g.mode === "fill" ? g.binBoxes.length : g.bins.length;
  if (k === 0) return -1;
  const at = boxOf(a, card);
  if (at < 0) {
    if (g.mode === "fill") return Math.max(0, g.binBoxes.findIndex((_, b) => (a.boxes[b] ?? []).length === 0));
    return 0;
  }
  return at + 1 < k ? at + 1 : -1;
}

/** The arrangement after a tap on card `card` (sort and fill; others unchanged). */
export function tapCard(g: CardsGeometry, a: Arrangement, card: number): Arrangement {
  if (g.mode !== "sort" && g.mode !== "fill") return a;
  const to = tapTarget(g, a, card);
  return drop(g, a, card, to < 0 ? [-9999, -9999] : g.binBoxes[to].c);
}

/** A card put in box `box` (-1: the tray), as dropped — nothing judged. */
export function putIn(a: Arrangement, card: number, box: number): Arrangement {
  const boxes = a.boxes.map((cs) => cs.filter((c) => c !== card));
  if (box >= 0 && box < boxes.length) boxes[box].push(card);
  return { ...a, boxes };
}

/** check: each — the card has been judged; it is final. */
export function isPlaced(a: Arrangement, card: number): boolean {
  const f = a.first?.[card];
  return f !== null && f !== undefined;
}

/**
 * check: each — the card in its right box (a select's out card: the tray),
 * at the slot the truth gives it (the deal's order, else the items'), so the
 * last card leaves every card where the truth stands: nothing reshuffles
 * after the answer.
 */
export function placeRight(g: CardsGeometry, a: Arrangement, card: number): Arrangement {
  const truth = g.truthBin[card];
  const boxes = a.boxes.map((cs) => cs.filter((c) => c !== card));
  if (truth >= 0 && truth < boxes.length) {
    const order = g.deal ?? g.cards.map((_, i) => i);
    const rank = (c: number): number => order.indexOf(c);
    const box = boxes[truth];
    const at = box.findIndex((c) => rank(c) > rank(card));
    box.splice(at < 0 ? box.length : at, 0, card);
  }
  return { ...a, boxes };
}

/** check: each — the cards judged wrong so far: drawn faded (round 7 §3.1.3). */
export function fadedCards(g: CardsGeometry, a: Arrangement): number[] {
  return g.cards.map((_, i) => i).filter((i) => isPlaced(a, i) && a.first![i] !== g.truthBin[i]);
}

/**
 * A drop judged at once (round 7 §3.5): `box` (-1: the tray — a select's
 * card left out on Done) is kept as the card's first box, and the card goes
 * to its right box (placeRight). The gate animates; this decides.
 */
export function checkDrop(g: CardsGeometry, a: Arrangement, card: number, box: number): { ok: boolean; arr: Arrangement; faded: number[] } {
  const first = (a.first ?? g.cards.map(() => null)).slice();
  if (first[card] === null || first[card] === undefined) first[card] = box;
  const arr = { ...placeRight(g, a, card), first };
  return { ok: first[card] === g.truthBin[card], arr, faded: fadedCards(g, arr) };
}

/** check: each — every card judged (the last one answers). */
export function allChecked(g: CardsGeometry, a: Arrangement): boolean {
  return g.cards.every((_, i) => isPlaced(a, i));
}

/** check: each — the counter's numbers: first drops right and wrong so far. */
export function checkTally(g: CardsGeometry, a: Arrangement): { right: number; wrong: number } {
  let right = 0;
  let wrong = 0;
  g.cards.forEach((_, i) => {
    if (!isPlaced(a, i)) return;
    if (a.first![i] === g.truthBin[i]) right++;
    else wrong++;
  });
  return { right, wrong };
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

/** fill: the tile in box k is right — its TeX equals the blank's after
 *  spaces and outer braces go (formula/blanks.ts tileRight). */
function fillRight(g: CardsGeometry, k: number, card: number | undefined): boolean {
  if (card === undefined || card < 0 || card >= g.texts.length) return false;
  const truth = g.truthBin.indexOf(k);
  return truth >= 0 && normTeX(g.texts[card]) === normTeX(g.texts[truth]);
}

/** Which answers are right: per card (rank, sort, place), per left card
 *  (match), per pair (compare), the one choice (decide), per blank (fill). */
export function rightCards(g: CardsGeometry, a: Arrangement, tolerance = 0.05): boolean[] {
  switch (g.mode) {
    case "rank": {
      const right = g.cards.map(() => false);
      a.order.forEach((card, s) => (right[card] = card === s));
      return right;
    }
    case "sort":
      // check: each — the first drop is the answer (round 7 §3.1.8).
      if (a.first) return g.cards.map((_, i) => a.first![i] === g.truthBin[i]);
      // Where each card is (-1: still in the row) against where it belongs
      // (select: -1 for a card that stays out).
      return g.cards.map((_, i) => boxOf(a, i) === g.truthBin[i]);
    case "fill":
      return g.binBoxes.map((_, k) => fillRight(g, k, a.boxes[k]?.[0]));
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
    case "sort": {
      const boxes = a.boxes.map((cards) => cards.join(",")).join("|");
      // check: each — the first drops after a ";" (null: empty).
      return a.first ? `${boxes};${a.first.map((v) => (v === null ? "" : String(v))).join(",")}` : boxes;
    }
    case "fill":
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
      const halves = s.split(";");
      if (halves.length > 2) return null;
      const parts = halves[0].split("|");
      if (parts.length !== g.bins.length) return null;
      const boxes = parts.map(nums);
      const all = boxes.flat();
      if (!all.every(ok) || new Set(all).size !== all.length) return null;
      if (halves.length === 1) return { order: [], boxes };
      const raw = halves[1].split(",");
      if (raw.length !== n) return null;
      const first = raw.map((t) => (t.trim() === "" ? null : Number(t)));
      if (first.some((v) => v !== null && (!Number.isInteger(v) || v < -1 || v >= g.bins.length))) return null;
      return { order: [], boxes, first };
    }
    case "fill": {
      const parts = s.split("|");
      if (parts.length !== g.binBoxes.length) return null;
      const boxes = parts.map(nums);
      const all = boxes.flat();
      if (boxes.some((b) => b.length > 1) || !all.every(ok) || new Set(all).size !== all.length) return null;
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
 * Fill: a struck-through copy of each wrong tile above its box.
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
        // Green or red from the first pick on, as the reveal draws them (final fix wave E).
        texts.push({ at: [x + g.w / 2 + 16, y], text: right[r] ? "✓" : "✗", anchor: "start", color: right[r] ? RIGHT : WRONG });
      });
      break;
    case "decide":
      if ((a.choice ?? -1) >= 0) lines.push(outline(g.home[a.choice!], w, h, false));
      break;
    case "fill":
      g.binBoxes.forEach((bx, k) => {
        const card = a.boxes[k]?.[0];
        if (card === undefined || right[k]) return;
        const m = struckAbove(bx, plainTeX(g.texts[card]));
        texts.push(m.text);
        lines.push(m.line);
      });
      break;
  }
  return { color: GUESS_COLOR, lines, texts };
}

/** The true answer as an arrangement (what the reveal and the learner log compare against). */
export function cardsTruth(g: CardsGeometry): Arrangement {
  switch (g.mode) {
    case "rank":
      return { order: g.cards.map((_, i) => i), boxes: [] };
    case "sort": {
      // A deck fills its boxes in the order it deals (so the truth's slots are its own).
      const order = g.deal ?? g.cards.map((_, i) => i);
      return { order: [], boxes: g.bins.map((_, b) => order.filter((i) => g.truthBin[i] === b)) };
    }
    case "place":
      return { order: [], boxes: [], values: (g.values ?? []).slice() };
    case "match":
      return { order: [], boxes: [], links: Array.from({ length: g.pairs ?? 0 }, (_, i) => i) };
    case "compare":
      return { order: [], boxes: [], picks: (g.rows ?? []).map((_, r) => rightPick(g, r)) };
    case "decide":
      return { order: [], boxes: [], choice: Math.max(-1, (g.best ?? []).indexOf(true)) };
    case "fill":
      return { order: [], boxes: g.binBoxes.map((_, k) => {
        const i = g.truthBin.indexOf(k);
        return i >= 0 ? [i] : [];
      }) };
  }
}

/** place: a pin from each card standing on the line down to its point. */
export function placePins(g: CardsGeometry, pos: Pt[]): GuessMarkLine[] {
  const sg = g.scale;
  if (!sg) return [];
  return pos.flatMap(([x, y]) => (y > sg.y ? [{ pts: [[x, y - g.h / 2], [x, sg.y]] as Pt[] }] : []));
}

/** place: how far above the line a placed value's label stands (on its pin, under the card). */
export const PLACE_LABEL_UP = 20;

/**
 * place, while the viewer answers (Hans 2026-10-04: "the year indicators
 * precise"): a pin from each placed card down to its point, the value it
 * holds written beside the pin in the scale's own format ("2550 BC"); and,
 * for the card being dragged over the line, a pin and a tick across the line
 * at the value it would land on — `drag.value`, snapped as the drop snaps
 * (sg.valueAtX), null when it is off the line.
 */
export function placeMarks(g: CardsGeometry, values: readonly (number | null)[], drag?: { card: number; at: Pt; value: number | null }): GuessMarks {
  const sg = g.scale;
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  if (!sg) return { color: GUESS_COLOR, lines, texts };
  const pos = positions(g, { order: [], boxes: [], values: values.slice() });
  g.cards.forEach((_, i) => {
    const v = values[i];
    if (drag?.card === i || v === null || v === undefined) return;
    const [x, y] = pos[i];
    if (y <= sg.y) return;
    lines.push({ pts: [[x, y - g.h / 2], [x, sg.y]] });
    texts.push({ at: [x + 5, sg.y + PLACE_LABEL_UP], text: sg.format(v), anchor: "start", size: 15 });
  });
  if (drag && drag.value !== null) {
    const x = sg.xAt(drag.value);
    const bottom = drag.at[1] - g.h / 2;
    if (bottom > sg.y) lines.push({ pts: [[x, bottom], [x, sg.y]], width: 2 });
    // A tick across the line at the value: exactly where it lands.
    lines.push({ pts: [[x, sg.y - 10], [x, sg.y + 10]], width: 3 });
  }
  return { color: GUESS_COLOR, lines, texts };
}

/** A formula blank's wrong answer (a tile, or what was typed): its text
 *  above the box (centre `c`, height `h`, logical y-up), a line through it. */
export function struckAbove(box: { c: Pt; h: number }, text: string): { text: GuessMarkText; line: GuessMarkLine } {
  const at: Pt = [box.c[0], box.c[1] + box.h / 2 + 16];
  const half = Math.max(10, text.length * 5.5);
  return { text: { at, text, anchor: "middle" }, line: { pts: [[at[0] - half, at[1]], [at[0] + half, at[1]]] } };
}

/** A tile's TeX as plain text for a mark: commands lose their backslash, braces go. */
export function plainTeX(tex: string): string {
  return tex
    .replace(/\\(cdot|times)\b/g, (_, c: string) => (c === "cdot" ? "·" : "×"))
    .replace(/\\pi\b/g, "π")
    .replace(/\\(left|right)\b/g, "")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
