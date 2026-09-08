// Morph geometry (design §2.4): resampling by arc length so two outlines
// with different vertex counts tween point for point, and ring alignment so
// a closed shape does not twist on its way.
import type { Pt } from "../layout/model";

function cumulative(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** k points evenly spaced by arc length. A closed ring is closed first (its
 *  last point rejoins its first) and the k samples exclude the repeated start. */
export function resamplePolyline(pts: Pt[], closed: boolean, k: number): Pt[] {
  if (pts.length === 0 || k <= 0) return [];
  const first = pts[0], last = pts[pts.length - 1];
  const ring = closed && (first[0] !== last[0] || first[1] !== last[1]) ? [...pts, first] : pts;
  const cum = cumulative(ring);
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: k }, (): Pt => [first[0], first[1]]);
  const denom = closed ? k : Math.max(1, k - 1);
  const out: Pt[] = [];
  let j = 0;
  for (let i = 0; i < k; i++) {
    const s = (total * i) / denom;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg === 0 ? 0 : (s - cum[j]) / seg;
    out.push([ring[j][0] + (ring[j + 1][0] - ring[j][0]) * t, ring[j][1] + (ring[j + 1][1] - ring[j][1]) * t]);
  }
  return out;
}

/** Rotate a ring's start index to the one closest to `from` (least total squared distance). */
export function alignRing(from: Pt[], to: Pt[]): Pt[] {
  const k = to.length;
  if (k === 0 || from.length !== k) return to;
  let best = 0;
  let bestD = Infinity;
  for (let shift = 0; shift < k; shift++) {
    let d = 0;
    for (let i = 0; i < k && d < bestD; i++) {
      const p = to[(i + shift) % k];
      d += (p[0] - from[i][0]) ** 2 + (p[1] - from[i][1]) ** 2;
    }
    if (d < bestD) {
      bestD = d;
      best = shift;
    }
  }
  return to.map((_, i) => to[(i + best) % k]);
}

/** Both sides of a morph at a common count K = max(len(from), len(to), 24). */
export function morphPair(from: Pt[], fromClosed: boolean, to: Pt[], toClosed: boolean): { from: Pt[]; to: Pt[] } {
  const k = Math.max(from.length, to.length, 24);
  const a = resamplePolyline(from, fromClosed, k);
  let b = resamplePolyline(to, toClosed, k);
  if (fromClosed && toClosed) b = alignRing(a, b);
  return { from: a, to: b };
}

export function stretchPts(pts: Pt[], pivot: Pt, sx: number, sy: number): Pt[] {
  return pts.map(([x, y]): Pt => [pivot[0] + (x - pivot[0]) * sx, pivot[1] + (y - pivot[1]) * sy]);
}
