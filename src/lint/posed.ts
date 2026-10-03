// The placement lints at one boundary's poses (spec 2026-10-04 §6: lints
// judge what the viewer sees, after moves). The layout lints the figure where
// the spec drew it; a `move` (or an `arrange`, or a label following its
// target) puts an element somewhere else, and an overlap at the old spot is
// not on screen any more — a glass slid aside left its labels "on" the glass's
// first place. Given the poses a boundary stands at (plan.states[i].offsets
// and turns), this keeps the layout's verdict on every pair whose relative
// placement is unchanged and judges every pair the poses moved apart (or
// together) again, at their real places. Pure: the frames harness calls it
// per frame (src/dev/frames.ts).

import { lintLayout, type LintIssue } from "./lint";
import { leafDrawables, type Drawable, type Pt } from "../layout/model";
import { mapDrawable, poseMapOf } from "../layout/posed";
import type { BBox } from "../layout/geometry";
import type { MeasureFn } from "../layout/measure";
import type { Turn } from "../render/pose";

/** The rules whose verdict depends on where an element stands. */
const PLACED = new Set<LintIssue["rule"]>(["out-of-canvas", "overlap-label-label", "overlap-label-stroke", "overlap-math-stroke", "overlap-math-label"]);

export interface Poses {
  offsets: Record<string, Pt>;
  turns?: Record<string, Turn>;
}

/**
 * The layout's issues (`base`, from layoutSpec over `drawables`) as they
 * stand at `poses`: a placement issue between two elements posed differently
 * (or one posed element off the canvas) is dropped and judged again with
 * the posed drawables; the rest are kept as the layout gave them. Pairs
 * posed alike keep the layout's verdict, its composition exemptions too.
 */
export function posedIssues(drawables: Drawable[], measure: MeasureFn, poses: Poses, base: LintIssue[], bounds?: BBox): LintIssue[] {
  const keyOf = (id: string): string => {
    const o = poses.offsets[id], t = poses.turns?.[id];
    const moved = o !== undefined && (o[0] !== 0 || o[1] !== 0);
    return moved || t !== undefined ? JSON.stringify([o ?? [0, 0], t ?? null]) : "";
  };
  const posed = drawables.filter((d) => keyOf(d.id) !== "");
  if (posed.length === 0) return base;
  // An issue names leaves (`same_text`); a pose belongs to the top-level element.
  const owner = new Map<string, string>();
  for (const top of drawables) {
    owner.set(top.id, top.id);
    for (const leaf of leafDrawables([top])) owner.set(leaf.id, top.id);
  }
  const key = (id: string): string => keyOf(owner.get(id) ?? id);
  const changed = (i: LintIssue): boolean => PLACED.has(i.rule) && (i.ids.length === 1 ? key(i.ids[0]) !== "" : new Set(i.ids.map(key)).size > 1);
  const moved = drawables.map((d) => {
    const o = poses.offsets[d.id], t = poses.turns?.[d.id];
    if (keyOf(d.id) === "") return d;
    const { map, scale } = poseMapOf({ offset: o ?? [0, 0], turn: t });
    return mapDrawable(d, map, scale);
  });
  // No commands: which of these are on screen together is the caller's to
  // judge at this boundary (the frames harness filters by visibility).
  const again = lintLayout(moved, measure, undefined, undefined, undefined, bounds).filter(changed);
  return [...base.filter((i) => !changed(i)), ...again];
}
