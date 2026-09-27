// A template draws its own parts — the readout card, the S and D labels, a
// branch's caption — from code, so they are not spec elements and nothing in
// the spec could move or enlarge them. The look pass kept seeing "the readout
// is tiny, move it into the empty corner" and the fix round had no field to
// say it with (prompt lab, 2026-09-27). `spec.adjust` is that field: a nudge
// and a size factor per part id, applied after the template has laid itself
// out and BEFORE the label solver runs, so everything placed afterwards
// (labels, annotations) avoids the part where it now is.

import type { Spec } from "../spec/types";
import { unionBBoxForId, unionBoxes } from "./boxes";
import { CANVAS } from "./canvas";
import type { LabelRequest } from "./labels";
import type { MeasureFn } from "./measure";
import { drawablesForId, type Drawable } from "./model";
import { scaleDrawables, shiftDrawables } from "./place";

export type PartAdjust = NonNullable<Spec["adjust"]>[string];

/** A factor outside this range is a typo, not a design: 3× a card fills the page, ⅓ makes it unreadable. */
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.5;

/** The ids an adjust key reaches: itself, or a group's members, recursively (the template's `groups`). */
function expand(id: string, groups: Record<string, string[]>, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const members = groups[id];
  if (!members) return [id];
  return [id, ...members.flatMap((m) => expand(m, groups, seen))];
}

/**
 * Apply `adjust` in place. `move` is [right, up] in percent of the page
 * (100 = the full width or height); `scale` grows the part about its own
 * center (text grows with it). Returns the keys that matched nothing, for a
 * warning — a misspelt id should say so, not silently do nothing.
 */
export function applyAdjust(
  drawables: Drawable[],
  labels: LabelRequest[],
  adjust: NonNullable<Spec["adjust"]>,
  groups: Record<string, string[]>,
  measure: MeasureFn,
): string[] {
  const unknown: string[] = [];
  for (const [key, a] of Object.entries(adjust)) {
    const ids = expand(key, groups);
    const ds = [...new Set(ids.flatMap((id) => drawablesForId(drawables, id)))];
    const ls = labels.filter((l) => ids.includes(l.id));
    if (ds.length === 0 && ls.length === 0) {
      unknown.push(key);
      continue;
    }
    const s = typeof a.scale === "number" && Number.isFinite(a.scale) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, a.scale)) : 1;
    if (s !== 1) {
      const box = unionBoxes(ids.map((id) => unionBBoxForId(drawables, id, measure)));
      if (box) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        scaleDrawables(ds, s, cx * (1 - s), cy * (1 - s));
      }
      for (const l of ls) l.fontSize *= s;
    }
    const [mx, my] = Array.isArray(a.move) ? a.move : [0, 0];
    const dx = Number.isFinite(mx) ? (mx / 100) * CANVAS.w : 0;
    const dy = Number.isFinite(my) ? (my / 100) * CANVAS.h : 0;
    if (dx !== 0 || dy !== 0) {
      shiftDrawables(ds, dx, dy);
      for (const l of ls) l.anchor = [l.anchor[0] + dx, l.anchor[1] + dy];
    }
  }
  return unknown;
}
