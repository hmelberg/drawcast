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
import { leafDrawables, SUB_SUFFIXES, type Drawable, type Pt } from "../layout/model";
import { mapDrawable, poseMapOf } from "../layout/posed";
import type { BBox } from "../layout/geometry";
import type { MeasureFn } from "../layout/measure";
import type { Turn } from "../render/pose";

/** The rules whose verdict depends on where an element stands. */
const PLACED = new Set<LintIssue["rule"]>(["out-of-canvas", "overlap-label-label", "overlap-label-stroke", "overlap-math-stroke", "overlap-math-label"]);

export interface Poses {
  offsets: Record<string, Pt>;
  turns?: Record<string, Turn>;
  /** Morphed ORIGINAL-frame leaf points (plan.states[i].shapes): element id → leaf id → points. */
  shapes?: Record<string, Record<string, Pt[]>>;
}

/**
 * The layout's issues (`base`, from layoutSpec over `drawables`) as they
 * stand at `poses`: a placement issue between two elements posed differently
 * (or one posed element off the canvas) is dropped and judged again with
 * the posed drawables; the rest are kept as the layout gave them. Pairs
 * posed alike keep the layout's verdict, its composition exemptions too.
 */
export function posedIssues(drawables: Drawable[], measure: MeasureFn, poses: Poses, base: LintIssue[], bounds?: BBox, sameGroup?: (a: string, b: string) => boolean): LintIssue[] {
  const r = rejudged(drawables, measure, poses, bounds, sameGroup);
  if (!r) return base;
  return [...base.filter((i) => !r.changed(i)), ...r.issues];
}

/**
 * Only the judging-again half of posedIssues: the placement issues among
 * the pairs `poses` moved relative to each other (and posed elements off
 * the canvas), at their real places — null when nothing is posed. `changed`
 * says whether a base issue is one of those pairs (its verdict superseded).
 * `sameGroup` is the layout's composition exemption (layout.ts
 * composedPairs), so a scratch card or an annotation stays excused.
 */
export function rejudged(
  drawables: Drawable[],
  measure: MeasureFn,
  poses: Poses,
  bounds?: BBox,
  sameGroup?: (a: string, b: string) => boolean,
): { issues: LintIssue[]; changed: (i: LintIssue) => boolean } | null {
  // A sub-drawable (`xb1_text`, a box's words) is posed with its element:
  // the player moves every drawable of an id (model.ts drawablesForId).
  const poseId = (id: string): string => {
    if (id in poses.offsets || (poses.turns && id in poses.turns) || (poses.shapes && id in poses.shapes)) return id;
    for (const s of SUB_SUFFIXES) {
      const base = id.endsWith(`_${s}`) ? id.slice(0, -s.length - 1) : "";
      if (base && (base in poses.offsets || (poses.turns && base in poses.turns) || (poses.shapes && base in poses.shapes))) return base;
    }
    return id;
  };
  const keyOf = (raw: string): string => {
    const id = poseId(raw);
    const o = poses.offsets[id], t = poses.turns?.[id], sh = poses.shapes?.[id];
    const moved = o !== undefined && (o[0] !== 0 || o[1] !== 0);
    const morphed = sh !== undefined && Object.keys(sh).length > 0;
    // A morphed element is its own pose: nothing else shares its new outline.
    return moved || t !== undefined || morphed ? JSON.stringify([o ?? [0, 0], t ?? null, morphed ? id : null]) : "";
  };
  const posed = drawables.filter((d) => keyOf(d.id) !== "");
  if (posed.length === 0) return null;
  // An issue names leaves (`same_text`); a pose belongs to the top-level element.
  const owner = new Map<string, string>();
  for (const top of drawables) {
    owner.set(top.id, top.id);
    for (const leaf of leafDrawables([top])) owner.set(leaf.id, top.id);
  }
  const key = (id: string): string => keyOf(owner.get(id) ?? id);
  const changed = (i: LintIssue): boolean => PLACED.has(i.rule) && (i.ids.length === 1 ? key(i.ids[0]) !== "" : new Set(i.ids.map(key)).size > 1);
  const moved = drawables.map((d) => {
    if (keyOf(d.id) === "") return d;
    const id = poseId(d.id);
    const o = poses.offsets[id], t = poses.turns?.[id];
    const { map, scale } = poseMapOf({ offset: o ?? [0, 0], turn: t });
    return mapDrawable(d, map, scale, poses.shapes?.[id]);
  });
  // No commands: which of these are on screen together is the caller's to
  // judge at this boundary (the frames harness filters by visibility).
  return { issues: lintLayout(moved, measure, undefined, undefined, sameGroup, bounds).filter(changed), changed };
}
