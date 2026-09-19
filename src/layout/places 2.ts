// A named spot on the CANVAS (spec 2026-09-19-script-dsl §7). `at: {place}`
// lands the element's OWN same-named anchor on that anchor of the safe area:
// `left` seats its left edge at the left margin, `center` centres it, a
// corner tucks into that corner. Because both ends of the rule are the SAME
// anchor, the element stays on the canvas whatever its size — which is what
// makes a place safe to write without knowing how big the thing will come out.
import { boxAnchor, type UniversalAnchor } from "./anchors";
import { CANVAS } from "./canvas";
import type { BBox } from "./geometry";
import type { Pt } from "./model";

/** How far the safe area sits inside the canvas, logical units. */
export const PLACE_MARGIN = 40;

type CanvasSize = { w: number; h: number };

/** The canvas inset by PLACE_MARGIN — what a place name refers to. */
export function safeArea(canvas: CanvasSize = CANVAS): BBox {
  return { x: PLACE_MARGIN, y: PLACE_MARGIN, w: canvas.w - 2 * PLACE_MARGIN, h: canvas.h - 2 * PLACE_MARGIN };
}

/** dx, dy that puts `own`'s `ownAnchor` (default: the place's own name) on `place`. */
export function placeDelta(own: BBox, place: UniversalAnchor, ownAnchor?: string, canvas: CanvasSize = CANVAS): Pt {
  const target = boxAnchor(safeArea(canvas), place);
  const from = boxAnchor(own, ownAnchor ?? place);
  return [target[0] - from[0], target[1] - from[1]];
}

/**
 * Where n positionless elements go: evenly spaced slot centres across the
 * safe area, at mid height. One slot is the canvas centre, which is where a
 * lone free element has always landed — so a figure only changes when it was
 * piling elements on top of each other.
 */
export function autoRow(n: number, canvas: CanvasSize = CANVAS): Pt[] {
  const area = safeArea(canvas);
  return Array.from({ length: n }, (_, i) => [area.x + (area.w * (i + 0.5)) / n, canvas.h / 2] as Pt);
}
