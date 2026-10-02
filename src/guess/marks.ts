// What a guess leaves on the figure (spec 2026-10-01-guess-and-reveal §5):
// a GHOST of the guess (dashed, in the viewer's colour) that stays where the
// viewer put it while the figure moves to the truth, and a GAP mark spanning
// guess → truth with the difference written beside it. Pure: the effects
// layer (render/svg-backend.ts setGuessMarks) draws what this returns.

import type { Pt } from "../layout/model";
import { accountOf, angleOf, budgetBalanced, dockNumber, pointFor, type GuessHandle } from "./handles";
import { scaleGeometry } from "../spec/scale";
import { MARKET_DOMAIN, along, clipToSquare, curveOfGaps, impliedEquilibrium } from "./market";
import { GUESS_COLOR } from "./color";
import { CANVAS } from "../layout/canvas";
import { AXIS_OVERHANG } from "../layout/axes";

export { GUESS_COLOR };

export interface GuessMarkLine {
  pts: Pt[];
  closed?: boolean;
  dashed?: boolean;
  /** Stroke width (default: 3 dashed, 2.5 solid). */
  width?: number;
  /** Opacity (default 1): a ghost after the reveal is lighter. */
  opacity?: number;
  /** Stroke colour (default: the set's colour) — a beside reveal mixes the
   *  viewer's blue with the truth's ink and the ✓/✗ colours in one set. */
  color?: string;
  /** Filled (closed) with this colour at `fillOpacity` (default 0.6). */
  fill?: string;
  fillOpacity?: number;
  /** false: a fill with no outline. */
  stroke?: false;
}

/** A filled dot: a market copy's grab handles while it is asked. */
export interface GuessMarkDot {
  at: Pt;
  r: number;
  color?: string;
  opacity?: number;
}

export interface GuessMarkText {
  at: Pt;
  text: string;
  anchor: "start" | "middle" | "end";
  /** Colour (default: the set's colour), size (default 20) and opacity (default 1). */
  color?: string;
  size?: number;
  opacity?: number;
  /** A gap written in ink between yours and the truth: it fades with yours (final fix wave E). */
  gap?: true;
}

export interface GuessMarks {
  color: string;
  lines: GuessMarkLine[];
  texts: GuessMarkText[];
  dots?: GuessMarkDot[];
}

/** The point halfway along a polyline (by length). */
function midOf(pts: Pt[]): Pt {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] && seg[i] > 0) {
      const f = left / seg[i];
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }
    left -= seg[i];
  }
  return pts[pts.length - 1];
}

/** How the market copy is drawn while asked, and as a ghost after. */
const COPY_WIDTH = 4;
const GHOST_WIDTH = 2.5;
const GHOST_OPACITY = 0.5;
const HANDLE_R = 6;
const GAP_TICK = 14;
const OPEN_DOT_R = 12;

/**
 * The marks for these handles: ghosts at `guess`; gaps grown to `t` (0..1)
 * of the way from guess to truth — the gap is drawn as the reveal runs.
 */
