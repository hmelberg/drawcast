// The drawcast mark: drawn by the same engine that draws every figure —
// rough.js's headless generator API, not a hand-authored logo file. A fixed
// seed is not optional: roughjs randomises by design, and a mark that
// reshapes itself on every reload reads as a rendering bug, not hand-drawn
// charm. `rough.generator().toPaths(drawable)` needs no DOM, so this runs in
// the browser, in a node test, and in the build-mark script alike.
import rough from "roughjs";
import type { Options as RoughOptions } from "roughjs/bin/core";

const SEED = 20260831;
const INK = "#3d3833";

function opts(color: string, extra: Partial<RoughOptions> = {}): RoughOptions {
  return { seed: SEED, stroke: color, roughness: 1.3, bowing: 1, ...extra };
}

/**
 * One sketched stroke sweeping up into a solid play triangle — the pencil
 * and the cast, in a single gesture. Deliberately just two drawables: a
 * favicon shows almost nothing, so the silhouette has to survive being
 * shrunk to 16px, where thin rough strokes vanish and only a bold line and
 * a solid fill still read. Both shapes sit in the right two-thirds of the
 * box so the mark reads off-center next to the wordmark, not centered
 * alone.
 *
 * `color` defaults to the fixed ink literal — required for public/mark.svg,
 * the favicon, which is served standalone and cannot read a CSS custom
 * property. The topbar's inline copy passes "currentColor" instead, so the
 * mark follows --ink (and stays visible in dark mode) the way every other
 * chrome element does; see main.ts.
 */
export function markSvg(size = 64, color = INK): string {
  const gen = rough.generator();

  // The pencil: a two-segment upward swoop, thick enough to survive
  // shrinking.
  const stroke = gen.curve(
    [
      [6, 48],
      [22, 16],
      [38, 34],
    ],
    opts(color, { strokeWidth: 5.5 }),
  );

  // The cast: a solid play triangle picking up where the stroke ends.
  const play = gen.polygon(
    [
      [36, 18],
      [36, 50],
      [58, 34],
    ],
    opts(color, { strokeWidth: 3, fill: color, fillStyle: "solid" }),
  );

  const paths = [...gen.toPaths(stroke), ...gen.toPaths(play)]
    .map(
      (p) =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${paths}</svg>`;
}
