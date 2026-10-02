// Cards revealed BESIDE the viewer's answer (spec 2026-10-03-round6 §3): the
// cards stay where the viewer put them; each gets ✓ (green) or ✗ (red); the
// truth is drawn beside them in ink — a small "true order" column (rank),
// true pins on the line (place), the true lines (match) — or, for a card in
// the wrong place, a thin red arrow to where it belongs (sort). Pure, like
// cards/model.ts cardsMarks (which the morph reveal keeps).

import type { Pt } from "../layout/model";
import type { CardsGeometry } from "../spec/cards";
import type { GuessMarkLine, GuessMarkText, GuessMarks } from "../guess/marks";
import { TRUTH, WRONG, YOURS, arrow, tick } from "../guess/reveal";
import { matchLines, placePins, positions, rightCards, rightPick, type Arrangement } from "./model";

/** A card's text for the true-order column: short canvas text. */
function short(t: string, n = 22): string {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
}

/** Where the segment from the centre of a w×h box at `c` towards `to` leaves the box. */
function edgeToward(c: Pt, w: number, h: number, to: Pt, pad = 4): Pt {
  const dx = to[0] - c[0], dy = to[1] - c[1];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return c;
  const sx = Math.abs(dx) > 1e-9 ? (w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 1e-9 ? (h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return [c[0] + dx * s, c[1] + dy * s];
}

interface Rect {
  l: number;
  r: number;
  b: number;
  t: number;
}
const rectOf = (c: Pt, w: number, h: number, pad = 0): Rect => ({ l: c[0] - w / 2 - pad, r: c[0] + w / 2 + pad, b: c[1] - h / 2 - pad, t: c[1] + h / 2 + pad });

/** Whether the segment a→b passes through any of the rects (sampled every few units). */
function hits(a: Pt, b: Pt, rects: Rect[]): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
    if (rects.some((r) => x > r.l && x < r.r && y > r.b && y < r.t)) return true;
  }
  return false;
}

/**
 * A thin red arrow from the card at `c` (w×h) to the box `to` (its centre and
 * size), kept off the other cards (final fix wave E): straight when that is
 * clear, else bent once round them — through a point beside the straight
 * line's middle, or an L — and null when no such route is clear.
 */
function routedArrow(c: Pt, w: number, h: number, to: { c: Pt; w: number; h: number }, others: Rect[], pad: number): GuessMarkLine[] | null {
  const straightFrom = edgeToward(c, w, h, to.c);
  const straightTo = edgeToward(to.c, to.w, to.h, c, pad);
  if (!hits(straightFrom, straightTo, others)) return arrow(straightFrom, straightTo, WRONG, 2);
  const mid: Pt = [(c[0] + to.c[0]) / 2, (c[1] + to.c[1]) / 2];
  const len = Math.hypot(to.c[0] - c[0], to.c[1] - c[1]) || 1;
  const nx = -(to.c[1] - c[1]) / len, ny = (to.c[0] - c[0]) / len;
  const ways: Pt[] = [];
  for (const d of [40, 70, 100, 140, 180, 230]) ways.push([mid[0] + nx * d, mid[1] + ny * d], [mid[0] - nx * d, mid[1] - ny * d]);
  ways.push([c[0], to.c[1]], [to.c[0], c[1]]);
  for (const m of ways) {
    // On the canvas: a bend off the figure is no way round.
    if (m[0] < 12 || m[0] > 988 || m[1] < 12 || m[1] > 738) continue;
    const a = edgeToward(c, w, h, m);
    const b = edgeToward(to.c, to.w, to.h, m, pad);
    if (hits(a, m, others) || hits(m, b, others)) continue;
    const head = arrow(m, b, WRONG, 2);
    if (head.length === 0) continue;
    return [{ pts: [a, m, b], color: WRONG, width: 2 }, head[1]];
  }
  return null;
}

/** The parts the reveal walks through one by one ("each"): cards (rank,
 *  sort, place), left cards (match), pairs (compare), blanks (fill), the choice. */
export function cardsParts(g: CardsGeometry): number {
  switch (g.mode) {
    case "match":
      return g.pairs ?? 0;
    case "compare":
      return (g.rows ?? []).length;
    case "fill":
      return g.binBoxes.length;
    case "decide":
      return 1;
    default:
      return g.cards.length;
  }
}

