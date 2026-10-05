// The BESIDE reveal (spec 2026-10-03-round6 §3; the "You" round 2026-10-05):
// the viewer's answer is evidence and keeps its place on the figure; the
// truth is drawn as a second thing beside or over it. One colour language
// everywhere, from the first moment of the ask: blue = YOURS, tagged with
// the word "You" (ui/gate-words.ts `yours`; "Du" in Norwegian); ink = the
// truth, never the viewer's colour; green ✓ = right, red ✗ = wrong. Your
// answer stays at full strength while the ask's own lines are spoken and
// fades to FADED at the next command.
//
// Pure: per form, what the figure is painted from while the reveal runs
// (values and the template's room-making params), and the marks it leaves.
// render/player.ts times it; render/svg-backend.ts setGuessMarks draws it.
//
// Bars: HALVES — the template draws the true bar in the right half of its
// width (bar_chart's run-time `beside_bars`), growing from zero in the
// chart's own colour, so the truth keeps the chart's look; your bar is a
// mark in the left half, blue at a 60 % tint, tagged "You". A pie: the
// template's pie (the truth) moves to the right of the pair (pie_chart's
// `beside_pie`), your pie is a blue mark on the left, "You" under it. A
// line: yours stays blue ("You" at its right end), the true line draws over
// it in ink. A scale: the one form where yours MOVES — your blue "You" pin
// glides along the line to the truth, leaving a faint ghost (pin, number, a
// small "You") where you put it, the gap bracket growing behind it; on
// arrival the scale's own pin and number land on the truth in ink and the
// travelling pin fades into them. A slider: its thumb and counter run to the
// truth in ink; your blue thumb stays, tagged "You".

import type { Pt } from "../layout/model";
import { INK } from "../layout/model";
import { scaleBracketDrop, scaleGeometry, scaleLabelWidth, youTagAt } from "../spec/scale";
import { GUESS_COLOR, YOU_SIZE, youWord } from "./color";
import { pointFor, type GuessHandle } from "./handles";
import { ratioText, signed, signedScale, type GuessMarkLine, type GuessMarkText, type GuessMarks } from "./marks";
import { onSlider, sliderMarks, sliderRevealValue } from "./slider-marks";

/** The colour language. */
export const YOURS = GUESS_COLOR;
export const TRUTH = INK;
export const RIGHT = "#4a7c59";
export const WRONG = "#b3412e";
/** Your answer after the next command. */
export const FADED = 0.35;
/** "each": the truth appears part by part, this far apart. */
export const EACH_MS = 600;
/** One part's reveal. */
export const BESIDE_MS = 800;
/** A scale's reveal: your pin's glide to the truth, then the truth landing. */
export const SCALE_BESIDE_MS = 1500;
/** Of a scale's reveal: your pin glides until GLIDE_END; the truth lands from LAND_START. */
const GLIDE_END = 0.6;
const LAND_START = 0.45;
/** A small "You" (a ghost's), and a ghost's strength. */
const YOU_SMALL = 15;
const GHOST = 0.5;

/** One part's reveal for these handles: longer when a scale's pin travels. */
export function besideDuration(handles: GuessHandle[]): number {
  return handles.some((h) => h.kind === "point" && h.scale && !onSlider(h)) ? SCALE_BESIDE_MS : BESIDE_MS;
}

/** A scale reveal's phases `p` of the way: your pin's glide, the truth's landing (each 0..1, eased). */
function scalePhases(p: number): { glide: number; land: number } {
  const c = (t: number): number => Math.max(0, Math.min(1, t));
  return { glide: ease(c(p / GLIDE_END)), land: ease(c((p - LAND_START) / (1 - LAND_START))) };
}

export type RevealStyle = "beside" | "morph" | "reorder";
export type RevealOrder = "all" | "each";

/** How far along (0..1, linear) part `k` is `elapsed` ms into a reveal of
 *  parts lasting `dur` each: together, or each EACH_MS after the one before. */
export function partProgress(k: number, elapsed: number, dur: number, order: RevealOrder = "all"): number {
  const start = order === "each" ? k * EACH_MS : 0;
  if (dur <= 0) return elapsed >= start ? 1 : 0;
  return Math.max(0, Math.min(1, (elapsed - start) / dur));
}

