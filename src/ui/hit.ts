// Pure hit-testing for the figure-answer widgets (logical y-up coordinates).
// DOM-free so node tests cover it; the gates map click events into logical
// space through the svg's live viewBox and call these.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

/** The id of the smallest box containing the point, or null on a miss. */
export function hitElement(boxes: ReadonlyMap<string, BBox>, p: Pt): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const [id, b] of boxes) {
    if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h) continue;
    const area = b.w * b.h;
    if (area < bestArea) {
      bestArea = area;
      best = id;
    }
  }
  return best;
}
