// motion_graphs' model: one-dimensional motion as a run of constant-
// acceleration pieces, and everything the three graphs read off it —
// position, velocity and acceleration at any time, the displacement and the
// distance up to a time, the ranges each panel is drawn over, and where every
// panel sits on the page. Pure: the layout draws from it, the widget body
// measures against it, the lint checks what it cannot resolve.
//
// Two ways to give the motion:
//   constant acceleration   {x0, v0, a, duration}
//   pieces                  {x0, v0, segments: [{duration, a | v1, v0?}]}
// Position is always continuous (each piece starts where the last ended).
// Velocity is continuous too, unless a later piece gives its own v0 — an
// instant change of speed (a bounce, a collision).
import { niceUp } from "../params-ui/params";

export type PanelKey = "x" | "v" | "a";
export const PANEL_KEYS: PanelKey[] = ["x", "v", "a"];

export interface SegmentSpec {
  duration: number;
  a?: number;
  /** The velocity at the piece's end; `a` follows from it (a wins when both are given). */
  v1?: number;
  /** An instant change of velocity at the piece's start (a later piece), or the start velocity (the first). */
  v0?: number;
  /** Where the piece starts — only checked (position is continuous); the lint reports a mismatch. */
  x0?: number;
  /** A word or three naming the phase ("speeding up"), written above it. */
  label?: string;
}

export interface MotionParams {
  x0?: number;
  v0?: number;
  a?: number;
  duration?: number;
  segments?: SegmentSpec[];
  panels?: string[];
  t?: number;
  cursor?: boolean;
  track?: boolean;
  shade?: "none" | "to_cursor" | "all" | boolean;
  tangents?: boolean;
  readout?: boolean;
  numbers?: boolean | string[];
  units?: { x?: string; t?: string };
  labels?: { x?: string; v?: string; a?: string; t?: string; object?: string };
  x_range?: [number, number];
  v_range?: [number, number];
  a_range?: [number, number];
  title?: string;
}

/** One resolved piece: its time span, and its state at the start. */
export interface Segment {
  index: number;
  t0: number;
  t1: number;
  d: number;
  x0: number;
  v0: number;
  a: number;
  /** Velocity at the end (v0 + a·d). */
  v1: number;
  /** x at the end. */
  x1: number;
  /** A later piece whose start velocity the author set: a jump may sit there. */
  explicitV0: boolean;
  label?: string;
}

export interface Motion {
  segs: Segment[];
  /** Total duration. */
  T: number;
  x0: number;
  /** The pieces were given as `segments` (not the constant-acceleration form). */
  piecewise: boolean;
}

export const MAX_SEGMENTS = 8;
export const DEFAULT_DURATION = 5;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The motion the params describe. Pieces past MAX_SEGMENTS and pieces with no
 *  positive duration are left out (the lint says so). */
export function resolveMotion(P: MotionParams): Motion {
  const piecewise = Array.isArray(P.segments) && P.segments.length > 0;
  const x0 = num(P.x0) ? P.x0 : piecewise && num(P.segments![0]?.x0) ? P.segments![0].x0! : 0;
  const specs: SegmentSpec[] = piecewise ? P.segments!.slice(0, MAX_SEGMENTS) : [{ duration: num(P.duration) && P.duration > 0 ? P.duration : DEFAULT_DURATION, a: P.a, v0: P.v0 }];
  const segs: Segment[] = [];
  let t = 0;
  let x = x0;
  let v = num(P.v0) ? P.v0 : 0;
  if (piecewise && num(P.segments![0]?.v0)) v = P.segments![0].v0!;
  specs.forEach((s, i) => {
    if (!s || typeof s !== "object" || !num(s.duration) || s.duration <= 0) return;
    const d = s.duration;
    const first = segs.length === 0;
    const explicitV0 = num(s.v0) && (!first || piecewise);
    const v0 = num(s.v0) ? s.v0 : v;
    const a = num(s.a) ? s.a : num(s.v1) ? (s.v1 - v0) / d : 0;
    const v1 = v0 + a * d;
    const x1 = x + v0 * d + 0.5 * a * d * d;
    segs.push({ index: i, t0: t, t1: t + d, d, x0: x, v0, a, v1, x1, explicitV0: explicitV0 && !first, ...(typeof s.label === "string" && s.label.trim() ? { label: s.label } : {}) });
    t += d;
    x = x1;
    v = v1;
  });
  if (segs.length === 0) segs.push({ index: 0, t0: 0, t1: DEFAULT_DURATION, d: DEFAULT_DURATION, x0, v0: v, a: 0, v1: v, x1: x0 + v * DEFAULT_DURATION, explicitV0: false });
  return { segs, T: segs[segs.length - 1].t1, x0, piecewise };
}

/** The piece that holds time t (the last one at the very end). */
export function segmentAt(m: Motion, t: number): Segment {
  for (const s of m.segs) if (t < s.t1) return s;
  return m.segs[m.segs.length - 1];
}