/** The whole reveal's length for `n` parts. */
export function revealLength(n: number, dur: number, order: RevealOrder = "all"): number {
  return dur + (order === "each" ? Math.max(0, n - 1) * EACH_MS : 0);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => t * t * (3 - 2 * t);

/** The pie pair (template coords and logical): yours on the left, the true
 *  pie on the right, the same size, the pair centred where the one stood and
 *  pulled in so the true pie's names fit on the canvas. */
export interface PiePair {
  /** The pie as drawn before the reveal (logical). */
  from: { c: Pt; r: number };
  yours: { c: Pt; r: number };
  truth: { c: Pt; r: number };
  /** The template's own frame for the true pie: [x, y, r] (template coords). */
  param: [number, number, number];
  /** Where the template's pie stood (template coords). */
  param0: [number, number, number];
}

/** Room the true pie keeps for its names on each side, and the canvas edge. */
const PIE_NAMES = 150;
const PIE_GAP = 10;
const PIE_MAX_R = 165;
const CANVAS_W = 1000;

export function piePair(h: GuessHandle): PiePair | null {
  if (h.kind !== "angle" || !h.centre || h.radius === undefined || !h.pieFrame) return null;
  const tpl = h.pieFrame;
  if (!(tpl.radius > 0)) return null;
  // Logical = s·template + d (the page's fit), read back from the handle.
  const s = h.radius / tpl.radius;
  const d: Pt = [h.centre[0] - tpl.centre[0] * s, h.centre[1] - tpl.centre[1] * s];
  const toL = (p: Pt): Pt => [p[0] * s + d[0], p[1] * s + d[1]];
  const [cx, cy] = tpl.centre;
  // The room the pair has: the pie's own box (a boxed pie stays in it), else the canvas.
  const [x0, x1] = tpl.bounds ?? [0, CANVAS_W];
  // Both pies, the true pie's names on each side of it, a margin left of yours.
  const fit = (x1 - x0 - 2 * PIE_NAMES - 3 * PIE_GAP) / 4;
  const r2 = Math.max(20, Math.min(tpl.radius, PIE_MAX_R, fit));
  const span = 2 * r2 + PIE_NAMES + PIE_GAP; // centre to centre
  let cL = cx - span / 2;
  let cR = cx + span / 2;
  // Pulled in from the edges: the true pie's names on its right, yours alone on the left.
  const over = cR + r2 + PIE_NAMES - (x1 - PIE_GAP);
  if (over > 0) {
    cL -= over;
    cR -= over;
  }
  const under = x0 + PIE_GAP - (cL - r2);
  if (under > 0) {
    cL += under;
    cR += under;
  }
  return {
    from: { c: h.centre, r: h.radius },
    yours: { c: toL([cL, cy]), r: r2 * s },
    truth: { c: toL([cR, cy]), r: r2 * s },
    param: [cR, cy, r2],
    param0: [cx, cy, tpl.radius],
  };
}

/** A guessed pie's shares (0..1) at `values`: the whole pie, or one slice
 *  with the others keeping their proportions in the rest (as patchFor paints it). */
function guessedShares(h: GuessHandle, values: number[]): number[] {
  if (!h.pie) return [];
  if (h.pie.slice === null) return values.map((v) => Math.max(0, v) / 100);
  const s = Math.max(0, Math.min(1, values[0] / 100));
  const t = h.truth[0] / 100;
  const rest = 1 - t > 1e-9 ? (1 - s) / (1 - t) : 0;
  return h.pie.shares.map((sh, j) => (j === h.pie!.slice ? s : sh * rest));
}

/**
 * The template params that make room for yours beside the truth, `prog`
 * (0..1 per handle, eased or not) of the way: bars halved (at once — the true
 * bar grows from zero in its half), the pie moved to the right of the pair.
 */
export function besideParams(handles: GuessHandle[], prog: number[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const bars = handles.filter((h) => h.kind === "height" && h.dx !== undefined).map((h) => h.dx!);
  if (bars.length > 0) out["beside_bars"] = bars;
  handles.forEach((h, k) => {
    if (h.kind !== "angle") return;
    const pair = piePair(h);
    if (!pair) return;
    const e = ease(Math.min(1, (prog[k] ?? 1) / PIE_MOVE));
    out["beside_pie"] = pair.param0.map((v, j) => lerp(v, pair.param[j], e));
  });
  return out;
}

/** Two beside rooms laid over each other (final fix wave E): bars halved in
 *  either stay halved (the union of beside_bars); everything else, the later wins. */
export function mergeRooms(a: Record<string, unknown>, b: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!b) return a;
  const out = { ...a, ...b };
  const ab = a["beside_bars"];
  const bb = b["beside_bars"];
  if (Array.isArray(ab) && Array.isArray(bb)) out["beside_bars"] = [...new Set([...(ab as number[]), ...(bb as number[])])].sort((x, y) => x - y);
  return out;
}

/** A pie's slide to its place takes the first part of its reveal; the rest
 *  is the true shares arriving. */
const PIE_MOVE = 0.5;

/** The numbers the figure is painted from `prog` of the way through the
 *  reveal: a true bar from zero up, a pie from yours to the truth once it
 *  has moved, a line held at yours (the truth is drawn over it), a scale's
 *  pin at the truth (it drops in), a crowd from yours to the truth. */
export function besideValues(handles: GuessHandle[], guess: number[][], prog: number[]): number[][] {
  return handles.map((h, k) => {
    const g = guess[k] ?? h.truth;
    const p = Math.max(0, Math.min(1, prog[k] ?? 1));
    switch (h.kind) {
      case "height": {
        const zero = Math.max(h.min, Math.min(h.max, 0));
        return h.truth.map((v) => lerp(zero, v, ease(p)));
      }
      case "angle": {
        const e = ease(Math.max(0, (p - PIE_MOVE) / (1 - PIE_MOVE)));
        return h.truth.map((v, j) => lerp(g[j] ?? v, v, e));
      }
      case "curve":
        return g.slice();
      case "point":
        // A slider's thumb and counter run from yours to the truth (spec/slider.ts).
        return onSlider(h) ? h.truth.map((v, j) => sliderRevealValue(g[j] ?? v, v, p)) : h.truth.slice();
      default:
        return g.map((v, j) => lerp(v, h.truth[j] ?? v, ease(p)));
    }
  });
}

/** A scale's own pin (the truth) drops this far as it lands. */
const PIN_DROP = 36;

/** Frame offsets while the reveal runs: a scale's own pin (the truth) dropping
 *  in as your pin arrives. */
export function besideOffsets(handles: GuessHandle[], prog: number[]): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  handles.forEach((h, k) => {
    if (h.kind !== "point" || onSlider(h)) return;
    const dy = PIN_DROP * (1 - scalePhases(Math.max(0, Math.min(1, prog[k] ?? 1))).land);
    if (dy <= 0.01) return;
    for (const id of [h.part, `${h.part}_pin`, `${h.part}_num`]) out[id] = [0, dy];
  });
  return out;
}

