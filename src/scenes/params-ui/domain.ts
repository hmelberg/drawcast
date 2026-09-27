// A plot's own domain, zoomed and panned by the paused viewer (params-ui,
// 2026-09-27): the numbers on the axes change and the curve is re-sampled at
// the new range — crisp at any zoom, unlike the camera's zoom, which only
// magnifies the ink. Pure range arithmetic; the widget body turns it into a
// patch of the template's x_range / y_range.

export type Range = [number, number];

/** Narrowest a range may get, relative to where it sits, and widest overall. */
export const MIN_REL_SPAN = 1e-6;
export const MAX_SPAN = 1e7;

/** The range scaled by 1/factor about `about` (factor > 1 zooms in): the
 *  value under the pointer stays under the pointer. Clamped to a sane span. */
export function zoomRange([a, b]: Range, about: number, factor: number): Range {
  if (!(factor > 0) || !Number.isFinite(factor)) return [a, b];
  const span = b - a;
  const min = MIN_REL_SPAN * Math.max(1, Math.abs(about), Math.abs(a), Math.abs(b));
  const next = Math.min(MAX_SPAN, Math.max(min, span / factor));
  const k = next / span;
  return [about + (a - about) * k, about + (b - about) * k];
}

/** The range moved so that what was at `from` is now at `to` (the hand drags the paper). */
export function panRange([a, b]: Range, from: number, to: number): Range {
  const d = from - to;
  return [a + d, b + d];
}

/** Rounded to a few significant digits past the span, so a patch reads cleanly. */
export function tidyRange([a, b]: Range): Range {
  const span = Math.abs(b - a) || 1;
  const places = Math.max(0, Math.min(12, 3 - Math.floor(Math.log10(span))));
  return [Number(a.toFixed(places)), Number(b.toFixed(places))];
}

export const sameRange = (r: Range | undefined | null, s: Range | undefined | null): boolean =>
  (!r && !s) || (!!r && !!s && Math.abs(r[0] - s[0]) < 1e-9 * Math.max(1, Math.abs(r[0])) && Math.abs(r[1] - s[1]) < 1e-9 * Math.max(1, Math.abs(r[1])));