export function guessMarks(handles: GuessHandle[], guess: number[][], t = 1, opts: { asking?: boolean; beside?: boolean; shift?: boolean } = {}): GuessMarks {
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  const dots: GuessMarkDot[] = [];
  handles.forEach((h, k) => {
    const g = guess[k] ?? h.truth;
    switch (h.kind) {
      case "height": {
        const top = pointFor(h, g);
        const truthTop = pointFor(h, h.truth);
        if (!top || !truthTop || h.cx === undefined || h.halfW === undefined || !h.toLogical) break;
        const base = h.toLogical([0, Math.max(h.min, Math.min(h.max, 0))])[1];
        const x0 = h.cx - h.halfW, x1 = h.cx + h.halfW;
        lines.push({ pts: [[x0, base], [x0, top[1]], [x1, top[1]], [x1, base]], dashed: true });
        if (t > 0 && Math.abs(truthTop[1] - top[1]) > 4) {
          const bx = x1 + 12;
          const y1 = top[1] + (truthTop[1] - top[1]) * t;
          lines.push({ pts: [[bx - 5, top[1]], [bx, top[1]], [bx, y1], [bx - 5, y1]] });
          // Written in the gap itself, over the bar: beside it is the next bar's
          // room. The bar's own value label stands 13 over the TRUE top, so a
          // guess above the truth keeps its number clear of it: in the gap only
          // when the gap is tall, else over the ghost.
          if (t >= 1) {
            const gap = Math.abs(y1 - top[1]);
            const hi = Math.max(top[1], y1);
            const guessAbove = top[1] > y1;
            // Over the ghost, and never on the value label (15-unit type
            // centred 13 over the true top): a guess just above the truth
            // wrote "−1" across its "3" (round 5).
            const y = guessAbove ? (gap > 70 ? (top[1] + y1) / 2 + 12 : Math.max(hi + 22, truthTop[1] + 34)) : gap > 30 ? (top[1] + y1) / 2 : hi + 34;
            texts.push({ at: [h.cx, y], text: signed(h, h.truth[0] - g[0]), anchor: "middle" });
          }
        }
        break;
      }
      case "curve": {
        const pts: Pt[] = [];
        if (h.given && h.given.length > 0 && h.toLogical) pts.push(h.toLogical([h.given[h.given.length - 1].x, h.given[h.given.length - 1].v]));
        g.forEach((_, j) => {
          const p = pointFor(h, g, j);
          if (p) pts.push(p);
        });
        if (pts.length >= 2) lines.push({ pts, dashed: true });
        // The gap, point by point: a connector from each guessed point to the
        // true one, and the average miss written by the last point.
        if (t > 0 && h.toLogical && h.xs) {
          let sum = 0;
          let top: Pt | null = null;
          h.xs.forEach((x, j) => {
            const gv = g[j] ?? h.truth[j];
            const a = h.toLogical!([x, gv]);
            const b = h.toLogical!([x, gv + (h.truth[j] - gv) * t]);
            if (Math.abs(b[1] - a[1]) > 2) lines.push({ pts: [a, b] });
            sum += Math.abs(h.truth[j] - gv);
            top = [a[0], Math.max(a[1], b[1])];
          });
          if (t >= 1 && top) texts.push({ at: [(top as Pt)[0], (top as Pt)[1] + 24], text: `±${h.format(sum / h.xs.length)} avg`, anchor: "middle" });
        }
        break;
      }
      case "angle": {
        if (!h.centre || h.radius === undefined) break;
        const c = h.centre, r = h.radius;
        const at = (f: number, rr: number): Pt => [c[0] + rr * Math.sin(f * 2 * Math.PI), c[1] + rr * Math.cos(f * 2 * Math.PI)];
        const n = h.truth.length === 1 ? 1 : h.truth.length - 1;
        for (let j = 0; j < n; j++) {
          const fg = angleOf(h, g, j);
          const ft = angleOf(h, h.truth, j);
          lines.push({ pts: [c, at(fg, r)], dashed: true });
          if (t > 0 && Math.abs(ft - fg) > 0.005) {
            const arc: Pt[] = [];
            const steps = 24;
            for (let s = 0; s <= steps; s++) arc.push(at(fg + ((ft - fg) * t * s) / steps, r + 22));
            lines.push({ pts: arc });
          }
        }
        break;
      }
      case "count": {
        if (!h.box) break;
        texts.push({ at: [h.box.x, h.box.y + h.box.h + 22], text: `you ${h.format(g[0])}`, anchor: "start" });
        break;
      }
      case "point": {
        if (!h.scale) break;
        const sg = scaleGeometry(h.scale);
        const x = sg.xAt(g[0]);
        const y = sg.y;
        lines.push({ pts: [[x - 10, y + 30], [x + 10, y + 30], [x, y + 6]], closed: true, dashed: true });
        const xt = sg.xAt(h.truth[0]);
        if (t > 0 && Math.abs(xt - x) > 4) {
          const x1 = x + (xt - x) * t;
          const by = y - 58;
          lines.push({ pts: [[x, by + 6], [x, by], [x1, by], [x1, by + 6]] });
          if (t >= 1) texts.push({ at: [(x + x1) / 2, by - 16], text: sg.kind === "log" ? ratioText(h.truth[0], g[0]) : signedScale(sg.format, h.truth[0] - g[0]), anchor: "middle" });
        }
        break;
      }
      case "market": {
        // The viewer's copy, clipped to the plot. While asked it is solid and
        // a little thicker, with grab dots at its middle and both ends, so it
        // reads as something to drag; after, a dashed, lighter ghost that
        // cannot be taken for the true curve. As the truth arrives: the two
        // gaps (at the scored points) as brackets with the gap written, and
        // the equilibrium the guess implied, an open dot wider than the
        // template's own equilibrium dot.
        const m = h.market;
        if (!m || !h.toLogical) break;
        const v: [number, number] = [g[0] ?? 0, g[1] ?? 0];
        const copy = curveOfGaps(m, v);
        const runs = clipToSquare(copy, MARKET_DOMAIN.lo, MARKET_DOMAIN.hi).map((r) => r.map(h.toLogical!));
        const asking = opts.asking === true;
        // Beside (spec 2026-10-03-round6 §3): the copy stays as it was answered, solid.
        for (const pts of runs) lines.push(asking || opts.beside ? { pts, width: COPY_WIDTH } : { pts, dashed: true, width: GHOST_WIDTH, opacity: GHOST_OPACITY });
        if (asking && runs.length > 0) {
          const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
          for (const at of [longest[0], midOf(longest), longest[longest.length - 1]]) dots.push({ at, r: HANDLE_R });
        }
        const at = (q: number, x: number): Pt => h.toLogical!(m.axis === "price" ? [q, x] : [x, q]);
        const half = GAP_TICK / 2;
        const tick = (p: Pt): Pt[] => (m.axis === "price" ? [[p[0] - half, p[1]], [p[0] + half, p[1]]] : [[p[0], p[1] - half], [p[0], p[1] + half]]);
        if (asking && opts.shift !== false) {
          // The live shift (the viewer's own, never the truth's): a bracket at
          // each scored point from the old curve to the copy, the distance
          // written beside it — once when both say the same (a parallel move).
          let wrote = "";
          m.at.forEach((q, j) => {
            const b = along(m.axis, m.base, q);
            if (b === null) return;
            // Off the plot the copy is clipped away: so is its bracket.
            if (b + v[j] < MARKET_DOMAIN.lo || b + v[j] > MARKET_DOMAIN.hi) return;
            const a = at(q, b);
            const e = at(q, b + v[j]);
            if (Math.hypot(e[0] - a[0], e[1] - a[1]) <= 2) return;
            lines.push({ pts: [a, e], dashed: true, width: 2 }, { pts: tick(a), width: 2 }, { pts: tick(e), width: 2 });
            const text = signed(h, v[j]);
            if (text === wrote) return;
            wrote = text;
            const mid: Pt = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
            texts.push(m.axis === "price" ? { at: [mid[0] + half + 6, mid[1]], text, anchor: "start" } : { at: [mid[0], mid[1] - half - 14], text, anchor: "middle" });
          });
        }
        if (t <= 0) break;
        m.at.forEach((q, j) => {
          const b = along(m.axis, m.base, q);
          if (b === null) return;
          const a = at(q, b + v[j]);
          const e = at(q, b + v[j] + (m.truth[j] - v[j]) * t);
          if (Math.hypot(e[0] - a[0], e[1] - a[1]) <= 2) return;
          lines.push({ pts: [a, e] });
          // A tick across each end: a bracket, readable however short the gap.
          lines.push({ pts: tick(a) }, { pts: tick(e) });
          if (t >= 1) {
            const mid: Pt = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
            const text = signed(h, m.truth[j] - v[j]);
            texts.push(m.axis === "price" ? { at: [mid[0] + half + 6, mid[1]], text, anchor: "start" } : { at: [mid[0], mid[1] - half - 14], text, anchor: "middle" });
          }
        });
        const eq = impliedEquilibrium(copy, m.other);
        if (eq && eq[0] >= MARKET_DOMAIN.lo && eq[0] <= MARKET_DOMAIN.hi && eq[1] >= MARKET_DOMAIN.lo && eq[1] <= MARKET_DOMAIN.hi) {
          const c = h.toLogical(eq);
          const r = OPEN_DOT_R;
          const ring: Pt[] = [];
          for (let s = 0; s < 24; s++) ring.push([c[0] + r * Math.cos((s / 24) * 2 * Math.PI), c[1] + r * Math.sin((s / 24) * 2 * Math.PI)]);
          lines.push({ pts: ring, closed: true, width: 3 });
        }
        break;
      }
    }
  });
  return { color: GUESS_COLOR, lines, texts, ...(dots.length > 0 ? { dots } : {}) };
}

