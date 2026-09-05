// Pure hit-testing for the figure-answer widgets (logical y-up coordinates).
// DOM-free so node tests cover it; the gates map click events into logical
// space through the svg's live viewBox and call these.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

/** Even-odd point-in-polygon on a closed ring (the last point joins the first). */
export function pointInRing(ring: readonly Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const areaOf = (b: BBox | undefined): number => (b ? b.w * b.h : Infinity);

/** The id of the element under the point, or null on a miss.
 *
 *  Elements that declare an OUTLINE (`rings`) are judged on that outline, not
 *  on their box — anatomy is the case that forces this: a liver's box swallows
 *  half a lung it does not touch, and the smallest-box rule then answers with
 *  whichever box happens to be smaller. Boxes remain the rule for everything
 *  that has no closed geometry (labels, axes, curves).
 *
 *  With slop > 0, a clean miss snaps to the nearest box within that many
 *  logical units — fat-finger tolerance for touch (and kinder mouse aim). The
 *  slop pass considers outlined shapes too, so a near miss on an organ is still
 *  rescued; only CONTAINMENT is outline-strict. */
export function hitElement(
  boxes: ReadonlyMap<string, BBox>,
  p: Pt,
  slop = 0,
  rings?: ReadonlyMap<string, Pt[][]>,
): string | null {
  let best: string | null = null;
  let bestArea = Infinity;

  // Pass 1: outlines. Smallest box among the shapes that actually contain p.
  if (rings) {
    for (const [id, rs] of rings) {
      if (!rs.some((r) => r.length >= 3 && pointInRing(r, p))) continue;
      const area = areaOf(boxes.get(id));
      if (area < bestArea) {
        bestArea = area;
        best = id;
      }
    }
    if (best !== null) return best;
  }

  // Pass 2: boxes, skipping anything that already answered "not me" in pass 1.
  for (const [id, b] of boxes) {
    if (rings?.has(id)) continue;
    if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h) continue;
    const area = b.w * b.h;
    if (area < bestArea) {
      bestArea = area;
      best = id;
    }
  }
  if (best !== null || slop <= 0) return best;

  // Pass 3: slop. Everything is eligible again — a near miss is a near miss.
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