/** The truth's own elements in ink for a beside reveal, `prog` of the way
 *  (default: done): a scale's answer pin and its number — painted from the
 *  viewer's read-back while asked, blue with a "You" tag (spec/scale.ts) —
 *  the tag gone, the pin fading in as it lands; a slider's thumb and counter. */
export function besideStyles(handles: GuessHandle[], prog?: number[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  handles.forEach((h, k) => {
    if (h.kind !== "point") return;
    const p = Math.max(0, Math.min(1, prog?.[k] ?? 1));
    // A scale's truth fades in over the first part of its landing (a slider's thumb is there all along).
    const a = onSlider(h) ? 1 : Math.max(0, Math.min(1, (p - LAND_START) / 0.25));
    const op = a < 1 ? { opacity: a } : {};
    out[`${h.part}_pin`] = { style: { color: TRUTH, fill: TRUTH, fill_style: "wash", ...op } };
    out[`${h.part}_num`] = { style: { color: TRUTH, ...op } };
    out[`${h.part}_you`] = { text: "" };
  });
  return out;
}

/** A rectangle from (x0, y0) to (x1, y1). */
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];

/** A circle's outline. */
function ring(c: Pt, r: number, steps = 48): Pt[] {
  const out: Pt[] = [];
  for (let s = 0; s < steps; s++) out.push([c[0] + r * Math.sin((s / steps) * 2 * Math.PI), c[1] + r * Math.cos((s / steps) * 2 * Math.PI)]);
  return out;
}

/** Clockwise from 12 o'clock (fraction f of a turn) at radius r. */
const clock = (c: Pt, r: number, f: number): Pt => [c[0] + r * Math.sin(f * 2 * Math.PI), c[1] + r * Math.cos(f * 2 * Math.PI)];

/**
 * What the beside reveal leaves on the figure, `prog` (0..1 per handle) of
 * the way: your answer in blue (at `fade` strength — FADED after the next
 * command), the truth's own marks in ink (a true line, a bracket), the gaps
 * written in ink.
 */
