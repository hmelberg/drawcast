// Measure geometry (design §2.3): what a measure element reads off a
// figure, and how it is written. Pure — tier-2 lays the element out with
// it, and the planner recomputes with it after every step that moves or
// morphs what it measures.
import { heuristicMeasure } from "./measure";
import type { Pt } from "./model";

export type MeasureWhat = "length" | "width" | "height" | "area" | "perimeter";
export interface MeasureFormat { label: string; unit?: string; scale: number; decimals?: number }
export type PointSource = { ref: string; anchor: string } | { pt: Pt };
export interface MeasureSpec {
  of?: string;
  what: MeasureWhat;
  from?: PointSource;
  to?: PointSource;
  side: "left" | "right";
  offset: number;
  format: MeasureFormat;
  lineId: string;
  textId: string;
  /** Set when `of` resolved to a circle (a shape or node drawn with a circle
   *  shapeHint, which carries no literal ring points) — so a future step can
   *  recompute it under a pose (centre through the pose, radius × scale). */
  circle?: { c: Pt; r: number };
}

export function segmentLength(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** |shoelace| / 2 — orientation-free, so a mirrored ring measures the same. */
export function ringArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function ringPerimeter(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += segmentLength(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export function ringCentroid(pts: Pt[]): Pt {
  const n = Math.max(1, pts.length);
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

export function boxSize(pts: Pt[]): { w: number; h: number } {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function measureValue(what: MeasureWhat, g: { a?: Pt; b?: Pt; ring?: Pt[]; circle?: { c: Pt; r: number } }): number | null {
  if (what === "length") return g.a && g.b ? segmentLength(g.a, g.b) : g.ring && g.ring.length >= 2 ? segmentLength(g.ring[0], g.ring[g.ring.length - 1]) : null;
  if (g.circle) {
    if (what === "width" || what === "height") return 2 * g.circle.r;
    if (what === "perimeter") return 2 * Math.PI * g.circle.r;
    return Math.PI * g.circle.r * g.circle.r; // area
  }
  if (!g.ring || g.ring.length < 2) return null;
  if (what === "width") return boxSize(g.ring).w;
  if (what === "height") return boxSize(g.ring).h;
  if (what === "perimeter") return ringPerimeter(g.ring);
  return g.ring.length >= 3 ? ringArea(g.ring) : null;
}

export function formatMeasure(value: number, f: MeasureFormat): string {
  const v = value / (f.scale || 1);
  const decimals = f.decimals ?? (Math.abs(v) >= 100 ? 0 : 1);
  const text = f.label.includes("{value}") ? f.label.replace("{value}", v.toFixed(decimals)) : `${f.label}${v.toFixed(decimals)}`;
  return f.unit ? `${text} ${f.unit}` : text;
}

/** The font size every measure label is drawn at — tier-2 draws the text with
 *  it, and both tier-2 and the planner's recompute estimate the label's width
 *  at it to place the text clear of the dimension line. */
export const MEASURE_FONT_SIZE = 24;

/** The label width tier-2 and the planner both feed to `dimensionLine`: the
 *  deterministic node-side heuristic at the measure font size, never the
 *  browser's canvas measurer — so a label that follows a move lands exactly
 *  where a fresh layout would have put it, in either backend. */
export function heuristicLabelWidth(text: string): number {
  return heuristicMeasure(text, MEASURE_FONT_SIZE).w;
}

/**
 * The dimension line for a → b, offset to its `side` (left = the left-hand
 * normal of a → b), with end ticks and the text spot further out along that
 * same normal (nx, ny).
 *
 * The clearance is `16 + |nx| · textWidth / 2`: the text is centred on the
 * spot, so on a vertical or oblique measure (nx ≠ 0) half a wide label would
 * otherwise reach back across the line it belongs to — "r = 113" at font 24 is
 * ~87 units wide, i.e. ~44 each side of centre, far past a fixed 16. A
 * horizontal measure has nx = 0 and is unchanged (its label sits above or
 * below the line, and its width points along it). Pass `textWidth` as
 * `heuristicMeasure(text, MEASURE_FONT_SIZE).w` — omit it (0) only when no
 * text is drawn.
 */
export function dimensionLine(a: Pt, b: Pt, offset: number, side: "left" | "right", tick = 12, textWidth = 0): { line: [Pt, Pt]; ticks: [Pt, Pt][]; textPos: Pt } {
  const len = segmentLength(a, b) || 1;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const sgn = side === "left" ? 1 : -1;
  const nx = -uy * sgn, ny = ux * sgn;
  const A: Pt = [a[0] + nx * offset, a[1] + ny * offset];
  const B: Pt = [b[0] + nx * offset, b[1] + ny * offset];
  const t = tick / 2;
  const ticks: [Pt, Pt][] = [
    [[A[0] - nx * t, A[1] - ny * t], [A[0] + nx * t, A[1] + ny * t]],
    [[B[0] - nx * t, B[1] - ny * t], [B[0] + nx * t, B[1] + ny * t]],
  ];
  const clear = 16 + (Math.abs(nx) * textWidth) / 2;
  const textPos: Pt = [(A[0] + B[0]) / 2 + nx * clear, (A[1] + B[1]) / 2 + ny * clear];
  return { line: [A, B], ticks, textPos };
}
