// Guess numbers with no dependencies — so the lint and the gate words can use
// them without loading the guess machinery (guess/handles.ts re-exports them).

/** A step for a range: about 1/50 of it, snapped to 1, 2 or 5 × 10^k
 *  (finer gave "100.0" and "37.0" on 0–100 axes: decimals nobody guesses in). */
export function niceStep(range: number): number {
  if (!(range > 0)) return 1;
  const raw = range / 50;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** A number as the dock and the account bar say it: no trailing ".0" on a whole one ("22.0" → "22"). */
export function dockNumber(text: string): string {
  return text.replace(/(\d)[.,]0+(?!\d)/g, "$1");
}