export const clampT = (m: Motion, t: number): number => Math.min(m.T, Math.max(0, num(t) ? t : 0));

export function stateAt(m: Motion, tRaw: number): { t: number; x: number; v: number; a: number } {
  const t = clampT(m, tRaw);
  const s = segmentAt(m, t);
  const dt = t - s.t0;
  return { t, x: s.x0 + s.v0 * dt + 0.5 * s.a * dt * dt, v: s.v0 + s.a * dt, a: s.a };
}

/** ∫|v| over [0, dt] of one piece. */
function pieceDistance(v0: number, a: number, dt: number): number {
  const lin = (u: number): number => v0 * u + 0.5 * a * u * u;
  if (Math.abs(a) > 1e-12) {
    const r = -v0 / a;
    if (r > 0 && r < dt) return Math.abs(lin(r)) + Math.abs(lin(dt) - lin(r));
  }
  return Math.abs(lin(dt));
}

/** Displacement (x(t) − x0) and distance travelled (∫|v|) from 0 to t. */
export function travelTo(m: Motion, tRaw: number): { displacement: number; distance: number } {
  const t = clampT(m, tRaw);
  let distance = 0;
  for (const s of m.segs) {
    if (t <= s.t0) break;
    distance += pieceDistance(s.v0, s.a, Math.min(t, s.t1) - s.t0);
  }
  return { displacement: stateAt(m, t).x - m.x0, distance };
}

/** x(t) sampled finely enough to draw (and to measure a range). */
export function sampleX(m: Motion, perSeg = 32): [number, number][] {
  const out: [number, number][] = [];
  for (const s of m.segs) {
    const n = Math.abs(s.a) < 1e-12 ? 1 : perSeg;
    for (let k = out.length === 0 ? 0 : 1; k <= n; k++) {
      const dt = (s.d * k) / n;
      out.push([s.t0 + dt, s.x0 + s.v0 * dt + 0.5 * s.a * dt * dt]);
    }
  }
  return out;
}

export type Range = [number, number];

/** A range over [lo, hi] snapped out to round ticks (about `target` of them); a
 *  flat one is opened to a unit about its value; 0 is taken in when it is near. */
export function niceRange(lo: number, hi: number, target = 3, withZero = false): Range {
  if (withZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < 1e-9) {
    const m = Math.max(1, Math.abs(hi));
    lo -= m * 0.5;
    hi += m * 0.5;
    if (withZero && Math.abs(lo) < 1e-9) lo = 0;
  }
  if (!withZero && lo > 0 && lo <= (hi - lo) * 0.5) lo = 0;
  const step = niceUp((hi - lo) / target);
  return [Number((Math.floor(lo / step + 1e-9) * step).toFixed(10)), Number((Math.ceil(hi / step - 1e-9) * step).toFixed(10))];
}

/** Round ticks inside a range. */
export function ticksIn([lo, hi]: Range, target: number): { step: number; ticks: number[] } {
  const step = niceUp((hi - lo) / target);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { step, ticks };
}

const validRange = (r: unknown): r is Range => Array.isArray(r) && r.length === 2 && num(r[0]) && num(r[1]) && r[1] > r[0];

/** What each panel's values span, before rounding. */
export function extents(m: Motion): Record<PanelKey, Range> {
  const xs = sampleX(m).map((p) => p[1]);
  const vs = m.segs.flatMap((s) => [s.v0, s.v1]);
  const as = m.segs.map((s) => s.a);
  return {
    x: [Math.min(...xs), Math.max(...xs)],
    v: [Math.min(...vs), Math.max(...vs)],
    a: [Math.min(...as), Math.max(...as)],
  };
}

/** The ranges the panels are drawn over: the author's, else round ranges that
 *  hold the motion (v and a always reach 0: their zero line is the t axis). */
export function rangesOf(m: Motion, P: MotionParams): Record<PanelKey, Range> {
  const e = extents(m);
  return {
    x: validRange(P.x_range) ? [P.x_range[0], P.x_range[1]] : niceRange(e.x[0], e.x[1], 3),
    v: validRange(P.v_range) ? [P.v_range[0], P.v_range[1]] : niceRange(e.v[0], e.v[1], 3, true),
    a: validRange(P.a_range) ? [P.a_range[0], P.a_range[1]] : niceRange(e.a[0], e.a[1], 2, true),
  };
}

/** The panels drawn, in their fixed top-to-bottom order x, v, a. */
export function panelsOf(P: MotionParams): PanelKey[] {
  const want = Array.isArray(P.panels) ? P.panels.filter((k): k is PanelKey => (PANEL_KEYS as string[]).includes(k)) : [];
  return want.length > 0 ? PANEL_KEYS.filter((k) => want.includes(k)) : PANEL_KEYS.slice();
}

export type NumberKey = "x0" | "v0" | "a";

