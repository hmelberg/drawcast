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
 *  Containment is one contest, the smallest box among the CANDIDATES wins.
 *  An element that declares an OUTLINE (`rings`) is a candidate only when one
 *  of its rings contains the point, never on its box alone — anatomy is the
 *  case that forces this: a liver's box swallows half a lung it does not
 *  touch, and the smallest-box rule would then answer with whichever box
 *  happens to be smaller. An element with no closed geometry (labels, axes,
 *  curves, the text lines of a code panel) is a candidate when its box
 *  contains the point. The two kinds compete on box area, so a line of code
 *  inside an outlined panel beats the panel: outlines are a filter on
 *  candidacy, not a tier that pre-empts every box.
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

  // Pass 1: containment. Outlined ids qualify on a ring, the rest on the box.
  for (const [id, b] of boxes) {
    const rs = rings?.get(id);
    const inside = rs
      ? rs.some((r) => r.length >= 3 && pointInRing(r, p))
      : p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
    if (!inside) continue;
    const area = b.w * b.h;
    if (area < bestArea) {
      bestArea = area;
      best = id;
    }
  }
  // An outlined id with no box of its own (a ring-only entry) still qualifies.
  if (rings) {
    for (const [id, rs] of rings) {
      if (boxes.has(id)) continue;
      if (!rs.some((r) => r.length >= 3 && pointInRing(r, p))) continue;
      const area = areaOf(undefined);
      if (best === null || area < bestArea) {
        bestArea = area;
        best = id;
      }
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
