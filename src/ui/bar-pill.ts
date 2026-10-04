// Where a bar guess's value pill stands (W25): above the bar's top while
// that stays under the top of the plot, else beside the bar's top — right of
// it, else left — and always inside the plot: never over the y-axis and its
// numbers, never past the plot's right end. Stage pixels; pure, for the tests.

export interface BarPillIn {
  /** The bar's left and right edges and its top (the dragged value). */
  barL: number;
  barR: number;
  barTop: number;
  /** The plot: its y-axis x, its right end, its top (the axis maximum). */
  axisX: number;
  plotR: number;
  plotTop: number;
  /** The pill's size, and its gap above the bar (CSS: 100 % + lift). */
  pw: number;
  ph: number;
  lift: number;
}

/** above: the pill's centre x (its CSS lifts it over the point); beside: its left edge. */
export type BarPillOut = { mode: "above"; x: number } | { mode: "beside"; x: number };

const PAD = 4;

export function barPill(m: BarPillIn): BarPillOut {
  const lo = m.axisX + PAD;
  const hi = Math.max(lo + m.pw, m.plotR);
  const clampLeft = (left: number): number => Math.max(lo, Math.min(hi - m.pw, left));
  if (m.barTop - m.lift >= m.plotTop) {
    const left = clampLeft((m.barL + m.barR) / 2 - m.pw / 2);
    return { mode: "above", x: left + m.pw / 2 };
  }
  if (m.barR + PAD + m.pw <= hi) return { mode: "beside", x: m.barR + PAD };
  if (m.barL - PAD - m.pw >= lo) return { mode: "beside", x: m.barL - PAD - m.pw };
  return { mode: "beside", x: clampLeft(m.barR + PAD) };
}