/**
 * Where the cards stand in a beside reveal: where the viewer left them —
 * except a formula's tiles (fill), which step down just under their box so
 * they never cover the formula's glyphs; the box shows the truth, as TeX
 * (final fix wave E).
 */
export function besidePositions(g: CardsGeometry, a: Arrangement): Pt[] {
  const pos = positions(g, a);
  if (g.mode !== "fill") return pos;
  a.boxes.forEach((cards, k) => {
    const bx = g.binBoxes[k];
    if (!bx) return;
    for (const c of cards) pos[c] = [bx.c[0], bx.c[1] - bx.h / 2 - g.h / 2 - 10];
  });
  return pos;
}

/**
 * The beside marks of arrangement `a`: ✓/✗ on each card where it stands,
 * the truth in ink beside. `upTo` parts only (reveal_order "each"; default
 * all). `tolerance`: place's share of the line that counts as right.
 */
export function cardsBeside(g: CardsGeometry, a: Arrangement, opts: { upTo?: number; tolerance?: number } = {}): GuessMarks {
  const right = g.mode === "place" ? rightCards(g, a, opts.tolerance && opts.tolerance > 0 ? opts.tolerance : 0.05) : rightCards(g, a);
  const upTo = opts.upTo ?? Infinity;
  const pos = besidePositions(g, a);
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  // The badge sits on the card's top-right corner, haloed in paper.
  const badge = (c: Pt, ok: boolean): GuessMarkText => tick([c[0] + g.w / 2 - 2, c[1] + g.h / 2 - 2], ok, "middle", 24);
  /** Sort: the cards no arrow can reach their box from, by the box they
   *  stand in (-1: the row) and where they belong — named in one line
   *  under that box (a dense box has no room by each card). */
  const unrouted = new Map<string, { from: number; to: number; names: string[] }>();
  switch (g.mode) {
    case "rank": {
      const column = g.slots.length > 1 && Math.abs(g.slots[0][0] - g.slots[1][0]) < 1;
      // The slot each card is in, and the order the parts are shown in: slot by slot.
      a.order.forEach((card, s) => {
        if (s >= upTo) return;
        texts.push(badge(pos[card], right[card]));
        // The true order, beside the slots: the card that belongs in slot s.
        // A row's names go a line under the end labels ("← Most", "Least →") that stand 26 under the cards.
        const at: Pt = column ? [g.slots[s][0] + g.w / 2 + 34, g.slots[s][1]] : [g.slots[s][0], g.slots[s][1] - g.h / 2 - 54];
        texts.push({ at, text: column ? `${s + 1}. ${short(g.texts[s])}` : short(g.texts[s], 14), anchor: column ? "start" : "middle", color: TRUTH, size: 18 });
      });
      break;
    }
    case "sort":
      g.cards.forEach((_, i) => {
        if (i >= upTo) return;
        texts.push(badge(pos[i], right[i]));
        if (right[i]) return;
        // To where it belongs: its box, or (select) back to the row — round the
        // other cards; when no way round is clear, a word by the card instead.
        const t = g.truthBin[i];
        const box = t >= 0 ? g.binBoxes[t] : null;
        const others = pos.filter((_, j) => j !== i).map((p) => rectOf(p, g.w, g.h, 2));
        const routed = routedArrow(pos[i], g.w, g.h, box ?? { c: g.home[i], w: g.w, h: g.h }, others, box ? 2 : 4);
        if (routed) lines.push(...routed);
        else {
          const from = a.boxes.findIndex((b) => b.includes(i));
          const key = `${from}:${t}`;
          const u = unrouted.get(key) ?? { from, to: t, names: [] };
          u.names.push(short(g.texts[i], 14));
          unrouted.set(key, u);
        }
      });
      break;
    case "place": {
      const sg = g.scale;
      if (!sg) break;
      // Your pins: from each card you placed down to its point.
      const placed = pos.filter((_, i) => a.values?.[i] !== null && a.values?.[i] !== undefined && i < upTo);
      for (const l of placePins(g, placed)) lines.push({ ...l, color: YOURS });
      g.cards.forEach((_, i) => {
        if (i >= upTo) return;
        texts.push(badge(pos[i], right[i]));
        const t = g.values?.[i];
        if (right[i] || t === undefined) return;
        // The true pin: an ink stem up from its point on the line, joined to the card.
        const xt = sg.xAt(t);
        lines.push({ pts: [[xt, sg.y], [xt, sg.y + 18]], color: TRUTH, width: 3 });
        lines.push({ pts: [[pos[i][0], pos[i][1] - g.h / 2], [xt, sg.y + 18]], color: TRUTH, width: 1.5, dashed: true });
      });
      break;
    }
    case "match": {
      const n = g.pairs ?? 0;
      const links = (a.links ?? []).map((r, i) => (i < upTo ? r : -1));
      // Yours, where the cards stand; the true line for each you got wrong, in ink.
      for (const l of matchLines(g, links, pos)) lines.push({ ...l, color: YOURS });
      for (let i = 0; i < n && i < upTo; i++) {
        texts.push(badge(pos[i], right[i] === true));
        if (right[i]) continue;
        const truth = Array.from({ length: n }, (_, j) => (j === i ? i : -1));
        for (const l of matchLines(g, truth, pos)) lines.push({ ...l, color: TRUTH, dashed: true, width: 2 });
      }
      break;
    }
    case "compare":
      (g.rows ?? []).forEach(([c0, c1], r) => {
        if (r >= upTo) return;
        const pick = a.picks?.[r] ?? -1;
        const best = rightPick(g, r) === 0 ? c0 : c1;
        if (pick >= 0) {
          const c = pick === 0 ? c0 : c1;
          const [x, y] = pos[c];
          const w = g.w / 2 + 5, h = g.h / 2 + 4;
          lines.push({ pts: [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]], closed: true, color: YOURS });
          texts.push(badge(pos[c], right[r] === true));
        }
        // The bigger one, in ink, when yours was not it.
        if (pick < 0 || !right[r]) {
          const [x, y] = pos[best];
          const w = g.w / 2 + 9, h = g.h / 2 + 8;
          lines.push({ pts: [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]], closed: true, color: TRUTH, width: 2 });
        }
      });
      break;
    case "decide":
      if ((a.choice ?? -1) >= 0) {
        const [x, y] = pos[a.choice!];
        const w = g.w / 2 + 5, h = g.h / 2 + 4;
        lines.push({ pts: [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]], closed: true, color: YOURS });
        if ((g.best ?? []).some(Boolean)) texts.push(badge(pos[a.choice!], right[0] === true));
      }
      break;
    case "fill": {
      // The tiles stand just under the boxes they were put in (besidePositions),
      // the truth written into each box as TeX: ✓/✗ by each box, and a thin
      // red arrow from each misplaced tile to the box it belongs in (a tile
      // that belongs nowhere: back to its place in the row).
      const inBox = new Map<number, number>();
      a.boxes.forEach((cards, k) => cards.forEach((c) => inBox.set(c, k)));
      g.binBoxes.forEach((bx, k) => {
        if (k >= upTo) return;
        texts.push(tick([bx.c[0] + bx.w / 2 + 14, bx.c[1]], right[k] === true, "middle", 24));
      });
      g.cards.forEach((_, i) => {
        const k = inBox.get(i);
        if (k === undefined || k >= upTo || right[k]) return;
        const t = g.truthBin[i];
        const box = t >= 0 ? g.binBoxes[t] : null;
        const target: Pt = box ? box.c : g.home[i];
        const from = edgeToward(pos[i], g.w, g.h, target);
        const to = box ? edgeToward(box.c, box.w, box.h, pos[i], 2) : edgeToward(target, g.w, g.h, pos[i]);
        lines.push(...arrow(from, to, WRONG, 2));
      });
      break;
    }
  }
  // One line per source box and target: "Onion, Ginger → Not a fruit", under the box.
  const rows = new Map<number, number>();
  for (const u of unrouted.values()) {
    const bx = u.from >= 0 ? g.binBoxes[u.from] : null;
    if (!bx) continue;
    const k = rows.get(u.from) ?? 0;
    rows.set(u.from, k + 1);
    const names = short(u.names.join(", "), 44);
    texts.push({ at: [bx.c[0], bx.c[1] - bx.h / 2 - 16 - k * 20], text: `${names} → ${u.to >= 0 ? short(g.bins[u.to], 16) : "out"}`, anchor: "middle", color: WRONG, size: 16 });
  }
  return { color: YOURS, lines, texts };
}
