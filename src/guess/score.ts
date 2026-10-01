// Scoring a guess (spec 2026-10-01-guess-and-reveal §4): how far each number
// is from the truth, whether that is close enough, and the {g.*} variables
// the feedback lines speak. One value → its own error; a whole chart, a
// sketched line or a whole pie → the AVERAGE error, each entry measured as a
// fraction of its handle's range (or of its true value, `relative`).

import type { GuessHandle } from "./handles";

export interface GuessTolerance {
  /** Fraction of the range (default 0.1), or of the true value when relative. */
  tolerance?: number;
  relative?: boolean;
}

export interface GuessScore {
  ok: boolean;
  /** Mean error as a fraction of the range (or of the truth, relative). */
  meanFrac: number;
  /** Entries within tolerance, and how many there are. */
  within: number;
  count: number;
  /** One value only: signed guess − truth, its size, and percent of the truth. */
  err: number | null;
  off: number | null;
  pct: number | null;
}

export const DEFAULT_TOLERANCE = 0.1;

function entryFrac(h: GuessHandle, guess: number, truth: number, tol: GuessTolerance): number {
  if (tol.relative) return Math.abs(guess - truth) / Math.max(Math.abs(truth), 1e-9);
  return Math.abs(guess - truth) / Math.max(h.max - h.min, 1e-9);
}

export function scoreGuess(handles: GuessHandle[], values: number[][], tol: GuessTolerance = {}): GuessScore {
  const t = tol.tolerance ?? DEFAULT_TOLERANCE;
  let sum = 0;
  let count = 0;
  let within = 0;
  handles.forEach((h, k) => {
    h.truth.forEach((truth, j) => {
      const g = values[k]?.[j] ?? truth;
      const f = entryFrac(h, g, truth, tol);
      sum += f;
      count++;
      if (f <= t + 1e-9) within++;
    });
  });
  const meanFrac = count > 0 ? sum / count : 0;
  const single = handles.length === 1 && handles[0].truth.length === 1;
  const g = single ? (values[0]?.[0] ?? handles[0].truth[0]) : null;
  const truth = single ? handles[0].truth[0] : null;
  return {
    ok: meanFrac <= t + 1e-9,
    meanFrac,
    within,
    count,
    err: g !== null && truth !== null ? g - truth : null,
    off: g !== null && truth !== null ? Math.abs(g - truth) : null,
    pct: g !== null && truth !== null && truth !== 0 ? (Math.abs(g - truth) / Math.abs(truth)) * 100 : null,
  };
}

/** The guess as text for {g}: one number formatted like the figure; several as "3 of 5 close". */
export function guessText(handles: GuessHandle[], values: number[][], s: GuessScore): string {
  if (handles.length === 1 && handles[0].truth.length === 1) return handles[0].format(values[0]?.[0] ?? handles[0].truth[0]);
  return `${s.within} of ${s.count}`;
}

/**
 * The variables a stored guess publishes besides {g} and {g.ok} (which the
 * player's recordAnswer writes): {g.true}, {g.err}, {g.off}, {g.pct},
 * {g.within}, {g.count}. Keys are lower-case and carry the store prefix.
 */
export function guessVars(store: string, handles: GuessHandle[], _values: number[][], s: GuessScore): Record<string, string> {
  const base = store.toLowerCase();
  const out: Record<string, string> = {
    [`${base}.within`]: String(s.within),
    [`${base}.count`]: String(s.count),
  };
  if (handles.length === 1 && handles[0].truth.length === 1) {
    const h = handles[0];
    out[`${base}.true`] = h.format(h.truth[0]);
    if (s.err !== null) out[`${base}.err`] = (s.err > 0 ? "+" : s.err < 0 ? "−" : "") + h.format(Math.abs(s.err));
    if (s.off !== null) out[`${base}.off`] = h.format(s.off);
    if (s.pct !== null) out[`${base}.pct`] = `${Math.round(s.pct)}%`;
  } else {
    out[`${base}.pct`] = `${Math.round(s.meanFrac * 100)}%`;
  }
  return out;
}
