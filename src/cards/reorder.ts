// Rank revealed by reordering (round 7 §4): ✓/✗ where the viewer left each
// card, a faint "yours" row of their order, the cards slide into the true
// order — those moving one way over the row, the other way under it — and
// thin blue connectors show how far each moved. Pure; render/player.ts plays it.

import type { Pt } from "../layout/model";
import type { CardsGeometry } from "../spec/cards";
import type { GuessMarkLine, GuessMarks, GuessMarkText } from "../guess/marks";
import { tick, YOURS } from "../guess/reveal";
import { positions, rightCards, type Arrangement } from "./model";

/** The verdicts stand this long before the cards move. */
export const VERDICT_MS = 800;
/** The slide into the true order. */
export const REORDER_MS = 900;
const LABEL_SIZE = 16;
const LABEL_CHARS = 14;
const CANVAS_W = 1000;
const CANVAS_H = 750;

const ease = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const short = (t: string): string => (t.length > LABEL_CHARS ? `${t.slice(0, LABEL_CHARS - 1)}…` : t);

export function isColumn(g: CardsGeometry): boolean {
  return g.slots.length > 1 && Math.abs(g.slots[0][0] - g.slots[1][0]) < 1;
}

/** Which side a card passes on: a row's rightward card above (+1), leftward below; a column's downward card right, upward left. */
export function reorderSide(g: CardsGeometry, from: Pt, to: Pt): 1 | -1 {
  if (isColumn(g)) return to[1] < from[1] ? 1 : -1;
  return to[0] > from[0] ? 1 : -1;
}

/**
 * Where a card stands at t (0..1) on its way from `from` to `to`: lifted
 * clear of the row first (a card and a little more — longer moves ride
 * higher, over the shorter), along, set down. Never off the canvas.
 */
export function reorderAt(g: CardsGeometry, from: Pt, to: Pt, t: number): Pt {
  const moved = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (moved < 0.5) return from;
  const column = isColumn(g);
  const pitch = g.slots.length > 1 ? Math.hypot(g.slots[1][0] - g.slots[0][0], g.slots[1][1] - g.slots[0][1]) : moved;
  const along = ease((t - 0.15) / 0.7);
  const x = from[0] + (to[0] - from[0]) * along;
  const y = from[1] + (to[1] - from[1]) * along;
  const side = reorderSide(g, from, to);
  const size = column ? g.w : g.h;
  let lift = size + 6 + 10 * Math.max(0, Math.round(moved / pitch) - 1);
  // The canvas edge caps it.
  if (column) lift = Math.min(lift, side > 0 ? CANVAS_W - g.w / 2 - x : x - g.w / 2);
  else lift = Math.min(lift, side > 0 ? CANVAS_H - g.h / 2 - y : y - g.h / 2);
  const up = Math.max(0, lift) * ease(Math.min(t, 1 - t) / 0.2);
  return column ? [x + side * up, y] : [x, y + side * up];
}

/** ✓/✗ on each card where the viewer left it. */
export function rankVerdicts(g: CardsGeometry, a: Arrangement): GuessMarks {
  const right = rightCards(g, a);
  const at = positions(g, a);
  return { color: YOURS, lines: [], texts: g.cards.map((_, i) => tick([at[i][0] + g.w / 2 - 2, at[i][1] + g.h / 2 - 2], right[i], "middle", 24)) };
}

/** Where slot s's label stands: just above the row, or just left of a column. */
function labelAt(g: CardsGeometry, s: number): Pt {
  const p = g.slots[s];
  // Well clear of the cards, so each connector climbs to its card rather than running along the row.
  // Steps' number badges (spec/steps.ts) stand where the row's labels would: these go over them.
  const badge = g.arrows ? 26 : 0;
  return isColumn(g) ? [p[0] - g.w / 2 - 44 - badge, p[1]] : [p[0], Math.min(740, p[1] + g.h / 2 + 56 + badge)];
}

/** The viewer's order, faint: a short label at each slot whose card was wrong (the right ones leave a gap), the word at its start. */
export function yoursRow(g: CardsGeometry, a: Arrangement, word: string): GuessMarkText[] {
  const right = rightCards(g, a);
  const column = isColumn(g);
  const out: GuessMarkText[] = [];
  a.order.forEach((card, s) => {
    if (right[card]) return;
    out.push({ at: labelAt(g, s), text: short(g.texts[card]), anchor: column ? "end" : "middle", color: YOURS, size: LABEL_SIZE });
  });
  if (out.length === 0) return out;
  const s0 = g.slots[0];
  const wordAt: Pt = column ? [s0[0] - g.w / 2 - 44, Math.min(740, s0[1] + g.h / 2 + 16)] : [Math.max(48, s0[0] - g.w / 2 - 8), labelAt(g, 0)[1]];
  return [{ at: wordAt, text: word, anchor: "end", color: YOURS, size: LABEL_SIZE }, ...out];
}

/** Once landed: the yours row, a connector from each moved card's label to where it now stands, ✓ on the cards that never moved. */
export function reorderLanded(g: CardsGeometry, a: Arrangement, word: string): GuessMarks {
  const right = rightCards(g, a);
  const column = isColumn(g);
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [...yoursRow(g, a, word)];
  a.order.forEach((card, s) => {
    const t = g.truth[card];
    if (right[card]) {
      texts.push(tick([t[0] + g.w / 2 - 2, t[1] + g.h / 2 - 2], true, "middle", 24));
      return;
    }
    const l = labelAt(g, s);
    const from: Pt = column ? [l[0] + 4, l[1]] : [l[0], l[1] - 9];
    const to: Pt = column ? [t[0] - g.w / 2 - 2, t[1]] : [t[0], t[1] + g.h / 2 + 2];
    lines.push({ pts: [from, to], color: YOURS, width: 1.5 });
  });
  return { color: YOURS, lines, texts };
}
