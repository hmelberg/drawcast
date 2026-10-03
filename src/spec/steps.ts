// PUT THE STEPS IN ORDER (page frame 2026-10-04, W15): rank cards with a
// process look — `{"type": "cards", "steps": true, "items": [...], "ends":
// ["first", "last"]}`. The slots are numbered (a dashed place with a number
// badge over it) and spaced for an arrow between each two; the arrows
// (<id>_arrow_1 …) stand OUTSIDE the cards' group, so drawing the cards gives
// nothing away: the player draws them in once the cards have slid into the
// true order (render/player.ts cardsAsk), the plan shows them after the ask.
// A row; a column when asked (`arrange: "column"`) or when a row's cards
// cannot hold their words in two lines. Scored as any rank ({g} "3 of 5").

import type { Pt } from "../layout/model";
import type { SpecElement } from "./types";

/** Room between two slots for the arrow (× the size). */
export const ARROW_ROOM = 46;
/** A column's arrows are shorter: its height is dearer than a row's width. */
const COLUMN_ARROW_ROOM = 34;
/** The number badge's radius (× the size). */
const BADGE_R = 14;
const QUIET = "#7a7468";

export interface StepsSlots {
  slots: Pt[];
  /** Card width. */
  w: number;
}

/** A steps set is drawn as a column (else a row). */
export function stepsColumn(arrange: string | undefined, rowTooLong: boolean, n: number): boolean {
  return arrange === "column" || (arrange !== "row" && rowTooLong && n <= 6);
}

/** The slots of a row: n cards across [x0, x0 + width] with an arrow's room between each two. */
export function stepsRow(n: number, x0: number, width: number, y: number, k: number): StepsSlots {
  const room = ARROW_ROOM * k;
  const w = Math.min(190 * k, (width - room * (n - 1)) / Math.max(1, n));
  const used = n * w + (n - 1) * room;
  const left = x0 + (width - used) / 2 + w / 2;
  return { w, slots: Array.from({ length: n }, (_, i) => [left + i * (w + room), y] as Pt) };
}

/** The slots of a column: n cards down from yTop (the first card's centre), cards `ch` high. */
export function stepsColumnSlots(n: number, cx: number, yTop: number, ch: number, k: number): Pt[] {
  return Array.from({ length: n }, (_, i) => [cx, yTop - i * (ch + COLUMN_ARROW_ROOM * k)] as Pt);
}

/** Where slot s's number badge stands: over a row's slot, left of a column's. */
export function badgeAt(slots: Pt[], s: number, w: number, h: number, column: boolean, k: number): Pt {
  const p = slots[s];
  return column ? [p[0] - w / 2 - (BADGE_R + 8) * k, p[1]] : [p[0], p[1] + h / 2 + (BADGE_R + 8) * k];
}

/** The arrow ids, one between each two slots. */
export function stepsArrowIds(id: string, n: number): string[] {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => `${id}_arrow_${i + 1}`);
}

/** The arrows from each slot to the next (they stand between the cards in the true order). */
export function stepsArrows(id: string, slots: Pt[], w: number, h: number, column: boolean, k: number): SpecElement[] {
  const pad = 7 * k;
  return stepsArrowIds(id, slots.length).map((aid, i) => {
    const a = slots[i], b = slots[i + 1];
    const from = column ? { x: a[0], y: a[1] - h / 2 - pad } : { x: a[0] + w / 2 + pad, y: a[1] };
    const to = column ? { x: b[0], y: b[1] + h / 2 + pad } : { x: b[0] - w / 2 - pad, y: b[1] };
    return { id: aid, type: "arrow", from, to, style: { color: QUIET } } as SpecElement;
  });
}

/** A circle as a closed polygon. */
function circle(c: Pt, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let s = 0; s < 24; s++) out.push([c[0] + r * Math.cos((s / 24) * 2 * Math.PI), c[1] + r * Math.sin((s / 24) * 2 * Math.PI)]);
  return out;
}

/** The numbered places — drawn under the cards (a dashed outline each) and their badges. */
export function stepsSlotElements(id: string, slots: Pt[], w: number, h: number, column: boolean, k: number): SpecElement[] {
  const out: SpecElement[] = [];
  slots.forEach((p, s) => {
    const l = p[0] - w / 2, r = p[0] + w / 2, t = p[1] + h / 2, b = p[1] - h / 2;
    out.push({ id: `${id}_slot_${s + 1}`, type: "path", points: [[l, b], [l, t], [r, t], [r, b]], closed: true, style: { color: QUIET, dash: true } });
    const c = badgeAt(slots, s, w, h, column, k);
    out.push({ id: `${id}_slot_${s + 1}_ring`, type: "path", points: circle(c, BADGE_R * k), closed: true, style: { color: QUIET } });
    out.push({ id: `${id}_slot_${s + 1}_num`, type: "text", text: String(s + 1), x: c[0], y: c[1], font_size: Math.round(18 * k), style: { color: QUIET } });
  });
  return out;
}

/** A steps set's end words: under a row's first and last slots; over a column's first, under its last. */
export function stepsEnds(id: string, ends: string[], slots: Pt[], h: number, column: boolean, k: number): SpecElement[] {
  const first = slots[0], last = slots[slots.length - 1];
  const fs = Math.round(20 * k);
  const style = { color: QUIET };
  if (column) {
    return [
      { id: `${id}_end_1`, type: "text", text: ends[0], x: first[0], y: first[1] + h / 2 + 22 * k, font_size: fs, style },
      { id: `${id}_end_2`, type: "text", text: ends[1], x: last[0], y: last[1] - h / 2 - 22 * k, font_size: fs, style },
    ];
  }
  return [
    { id: `${id}_end_1`, type: "text", text: ends[0], x: first[0], y: first[1] - h / 2 - 22 * k, font_size: fs, style },
    { id: `${id}_end_2`, type: "text", text: ends[1], x: last[0], y: last[1] - h / 2 - 22 * k, font_size: fs, style },
  ];
}

/** What the badges and end words add to the set's box (cards.ts cardsExtent). */
export function stepsExtentAdd(slots: Pt[], w: number, h: number, column: boolean, k: number, ends: boolean, add: (l: number, r: number, b: number, t: number) => void): void {
  if (slots.length === 0) return;
  slots.forEach((_, s) => {
    const c = badgeAt(slots, s, w, h, column, k);
    add(c[0] - BADGE_R * k, c[0] + BADGE_R * k, c[1] - BADGE_R * k, c[1] + BADGE_R * k);
  });
  if (!ends) return;
  const first = slots[0], last = slots[slots.length - 1];
  if (column) {
    add(first[0], first[0], first[1], first[1] + h / 2 + 34 * k);
    add(last[0], last[0], last[1] - h / 2 - 34 * k, last[1]);
  } else add(first[0], last[0], first[1] - h / 2 - 34 * k, first[1]);
}