/** The account bar overspent (spec 2026-10-03-looks-feedback-account §5). */
export const ACCOUNT_RED = "#b3412e";

/** Account bar geometry: its half width at most, the gap from the canvas
 *  edge, from the last bar, and the lowest/highest y it is drawn to (the top
 *  leaves room for the number and the label above it). */
const ACCOUNT_HALF_W = 22;
const ACCOUNT_EDGE = 4;
const ACCOUNT_GAP = 10;
const ACCOUNT_FLOOR = 15;
/** The words' line height, and the space they keep from the canvas top. */
const ACCOUNT_LINE = 24;
const ACCOUNT_TOP = CANVAS.h - 10;
/** The baseline tick runs this far past each side of the account bar. */
const ACCOUNT_TICK = 6;
/** Rough half width of a 20-unit label: ~0.6 em a character. */
const textHalf = (t: string): number => t.length * 6;
/** A label's words on as few lines as fit `width` (one word a line at worst). */
function wrapLabel(label: string, width: number): string[] {
  const out: string[] = [];
  for (const w of label.split(/\s+/).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last !== undefined && 2 * textHalf(`${last} ${w}`) <= width) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
  }
  return out.length > 0 ? out : [label];
}

/**
 * A budget's account bar (spec 2026-10-03-looks-feedback-account §5): a bar
 * standing right of the plot, on the bars' own scale, its value budget − sum,
 * labelled `label` with its number. Overspent, it hangs below the baseline in
 * red. A guess mark, so the chart's layout and data are untouched.
 *
 * It always stays on the canvas, clear of the x-axis arrow: past the arrow's
 * tip when there is room (a bar chart's axis runs half a pitch past the last
 * bar and AXIS_OVERHANG on), else in the margin right of the last bar. A
 * value past the room it has is cut there: overspent (below the baseline,
 * where a chart has only a strip) with a break mark (two slanted ticks);
 * plenty left (above the canvas) open-topped, with no break mark, which would
 * read as overspent. The number and the label stand above the bar (overspent:
 * above the baseline, in the free space beside the bars, so the number is
 * read however deep it goes), the label wrapped to the room there.
 */
