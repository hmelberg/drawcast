// Scrubbing a model's numbers on the figure (2026-09-27): the arithmetic the
// decision_tree and markov_model bodies share. A press on a number and a
// drag sideways changes it by whole steps — every STEP_UNITS logical units
// of travel one step — from the value it had at the press, so every frame of
// a gesture is the whole gesture, never an increment on the last frame.
//
//   a probability      steps of 0.01 (0.001 when the author wrote three
//                      decimals, "0.005"), clamped to 0–1 (or tighter)
//   a payoff, a cost,  a step about 1 % of the value, rounded to 1, 2 or 5
//   a utility          times a power of ten (9.5 → 0.1, 10 000 → 100); a
//                      value of 0 steps by the kind's own unit. Never below
//                      0 unless it was already negative.

/** Logical units of sideways travel per step. */
export const STEP_UNITS = 4;

/** The decimals a number is written with ("0.10" → 2, "12" → 0). */
export function decimalsOf(text: string | number): number {
  const s = typeof text === "number" ? String(text) : text.trim();
  if (/e-/i.test(s)) return Math.min(6, Number(s.split(/e-/i)[1]) || 0);
  return (s.split(/[.,]/)[1] ?? "").replace(/\D.*$/, "").length;
}

/** A step near 1 % of |v|: 1, 2 or 5 times a power of ten. `zero` when v is 0. */
export function niceStep(v: number, zero: number): number {
  const raw = Math.abs(v) * 0.01;
  if (!(raw > 0)) return zero;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw - 1e-12) return m * pow;
  return 10 * pow;
}

/** Round to a step's own decimals (0.1 → 1 place, 100 → 0), killing float dust. */
export function roundToStep(v: number, step: number): number {
  const places = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number((Math.round(v / step) * step).toFixed(Math.min(places, 10)));
}

/** Round to `places` decimals, float dust gone. */
export const roundTo = (v: number, places: number): number => Number(v.toFixed(places));

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The value a drag of `dx` logical units sets, from `v0` at the press. */
export function scrubbed(v0: number, dx: number, step: number, lo = -Infinity, hi = Infinity): number {
  const n = Math.trunc(dx / STEP_UNITS);
  return clamp(roundToStep(v0 + n * step, step), lo, hi);
}

/** A money-like or payoff-like number's scrub: its step, and its floor
 *  (0, unless the value is already negative — then no floor). */
export function amountScrub(v0: number, zeroStep: number): { step: number; min: number } {
  return { step: niceStep(v0, zeroStep), min: v0 < 0 ? -Infinity : 0 };
}

/** A probability's step: 0.01, finer when the author wrote more decimals. */
export function probabilityStep(written?: string | number): number {
  const d = written === undefined ? 2 : Math.max(2, Math.min(4, decimalsOf(written)));
  return 10 ** -d;
}

/**
 * Written the way the author wrote the number it replaces: at least their
 * decimals (and at least `minDecimals`), their decimal comma if they used
 * one. "0.10" edited to 0.2 is "0.20", not "0.2".
 */
export function writeLike(v: number, like: string | undefined, minDecimals = 2): string {
  const d = Math.min(6, Math.max(minDecimals, like === undefined ? 0 : decimalsOf(like), decimalsOf(roundTo(v, 6))));
  const s = v.toFixed(d);
  return like !== undefined && /\d,\d/.test(like) ? s.replace(".", ",") : s;
}

/**
 * Shares that must still add up to `total` after one of them changed: the
 * others are scaled in proportion to what they were (all equal when they
 * were all 0), each rounded to `places`, and the rounding's remainder goes
 * to the largest — so the sum is exact to `places`. Never negative.
 */
export function rescaleShares(others: number[], total: number, places: number): number[] {
  if (others.length === 0) return [];
  const t = Math.max(0, total);
  const sum = others.reduce((a, b) => a + Math.max(0, b), 0);
  const raw = sum > 1e-12 ? others.map((v) => (Math.max(0, v) * t) / sum) : others.map(() => t / others.length);
  const out = raw.map((v) => roundTo(v, places));
  const rest = roundTo(t - out.reduce((a, b) => a + b, 0), places);
  if (Math.abs(rest) > 0) {
    let k = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[k]) k = i;
    out[k] = Math.max(0, roundTo(out[k] + rest, places));
  }
  return out;
}
