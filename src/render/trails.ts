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