export function accountMarks(handles: GuessHandle[], values: number[][], budget: number, label = "Left"): GuessMarks {
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  const bars = handles.filter((h) => h.kind === "height" && h.cx !== undefined && h.halfW !== undefined && h.toLogical);
  const balanced = budgetBalanced(handles, values, budget);
  const account = balanced ? 0 : accountOf(values, budget);
  const color = account < 0 ? ACCOUNT_RED : GUESS_COLOR;
  if (bars.length === 0) return { color, lines, texts };
  const h0 = bars[0];
  const cxs = bars.map((b) => b.cx!);
  const last = Math.max(...cxs);
  const lastEdge = Math.max(...bars.map((b) => b.cx! + b.halfW!));
  const pitch = bars.length > 1 ? (last - Math.min(...cxs)) / (bars.length - 1) : h0.halfW! * 4;
  // As the dock says it (dockNumber): "22", not "22.0".
  const number = `${account < 0 ? "−" : ""}${dockNumber(h0.format(Math.abs(account)))}`;
  const widest = Math.min(ACCOUNT_HALF_W, h0.halfW!, pitch * 0.4);
  // Past the x-axis arrow's tip, its tick clear of the head.
  const tip = Math.max(lastEdge, last + pitch / 2) + AXIS_OVERHANG;
  const past = tip + 4 + ACCOUNT_TICK;
  const right = CANVAS.w - ACCOUNT_EDGE - ACCOUNT_TICK;
  let halfW: number, cx: number;
  if ((right - past) / 2 >= 8) {
    halfW = Math.min(widest, (right - past) / 2);
    cx = past + halfW;
  } else {
    // No room past the arrow: in the margin right of the last bar, narrowed before it overlaps.
    const room = CANVAS.w - ACCOUNT_EDGE - (lastEdge + ACCOUNT_GAP);
    halfW = Math.max(4, Math.min(widest, room / 2 - ACCOUNT_TICK));
    cx = Math.max(lastEdge + ACCOUNT_GAP + halfW + ACCOUNT_TICK, Math.min(last + pitch, right - halfW));
  }
  // On the same scale, cut where the canvas (or the chart's strip below the baseline) ends.
  const zero = Math.max(h0.min, Math.min(h0.max, 0));
  const base = h0.toLogical!([0, zero])[1];
  const want = h0.toLogical!([0, zero + account])[1];
  // The words: centred on the bar, pulled in to the room right of the last bar.
  const roomL = lastEdge + 6, roomR = CANVAS.w - 2;
  const words = wrapLabel(label, roomR - roomL);
  // The bar's top leaves room above it for the number and the label's lines.
  const ceil = ACCOUNT_TOP - ACCOUNT_LINE * (1 + words.length);
  const end = Math.max(ACCOUNT_FLOOR, Math.min(ceil, want));
  const cut = Math.abs(want - end) > 0.5;
  const x0 = cx - halfW, x1 = cx + halfW;
  if (Math.abs(end - base) > 0.5) {
    lines.push({ pts: [[x0, base], [x0, end], [x1, end], [x1, base]], closed: !cut });
    if (cut) lines.push({ pts: [[x0, end], [x0, base], [x1, base], [x1, end]] });
    // A light hatch: a solid bar, unlike the dashed ghost of a guess.
    const dir = end > base ? 1 : -1;
    for (let y = base + dir * 8; dir * (end - y) > 3; y += dir * 8) lines.push({ pts: [[x0 + 3, y], [x1 - 3, y]], width: 1.5, opacity: 0.45 });
    if (cut && account < 0) {
      // The break: two short slanted ticks across the cut end.
      for (const off of [3, 10]) {
        const y = end - dir * off;
        lines.push({ pts: [[x0 - 4, y - 3], [x1 + 4, y + 3]], width: 2 });
      }
    }
  }
  lines.push({ pts: [[x0 - ACCOUNT_TICK, base], [x1 + ACCOUNT_TICK, base]], width: 2 });
  const at = (t: string): number => Math.max(roomL + textHalf(t), Math.min(roomR - textHalf(t), cx));
  let y = account < 0 ? base + 30 : Math.max(end, base) + ACCOUNT_LINE;
  texts.push({ at: [at(number), y], text: number, anchor: "middle" });
  for (const w of words.slice().reverse()) {
    y += ACCOUNT_LINE;
    texts.push({ at: [at(w), y], text: w, anchor: "middle" });
  }
  return { color, lines, texts };
}

export function signed(h: GuessHandle, d: number): string {
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${h.format(Math.abs(d))}`;
}

export function signedScale(format: (v: number) => string, d: number): string {
  // A difference of years is a number of years, not a year: "+6", never "+0006".
  const body = format(Math.abs(d));
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${body}`;
}

/** On a log scale the gap is a factor: "×43" (the truth is 43 times the guess), "÷5". */
export function ratioText(truth: number, guess: number): string {
  if (!(truth > 0) || !(guess > 0)) return "";
  const r = truth >= guess ? truth / guess : guess / truth;
  const n = r < 10 ? String(Math.round(r * 10) / 10) : String(Math.round(r));
  return `${truth >= guess ? "×" : "÷"}${n}`;
}
