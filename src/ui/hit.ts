// Pure hit-testing for the figure-answer widgets (logical y-up coordinates).
// DOM-free so node tests cover it; the gates map click events into logical
// space through the svg's live viewBox and call these.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

/** The id of the smallest box containing the point, or null on a miss.
 *  With slop > 0, a clean miss snaps to the nearest box within that many
 *  logical units — fat-finger tolerance for touch (and kinder mouse aim). */
export function hitElement(boxes: ReadonlyMap<string, BBox>, p: Pt, slop = 0): string | null {
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
  if (best !== null || slop <= 0) return best;
  let bestDist = Infinity;
  for (const [id, b] of boxes) {
    const dx = Math.max(b.x - p[0], 0, p[0] - (b.x + b.w));
    const dy = Math.max(b.y - p[1], 0, p[1] - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d <= slop && (d < bestDist || (d === bestDist && b.w * b.h < bestArea))) {
      bestDist = d;
      bestArea = b.w * b.h;
      best = id;
    }
  }
  return best;
}
