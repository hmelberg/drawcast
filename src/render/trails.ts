// Trails (design §2.5): the track an anchor leaves during a move, minted by
// the planner as an ordinary stroke element and appended to every layout
// render() mounts (via withMinted, render/minted.ts), so it can be faded,
// erased, highlighted or pointed at.
import type { Pt } from "../layout/model";

export interface TrailSpec {
  id: string;
  pts: Pt[];
  /** Absent = the source element's own stroke colour. */
  color?: string;
  width: number;
}

/** Fraction of the total length reached at each sample (0 … 1; all 0 for a motionless trail). */
export function cumulativeLengthFractions(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  return total === 0 ? cum.map(() => 0) : cum.map((c) => c / total);
}

/** Linear interpolation of a sample table at u ∈ [0, 1]. */
export function lengthFractionAt(table: number[], u: number): number {
  const n = table.length - 1;
  if (n <= 0) return 0;
  const x = Math.max(0, Math.min(1, u)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/** The leading `fraction` of a polyline by arc length (a trail mid-sweep, design 2026-09-10 §2.4). */
export function cutTrail(pts: Pt[], fraction: number): Pt[] {
  if (pts.length < 2 || fraction >= 1) return pts;
  const f = Math.max(0, fraction);
  const lens = cumulativeLengthFractions(pts);
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= f) {
      out.push(pts[i]);
      continue;
    }
    const a = pts[i - 1];
    const b = pts[i];
    const span = lens[i] - lens[i - 1];
    const t = span > 0 ? (f - lens[i - 1]) / span : 0;
    if (t > 0) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    break;
  }
  if (out.length === 1) out.push(pts[0]);
  return out;
}
