// How dark a label may be allowed to go and still be read.
//
// The one place the app answers "how far may I dim this ink?". Templates reach
// it through `kit.softAlpha` (src/scenes/kit.ts) and the race harness imports
// it directly (scripts/smoke-race.mjs), so the ink a figure draws and the gate
// that checks it can never drift apart.
//
// Everything here is COMPUTED. This repo has shipped a wrong contrast number
// twice, and the heatmap's own label-flip block (src/scenes/packs/data.yaml)
// is the standard: composite in gamma-encoded sRGB — which is what an SVG
// `opacity` actually does — then take the WCAG 2.1 relative luminance of the
// result. Nothing below is a remembered figure.

import { COLORS } from "./model";

/**
 * The figure's own paper — the ground every drawable is composited over, and
 * the ONE place its colour is written: the stage's CSS background, the text
 * halo, a code panel's own field, the wordmark and the packs' contrast
 * arithmetic all read it from here. NOT the app chrome's --paper: a figure
 * sits on its own sheet, and that sheet stays light in either theme.
 *
 * Warm, not white (2026-09-05, Hans: a near-white sheet reads as a white BOX
 * on the page, and glares in dark mode). #fffefb was 0.4 % off pure white;
 * this is a cream that reads as paper. Everything downstream is derived, so
 * the cost of the move is arithmetic, not repainting: ink lands at 10.74:1
 * (was 11.49), and READABLE_FLOOR — guide at full ink — at 3.25 (was 3.48).
 */
export const FIGURE_GROUND = "#faf6ec";

const LUM_W = [0.2126, 0.7152, 0.0722];

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
}

/** WCAG 2.1 relative luminance of three 0–255 channels. */
function luminanceOf(rgb: (i: number) => number): number {
  let L = 0;
  for (let i = 0; i < 3; i++) {
    const c = rgb(i) / 255;
    L += LUM_W[i] * (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  }
  return L;
}

export function relativeLuminance(hex: string): number {
  return luminanceOf((i) => channel(hex, i));
}

export function contrastOfLuminances(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Contrast of `color` painted at `alpha` over `ground`, against that ground. */
export function contrastAtAlpha(color: string, alpha: number, ground = FIGURE_GROUND): number {
  const Lg = relativeLuminance(ground);
  const L = luminanceOf((i) => channel(ground, i) * (1 - alpha) + channel(color, i) * alpha);
  return contrastOfLuminances(L, Lg);
}

/**
 * The pack's own floor for text a reader is expected to READ: `COLORS.guide`
 * at full ink. Axis tick labels and a bar race's value labels are already
 * drawn in exactly that, so it is the dimmest text this app ships and calls
 * readable. Derived, never typed: it is ≈ 3.48:1 today and follows the palette
 * if the palette moves.
 */
export const READABLE_FLOOR = contrastAtAlpha(COLORS.guide, 1);

/**
 * The most a crossing may ever cost a label, whatever its ink could afford.
 * A CAP, not a measurement — it exists so a very dark name (COLORS.ink starts
 * at 11.49:1 and could clear the floor all the way down to ≈ 0.59) does not
 * turn into a watermark the moment another label passes it. The app's one
 * deliberately-backgrounded text, a race's ticker, sits at 0.4; 0.7 stays
 * plainly on the "text" side of that while still letting the reader see one
 * name through the other.
 */
export const SOFT_CEILING = 0.7;

const softCache = new Map<string, number>();

/**
 * How far a label of this ink may be dimmed to acknowledge a crossing: the
 * largest reduction whose composite over the figure's paper still clears
 * READABLE_FLOOR, never past SOFT_CEILING. Returns 1 — no dimming at all —
 * for an ink with no headroom, which is the honest answer rather than a
 * softening that trades a collision for an unreadable label.
 *
 * Scanned rather than solved, on a 0.005 grid, because contrast along the
 * composite is not guaranteed monotone for an arbitrary ink/ground pair and a
 * bisection would quietly assume it is. The grid is coarse enough to be cheap
 * and the answer is memoised per colour — a figure uses a handful of inks, and
 * an animating race asks the same question sixty times a second.
 */
export function softAlpha(color: string, ground = FIGURE_GROUND): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return 1;
  const key = `${color}|${ground}`;
  const hit = softCache.get(key);
  if (hit !== undefined) return hit;
  let a = 1;
  if (contrastAtAlpha(color, 1, ground) >= READABLE_FLOOR) {
    for (let step = SOFT_CEILING; step <= 1.0000001; step += 0.005) {
      if (contrastAtAlpha(color, step, ground) >= READABLE_FLOOR) {
        a = Math.min(1, step);
        break;
      }
    }
  }
  softCache.set(key, a);
  return a;
}
