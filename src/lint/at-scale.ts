// The layout as the viewer sees it, for the lint passes (spec 2026-10-04 §6:
// lints judge what the viewer sees, at the cast's text scale). The player
// lays a cast out with a measure scaled by text.font_size / 26 and then
// scales every text drawable by the same factor (render/index.ts,
// layout/text-style.ts); a lint that laid the cast out at scale 1 judged
// overlaps, crowding and small print on text smaller (or larger) than the
// text on screen. `check`, the frames harness, generation's lint and the
// playlist check lay out through here instead.

import { layoutSpec, type LayoutResult } from "../layout/layout";
import type { LayoutOverrides } from "../layout/posed";
import type { LabelPin } from "../layout/labels";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import { applyTextStyle, effectiveTextStyle, scaledMeasure } from "../layout/text-style";
import type { Spec } from "../spec/types";
import { lintFontSizes } from "./lint";

/**
 * layoutSpec at the spec's own text scale: measured scaled, its text
 * drawables scaled to the drawn size (so crowding and font-too-small read
 * what is drawn), font-too-small judged again at those sizes. The drawables
 * carry drawn sizes: measure them with the UNscaled `measure`. Scale 1 is
 * layoutSpec exactly.
 */
export function layoutAsSeen(
  spec: Spec,
  measure: MeasureFn = heuristicMeasure,
  overrides?: LayoutOverrides,
  labelPins?: Record<string, LabelPin>,
  opts?: { skipDrawBeatLint?: boolean },
): LayoutResult {
  const style = effectiveTextStyle(spec);
  if (style.scale === 1) return layoutSpec(spec, measure, overrides, labelPins, opts);
  const drawn = applyTextStyle(layoutSpec(spec, scaledMeasure(measure, style.scale), overrides, labelPins, opts), style);
  return { ...drawn, issues: [...drawn.issues.filter((i) => i.rule !== "font-too-small"), ...lintFontSizes(drawn.drawables)] };
}