/** The numbers written in the header line (scrubbable, tappable). */
export function numbersOf(P: MotionParams, m: Motion): NumberKey[] {
  const allowed: NumberKey[] = m.piecewise ? ["x0", "v0"] : ["x0", "v0", "a"];
  if (Array.isArray(P.numbers)) return allowed.filter((k) => (P.numbers as string[]).includes(k));
  if (P.numbers === true) return m.piecewise ? ["v0"] : ["v0", "a"];
  if (P.numbers === false) return [];
  return m.piecewise ? [] : ["v0", "a"];
}

export const shadeOf = (P: MotionParams): "none" | "to_cursor" | "all" => (P.shade === true ? "to_cursor" : P.shade === "to_cursor" || P.shade === "all" ? P.shade : "none");

// ---- the page ---------------------------------------------------------------

export interface PanelBox {
  key: PanelKey;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  range: Range;
}

export interface Geometry {
  motion: Motion;
  ranges: Record<PanelKey, Range>;
  panels: PanelBox[];
  /** The time axis: t ↔ logical x. */
  sx: (t: number) => number;
  tAt: (X: number) => number;
  /** A panel's value ↔ logical y. */
  sy: (k: PanelKey, v: number) => number;
  valueAt: (k: PanelKey, Y: number) => number;
  /** Logical units per unit of a panel's value. */
  scale: (k: PanelKey) => number;
  plotX0: number;
  plotX1: number;
  titleY: number | null;
  numbersY: number | null;
  /** The track's line y, and its position ↔ logical x. */
  track: { y: number; sx: (x: number) => number; labelY: number | null } | null;
  phaseY: number | null;
  /** The bottom panel's lower edge (time tick numbers go under it). */
  bottom: number;
  top: number;
}

export const PLOT_X0 = 150;
export const PLOT_X1 = 815;
export const PANEL_GAP = 30;
export const BOTTOM = 92;
export const HEADING_TOP = 662;

export function geometry(P: MotionParams): Geometry {
  const motion = resolveMotion(P);
  const ranges = rangesOf(motion, P);
  const keys = panelsOf(P);
  // The strip above HEADING_TOP is the heading's: a cast's opening `card`
  // (the house default) or the template's own `title` — never the figure's.
  const titleY = typeof P.title === "string" && P.title.trim() ? 724 : null;
  let top = HEADING_TOP;
  const numbersY = numbersOf(P, motion).length > 0 ? top - 16 : null;
  if (numbersY !== null) top -= 40;
  let track: Geometry["track"] = null;
  if (P.track !== false) {
    const hasLabel = typeof P.labels?.object === "string" && P.labels.object.trim() !== "";
    const y = top - (hasLabel ? 60 : 34);
    const [lo, hi] = ranges.x;
    const sxx = (x: number): number => PLOT_X0 + ((x - lo) / (hi - lo)) * (PLOT_X1 - PLOT_X0);
    track = { y, sx: sxx, labelY: hasLabel ? y + 46 : null };
    top = y - 40;
  }
  const phaseY = motion.segs.some((s) => s.label) ? top - 12 : null;
  if (phaseY !== null) top -= 30;
  const y1Top = top - 8;
  const n = keys.length;
  const h = (y1Top - BOTTOM - PANEL_GAP * (n - 1)) / n;
  const panels: PanelBox[] = keys.map((key, i) => {
    const y1 = y1Top - i * (h + PANEL_GAP);
    return { key, x0: PLOT_X0, x1: PLOT_X1, y0: y1 - h, y1, range: ranges[key] };
  });
  const byKey = new Map(panels.map((p) => [p.key, p]));
  const T = motion.T;
  const sx = (t: number): number => PLOT_X0 + (t / T) * (PLOT_X1 - PLOT_X0);
  const tAt = (X: number): number => ((X - PLOT_X0) / (PLOT_X1 - PLOT_X0)) * T;
  const box = (k: PanelKey): PanelBox => byKey.get(k) ?? { key: k, x0: PLOT_X0, x1: PLOT_X1, y0: 0, y1: 1, range: ranges[k] };
  const scale = (k: PanelKey): number => {
    const b = box(k);
    return (b.y1 - b.y0) / (b.range[1] - b.range[0]);
  };
  const sy = (k: PanelKey, v: number): number => box(k).y0 + (v - box(k).range[0]) * scale(k);
  const valueAt = (k: PanelKey, Y: number): number => box(k).range[0] + (Y - box(k).y0) / scale(k);
  return { motion, ranges, panels, sx, tAt, sy, valueAt, scale, plotX0: PLOT_X0, plotX1: PLOT_X1, titleY, numbersY, track, phaseY, bottom: panels[panels.length - 1].y0, top: panels[0].y1 };
}

/** The panel whose chart frame `{data: [t, value]}` and the widget read: v when drawn, else the first. */
export function framePanel(g: Geometry): PanelBox {
  return g.panels.find((p) => p.key === "v") ?? g.panels[0];
}