export function besideMarks(handles: GuessHandle[], guess: number[][], prog: number[], fade = 1): GuessMarks {
  const fills: GuessMarkLine[] = [];
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  // A fill fades through its fill-opacity, an outline through its opacity — never both (they multiply).
  const yours = (l: GuessMarkLine): GuessMarkLine => ({ ...l, color: YOURS, ...(l.fill !== undefined ? { fillOpacity: (l.fillOpacity ?? 0.6) * fade } : { opacity: (l.opacity ?? 1) * fade }) });
  handles.forEach((h, k) => {
    const g = guess[k] ?? h.truth;
    const p = Math.max(0, Math.min(1, prog[k] ?? 1));
    switch (h.kind) {
      case "height": {
        const top = pointFor(h, g);
        const truthTop = pointFor(h, h.truth);
        if (!top || !truthTop || h.cx === undefined || h.halfW === undefined || !h.toLogical) break;
        const base = h.toLogical([0, Math.max(h.min, Math.min(h.max, 0))])[1];
        const x0 = h.cx - h.halfW, x1 = h.cx - 1.5;
        if (Math.abs(top[1] - base) > 0.5) {
          fills.push(yours({ pts: rect(x0, base, x1, top[1]), fill: YOURS, fillOpacity: 0.6, stroke: false }));
          lines.push(yours({ pts: rect(x0, base, x1, top[1]), closed: true, width: 2.5 }));
        } else lines.push(yours({ pts: [[x0, base], [x1, base]], width: 3 }));
        // "You" just past your half's end (over it; under a bar hanging below zero).
        const down = top[1] < base - 0.5;
        texts.push({ at: [(x0 + x1) / 2, top[1] + (down ? -14 : 14)], text: youWord(), anchor: "middle", color: YOURS, size: YOU_SMALL, opacity: fade });
        if (p >= 1) {
          const d = h.truth[0] - g[0];
          if (Math.abs(d) > 1e-9) {
            const hi = Math.max(top[1], truthTop[1]);
            const lo = Math.min(top[1], truthTop[1]);
            // Clear of both halves, of the true bar's value label (13 past its end)
            // and of your "You": over the higher top when a bar rises, under the
            // lower end when both hang below zero.
            const y = hi > base + 0.5 ? hi + (truthTop[1] >= top[1] ? 34 : 40) : lo - (truthTop[1] <= top[1] ? 34 : 40);
            texts.push({ at: [h.cx - h.halfW / 2, y], text: signed(h, d), anchor: "middle", color: TRUTH, size: 18, gap: true, ...(fade < 1 ? { opacity: fade } : {}) });
          }
        }
        break;
      }
      case "curve": {
        if (!h.toLogical || !h.xs) break;
        const start: Pt[] = h.given && h.given.length > 0 ? [h.toLogical([h.given[h.given.length - 1].x, h.given[h.given.length - 1].v])] : [];
        const mine: Pt[] = [...start, ...h.xs.map((x, j) => h.toLogical!([x, g[j] ?? h.truth[j]]))];
        const true_: Pt[] = [...start, ...h.xs.map((x, j) => h.toLogical!([x, h.truth[j]]))];
        if (mine.length < 2) break;
        // Drawn left to right: both cut at the same x, `p` of the way along.
        const xA = mine[0][0], xZ = mine[mine.length - 1][0];
        const xCut = lerp(xA, xZ, ease(p));
        const cut = (pts: Pt[]): Pt[] => {
          const out: Pt[] = [pts[0]];
          for (let j = 1; j < pts.length; j++) {
            if (pts[j][0] <= xCut) out.push(pts[j]);
            else {
              const a = pts[j - 1], b = pts[j];
              const f = b[0] - a[0] > 1e-9 ? (xCut - a[0]) / (b[0] - a[0]) : 0;
              if (f > 0) out.push([xCut, lerp(a[1], b[1], f)]);
              break;
            }
          }
          return out;
        };
        const tCut = cut(true_);
        const mCut = cut(mine);
        if (p > 0 && tCut.length >= 2) {
          // The area between the two, shaded light blue.
          fills.push(yours({ pts: [...mCut, ...tCut.slice().reverse()], fill: YOURS, fillOpacity: 0.15, stroke: false }));
        }
        lines.push(yours({ pts: mine, width: 3 }));
        // "You" at your line's right end.
        const end = mine[mine.length - 1];
        texts.push({ at: [end[0] + 8, end[1]], text: youWord(), anchor: "start", color: YOURS, size: YOU_SIZE, opacity: fade });
        if (p > 0 && tCut.length >= 2) lines.push({ pts: tCut, color: TRUTH, width: 3.5 });
        if (p >= 1) {
          let sum = 0;
          let at: Pt | null = null;
          h.xs.forEach((x, j) => {
            const gv = g[j] ?? h.truth[j];
            sum += Math.abs(h.truth[j] - gv);
            const a = h.toLogical!([x, gv]);
            const b = h.toLogical!([x, h.truth[j]]);
            at = [a[0], Math.max(a[1], b[1])];
          });
          if (at) texts.push({ at: [(at as Pt)[0], (at as Pt)[1] + 24], text: `±${h.format(sum / h.xs.length)} avg`, anchor: "middle", color: TRUTH, gap: true, ...(fade < 1 ? { opacity: fade } : {}) });
        }
        break;
      }
      case "angle": {
        const pair = piePair(h);
        if (!pair) break;
        const e = ease(Math.min(1, p / PIE_MOVE));
        const c: Pt = [lerp(pair.from.c[0], pair.yours.c[0], e), lerp(pair.from.c[1], pair.yours.c[1], e)];
        const r = lerp(pair.from.r, pair.yours.r, e);
        // A turned pie (start_angle) starts its first slice there, not at 12 o'clock.
        const st = h.pie?.start ?? 0;
        const shares = guessedShares(h, g);
        const bounds: number[] = [];
        let acc = 0;
        for (const s of shares) bounds.push((acc += s));
        const asked = h.pie?.slice ?? null;
        if (asked !== null) {
          // The asked slice, tinted.
          const a0 = asked > 0 ? bounds[asked - 1] : 0;
          const a1 = bounds[asked] ?? a0;
          const wedge: Pt[] = [c];
          const steps = Math.max(2, Math.ceil((a1 - a0) * 72));
          for (let s = 0; s <= steps; s++) wedge.push(clock(c, r, st + lerp(a0, a1, s / steps)));
          fills.push(yours({ pts: wedge, fill: YOURS, fillOpacity: 0.45, stroke: false }));
        } else fills.push(yours({ pts: ring(c, r), fill: YOURS, fillOpacity: 0.12, stroke: false }));
        lines.push(yours({ pts: ring(c, r), closed: true, width: 2.5 }));
        // A divider where each slice starts (12 o'clock is the first's).
        let at = 0;
        for (const s of shares) {
          lines.push(yours({ pts: [c, clock(c, r, st + at)], width: 2 }));
          at += s;
        }
        if (asked !== null) {
          texts.push({ at: [c[0], c[1] - r - 26], text: `${youWord()}: ${h.format(g[0])}`, anchor: "middle", color: YOURS, opacity: fade });
        } else {
          // "You" under your pie (its numbers are in its slices).
          texts.push({ at: [c[0], c[1] - r - 24], text: youWord(), anchor: "middle", color: YOURS, size: YOU_SIZE, opacity: fade });
          let a0 = 0;
          shares.forEach((s, j) => {
            if (s >= 0.06) texts.push({ at: clock(c, r * 0.62, st + a0 + s / 2), text: h.format(g[j] ?? 0), anchor: "middle", color: YOURS, size: 16, opacity: fade });
            a0 += s;
          });
        }
        break;
      }
      case "point": {
        if (!h.scale) break;
        if (onSlider(h)) {
          const m = sliderMarks(h, g[0], p, { fade });
          fills.push(...m.fills);
          lines.push(...m.lines);
          texts.push(...m.texts);
          break;
        }
        const sg = scaleGeometry(h.scale);
        const x = sg.xAt(g[0]);
        const y = sg.y;
        const xt = sg.xAt(h.truth[0]);
        const { glide, land } = scalePhases(p);
        const pinAt = (px: number): Pt[] => [[px - 10, y + 30], [px + 10, y + 30], [px, y + 6]];
        // Your tag stands on the side away from the truth (trailing your pin as it glides).
        const away: -1 | 1 = xt >= x ? -1 : 1;
        // The ghost where you put it: a faint pin, your number (shrinking to
        // small as your pin leaves), and — once your pin has arrived — a small "You".
        const size = sg.sizes?.answer ?? 28;
        const small = Math.round(size * 0.7);
        const nsize = Math.round(lerp(size, small, glide));
        const mine = sg.format(g[0]);
        const room = (scaleLabelWidth(mine, small) + scaleLabelWidth(sg.format(h.truth[0]), size)) / 2 + 10;
        const apart = Math.abs(xt - x) > 4;
        if (apart && glide > 0) {
          const ghost = pinAt(x);
          fills.push(yours({ pts: ghost, fill: YOURS, fillOpacity: 0.6 * GHOST * glide, stroke: false }));
          lines.push(yours({ pts: ghost, closed: true, width: 2, opacity: GHOST * glide }));
        }
        if (Math.abs(xt - x) > room) texts.push({ at: [x, y + 36 + Math.round(nsize * 0.6)], text: mine, anchor: "middle", color: YOURS, size: nsize, opacity: fade * lerp(1, 0.8, glide) });
        if (apart && land > 0) texts.push({ at: youTagAt(sg, x, away, YOU_SMALL), text: youWord(), anchor: "middle", color: YOURS, size: YOU_SMALL, opacity: fade * 0.8 * land });
        // Your pin, travelling along the line to the truth, fading into the true pin as it lands.
        const xm = lerp(x, xt, glide);
        const strength = 1 - land;
        if (strength > 0.01) {
          const pin = pinAt(xm);
          fills.push(yours({ pts: pin, fill: YOURS, fillOpacity: 0.6 * strength, stroke: false }));
          lines.push(yours({ pts: pin, closed: true, width: 2.5, opacity: strength }));
          texts.push({ at: youTagAt(sg, xm, away), text: youWord(), anchor: "middle", color: YOURS, size: YOU_SIZE, opacity: fade * strength });
        }
        if (p > 0 && apart) {
          // The connector: a bracket under the numbers, guess → truth, grown behind your pin.
          const by = y - scaleBracketDrop(sg);
          lines.push({ pts: [[x, by + 6], [x, by], [xm, by], [xm, by + 6]], color: TRUTH, width: 2.5 });
          if (p >= 1) texts.push({ at: [(x + xm) / 2, by - 16], text: sg.kind === "log" ? ratioText(h.truth[0], g[0]) : signedScale(sg.format, h.truth[0] - g[0]), anchor: "middle", color: TRUTH, gap: true, ...(fade < 1 ? { opacity: fade } : {}) });
        }
        break;
      }
      case "count": {
        if (!h.box) break;
        texts.push({ at: [h.box.x, h.box.y + h.box.h + 22], text: `${youWord()}: ${h.format(g[0])}`, anchor: "start", color: YOURS, opacity: fade });
        break;
      }
      case "market":
        break; // the predict path: guessMarks with { beside } (marks.ts)
    }
  });
  return { color: YOURS, lines: [...fills, ...lines], texts };
}

