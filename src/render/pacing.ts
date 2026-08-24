// How long one draw/erase command is allowed to take.
//
// Element durations are authored per element (kit.MS, or the compiler's own
// numbers), which is right for a curve or an arrow but scales badly: a step's
// wall-clock is the SUM of its elements, and a GROUP is one element whose
// duration is the sum of its leaves. Nothing in the spec or the prompt can see
// that — a template's 26-rung DNA helix is a single id — so the cap lives
// here, in the player, where the total is finally known.
//
// Budgets are chosen from the bundled corpus: across 90 draw steps the median
// is 1.4s and p90 is 3.4s, so a narrated cap of 3.5s leaves ordinary beats
// untouched and only catches the outliers (27s of rungs, 26s of lipids, 11s of
// aspirin bonds). Silent steps get less: with no sentence running, a long draw
// is just dead air.

export const DRAW_BUDGET_MS = 3500;
export const SILENT_DRAW_BUDGET_MS = 2000;

export interface PacingOpts {
  /** The step carries a `speak` — the voice covers a longer draw. */
  narrated: boolean;
  /** Elements are drawn simultaneously, so the step costs the slowest one, not the sum. */
  parallel: boolean;
}

/**
 * Per-element durations for one step, compressed to fit the step's budget.
 * Relative weights are preserved (a stroke that took twice as long still
 * does), and a step that already fits comes back untouched — the same array
 * values, so the common case is provably unchanged.
 */
export function pacedDurations(durations: number[], opts: PacingOpts): number[] {
  if (durations.length === 0) return [];
  const budget = opts.narrated ? DRAW_BUDGET_MS : SILENT_DRAW_BUDGET_MS;
  const total = opts.parallel ? Math.max(...durations) : durations.reduce((a, b) => a + b, 0);
  if (total <= budget) return durations;
  const scale = budget / total;
  return durations.map((d) => d * scale);
}
