// Marks on picture places (spec §13): one mark per picture — a soft light, a
// hand-drawn ring or box, an arrow or a glow — that travels through the
// places a sentence names and glides from step to step. The planner
// (plan.ts) computes every box; markFrameAt samples a step's motion, and the
// backend (setMark) draws what a frame says.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

export type MarkKind = "light" | "ring" | "box" | "arrow" | "glow";

/** One stop of a mark: its box (canvas, y-up) and when it is reached, as a fraction of the step. */
export interface MarkStop {
  box: BBox;
  at: number;
}

/** One frame of a mark, as the backend draws it (spec §13). */
export interface MarkFrame {
  kind: MarkKind;
  /** The picture's frame (canvas, y-up) — the light washes it. */
  frame: BBox;
  /** Where the mark is now (canvas, y-up). */
  box: BBox;
  /** 0..1 how present (ease-in / release). */
  level: number;
  /** 0..1 how much of a drawn mark (arrow, ring, box) is written. */
  write: number;
  /** Light only: the wash's alpha before level. */
  depth: number;
  /** Glow only: its scale factor. */
  breathe: number;
}

/** What a mark step carries that the curve reads. */
export interface MarkPath {
  mark: MarkKind;
  frame: BBox;
  stops: MarkStop[];
  /** Where the previous step on the same owner left the mark — it glides from here. */
  from?: BBox;
}

/** A first appearance eases (and writes) in over this long. */
export const MARK_IN_MS = 450;
/** A glide from one box to the next. */
export const MARK_GLIDE_MS = 550;
/** A mark that does not continue fades out over this long. */
export const MARK_RELEASE_MS = 280;

const DEPTH_FROM = 0.35;
const DEPTH_TO = 0.62;
const BREATHE_MS = 1600;
const BREATHE_AMP = 0.08;

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
/** Smoothstep: ease-in-out, 0.5 at the midpoint. */
const easeInOut = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const easeOut = (t: number) => {
  const u = clamp01(t);
  return 1 - (1 - u) * (1 - u);
};
const lerpBox = (a: BBox, b: BBox, t: number): BBox =>
  t <= 0 ? a : t >= 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };

/** The mark at `ms` into its step of total `durMs`. Pure. */
export function markFrameAt(step: MarkPath, ms: number, durMs: number): MarkFrame {
  const stops = step.stops;
  const start = (i: number) => (i === 0 ? 0 : Math.max(0, stops[i].at * durMs));
  const end = (i: number) => (i + 1 < stops.length ? start(i + 1) : Math.max(durMs, start(i)));
  // The stop whose glide has begun: the last one at or before `ms`.
  let i = 0;
  while (i + 1 < stops.length && start(i + 1) <= ms) i++;
  const prev = i === 0 ? step.from : stops[i - 1].box;
  let box = stops[i]?.box ?? step.from ?? step.frame;
  if (prev && stops[i]) {
    const glide = Math.min(MARK_GLIDE_MS, end(i) - start(i));
    const t = glide > 0 ? (ms - start(i)) / glide : 1;
    box = lerpBox(prev, stops[i].box, easeInOut(t));
  }
  const entering = step.from ? 1 : easeOut(ms / MARK_IN_MS);
  return {
    kind: step.mark,
    frame: step.frame,
    box,
    level: entering,
    write: step.from ? 1 : clamp01(ms / MARK_IN_MS),
    depth: DEPTH_FROM + (DEPTH_TO - DEPTH_FROM) * (durMs > 0 ? clamp01(ms / durMs) : 1),
    breathe: 1 + BREATHE_AMP * Math.sin((2 * Math.PI * ms) / BREATHE_MS),
  };
}

/** The release at `ms` into it (level falls 1 → 0), at the step's last box. */
export function markReleaseAt(step: MarkPath, ms: number): MarkFrame {
  const last = step.stops[step.stops.length - 1]?.box ?? step.from ?? step.frame;
  return {
    kind: step.mark,
    frame: step.frame,
    box: last,
    level: 1 - easeInOut(ms / MARK_RELEASE_MS),
    write: 1,
    depth: DEPTH_TO,
    breathe: 1,
  };
}

/** The arrow's run from tip to tail (canvas units, y-up) — the drawn arrow's own shape. */
export const ARROW_RUN: Pt = [70, 55];
/** How far outside the box the tip stops. */
const ARROW_GAP = 4;

/**
 * Where an arrow's tip and tail go for a target box: tip just outside the box
 * (the side facing the tail, at the box's middle height), tail 70 across and
 * 55 up or down toward the side of the frame with more room — up and right
 * unless the other side has more.
 */
export function arrowGeometry(box: BBox, frame: BBox): { tip: Pt; tail: Pt } {
  const right = frame.x + frame.w - (box.x + box.w) >= box.x - frame.x ? 1 : -1;
  const up = frame.y + frame.h - (box.y + box.h) >= box.y - frame.y ? 1 : -1;
  const tip: Pt = [right > 0 ? box.x + box.w + ARROW_GAP : box.x - ARROW_GAP, box.y + box.h / 2];
  return { tip, tail: [tip[0] + right * ARROW_RUN[0], tip[1] + up * ARROW_RUN[1]] };
}