/** A ✓ or ✗ at `at`, green or red. */
export function tick(at: Pt, right: boolean, anchor: GuessMarkText["anchor"] = "start", size = 24): GuessMarkText {
  return { at, text: right ? "✓" : "✗", anchor, color: right ? RIGHT : WRONG, size };
}

/** A thin arrow from `a` to `b` (its head at b), in `color`. */
export function arrow(a: Pt, b: Pt, color = WRONG, width = 2): GuessMarkLine[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return [];
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const hl = Math.min(12, len / 3);
  const head: Pt[] = [
    [b[0] - ux * hl - uy * hl * 0.55, b[1] - uy * hl + ux * hl * 0.55],
    b,
    [b[0] - ux * hl + uy * hl * 0.55, b[1] - uy * hl - ux * hl * 0.55],
  ];
  return [{ pts: [a, b], color, width }, { pts: head, color, width }];
}

/** Multiply a mark set's strength (the ✓/✗ and ink stay; blue items fade). */
export function fadeYours(m: GuessMarks, fade: number): GuessMarks {
  if (fade >= 1) return m;
  const blue = (c: string | undefined): boolean => (c ?? m.color) === YOURS;
  return {
    ...m,
    // A fill fades through its fill-opacity, an outline through its opacity — never both (they multiply).
    lines: m.lines.map((l) => (blue(l.color) ? (l.fill !== undefined ? { ...l, fillOpacity: (l.fillOpacity ?? 0.6) * fade } : { ...l, opacity: (l.opacity ?? 1) * fade }) : l)),
    texts: m.texts.map((t) => (blue(t.color) || t.gap ? { ...t, opacity: (t.opacity ?? 1) * fade } : t)),
    ...(m.dots ? { dots: m.dots.map((d) => (blue(d.color) ? { ...d, opacity: (d.opacity ?? 1) * fade } : d)) } : {}),
  };
}
