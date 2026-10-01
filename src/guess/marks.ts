// What a guess leaves on the figure (spec 2026-10-01-guess-and-reveal §5):
// a GHOST of the guess (dashed, in the viewer's colour) that stays where the
// viewer put it while the figure moves to the truth, and a GAP mark spanning
// guess → truth with the difference written beside it. Pure: the effects
// layer (render/svg-backend.ts setGuessMarks) draws what this returns.

import type { Pt } from "../layout/model";
import { angleOf, pointFor, type GuessHandle } from "./handles";
import { scaleGeometry } from "../spec/scale";
import { along, curveOfGaps, impliedEquilibrium } from "./market";
import { GUESS_COLOR } from "./color";

export { GUESS_COLOR };

export interface GuessMarkLine {
  pts: Pt[];
  closed?: boolean;
  dashed?: boolean;
  /** Stroke width (default: 3 dashed, 2.5 solid). */
  width?: number;
  /** Opacity (default 1): a ghost after the reveal is lighter. */
  opacity?: number;
}

/** A filled dot: a market copy's grab handles while it is asked. */
export interface GuessMarkDot {
  at: Pt;
  r: number;
}

export interface GuessMarkText {
  at: Pt;
  text: string;
  anchor: "start" | "middle" | "end";
}

export interface GuessMarks {
  color: string;
  lines: GuessMarkLine[];
  texts: GuessMarkText[];
  dots?: GuessMarkDot[];
}

/** The market's plot area, in its domain units (the template draws 0–100 on both axes). */
const MARKET_DOMAIN = { lo: 0, hi: 100 };

/** A polyline clipped to the square [lo, hi]² (Liang–Barsky per segment): the runs inside. */
function clipToSquare(pts: Pt[], lo: number, hi: number): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    let inside = true;
    for (const [pp, q] of [[-dx, x0 - lo], [dx, hi - x0], [-dy, y0 - lo], [dy, hi - y0]] as [number, number][]) {
      if (pp === 0) {
        if (q < 0) inside = false;
        continue;
      }
      const r = q / pp;
      if (pp < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!inside || t0 > t1) {
      flush();
      continue;
    }
    const a: Pt = [x0 + dx * t0, y0 + dy * t0];
    const b: Pt = [x0 + dx * t1, y0 + dy * t1];
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - a[0], last[1] - a[1]) > 1e-9) {
      flush();
      cur.push(a);
    }
    cur.push(b);
    if (t1 < 1) flush();
  }
  flush();
  return runs;
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
export function guessMarks(handles: GuessHandle[], guess: number[][], t = 1, opts: { asking?: boolean } = {}): GuessMarks {
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
            const y = guessAbove ? (gap > 70 ? (top[1] + y1) / 2 + 12 : hi + 22) : gap > 30 ? (top[1] + y1) / 2 : hi + 34;
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
        for (const pts of runs) lines.push(asking ? { pts, width: COPY_WIDTH } : { pts, dashed: true, width: GHOST_WIDTH, opacity: GHOST_OPACITY });
        if (asking && runs.length > 0) {
          const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
          for (const at of [longest[0], midOf(longest), longest[longest.length - 1]]) dots.push({ at, r: HANDLE_R });
        }
        if (t <= 0) break;
        const at = (q: number, x: number): Pt => h.toLogical!(m.axis === "price" ? [q, x] : [x, q]);
        m.at.forEach((q, j) => {
          const b = along(m.axis, m.base, q);
          if (b === null) return;
          const a = at(q, b + v[j]);
          const e = at(q, b + v[j] + (m.truth[j] - v[j]) * t);
          if (Math.hypot(e[0] - a[0], e[1] - a[1]) <= 2) return;
          lines.push({ pts: [a, e] });
          // A tick across each end: a bracket, readable however short the gap.
          const half = GAP_TICK / 2;
          const tick = (p: Pt): Pt[] => (m.axis === "price" ? [[p[0] - half, p[1]], [p[0] + half, p[1]]] : [[p[0], p[1] - half], [p[0], p[1] + half]]);
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

function signed(h: GuessHandle, d: number): string {
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${h.format(Math.abs(d))}`;
}

function signedScale(format: (v: number) => string, d: number): string {
  // A difference of years is a number of years, not a year: "+6", never "+0006".
  const body = format(Math.abs(d));
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${body}`;
}

/** On a log scale the gap is a factor: "×43" (the truth is 43 times the guess), "÷5". */
function ratioText(truth: number, guess: number): string {
  if (!(truth > 0) || !(guess > 0)) return "";
  const r = truth >= guess ? truth / guess : guess / truth;
  const n = r < 10 ? String(Math.round(r * 10) / 10) : String(Math.round(r));
  return `${truth >= guess ? "×" : "÷"}${n}`;
}
