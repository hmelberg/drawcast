// The page frame (spec docs/specs/2026-10-04-page-frame.md): ONE place that
// says how a drawcast page is divided, so layout, templates, cards, scales
// and lints stop repeating their own copies of the same numbers.
//
//   y 750 ┌──────────────────────────────┐
//         │   heading strip (title)      │  HEADING_Y 726, underline ≈ 697
//   y 655 ├──────────────────────────────┤  CONTENT_TOP
//         │                              │
//         │   content: the figure        │  x 60 … 940 (MARGIN)
//         │                              │
//   y 160 ├──────────────────────────────┤  CAPTION_TOP
//         │   caption band (narration)   │  HTML captions may lie over it
//   y   0 └──────────────────────────────┘
//
// Logical units, y up, like every spec coordinate. A page with no heading
// may use the strip (CONTENT_TOP_BARE). Everything here is a default the
// author can override (a template's params.box, an element's x/y/width, a
// cards element's size) — the frame is where things go when nobody says.

import type { BBox } from "./geometry";

export const PAGE_W = 1000;
export const PAGE_H = 750;
/** Left and right margin of the content area. */
export const MARGIN = 60;
/** The heading's baseline-centre y (spec/card.ts headingElements). */
export const HEADING_Y = 726;
/** The top heading's drawn text size: a one-line title across the top, 26–36. */
export function headingFont(text: string): number {
  return Math.max(26, Math.min(36, Math.round(880 / (0.55 * Math.max(1, text.length)))));
}
/** Top of the content area under a heading: 40 under the lowest underline
 *  (a 36-unit heading's, at 726 − 0.82 × 36 ≈ 696), the gap canvas.ts
 *  HEADING_GAP keeps above a plot. */
export const CONTENT_TOP = 655;
/** Top of the content area on a page with no heading. */
export const CONTENT_TOP_BARE = 700;
/** Bottom of the content area: below it the narration's captions may lie
 *  over the canvas (render/caption-place.ts strip and overlay modes). */
export const CAPTION_TOP = 160;

/** Between two figures that share the content area (the named regions'
 *  halves, the code/figure split, a chart beside its drawing). */
export const GUTTER = 40;


/** The content area: where a page's figure goes by default. */
export function contentBox(opts: { heading?: boolean } = {}): BBox {
  const top = opts.heading === false ? CONTENT_TOP_BARE : CONTENT_TOP;
  return { x: MARGIN, y: CAPTION_TOP, w: PAGE_W - 2 * MARGIN, h: top - CAPTION_TOP };
}

/** The band figures are fitted into (regions.ts "full" and its halves, a
 *  chart beside a drawing, the code/figure split, the inset page's main box,
 *  scratch corners): the content area's height, clear of the caption band
 *  below and the heading strip above. Was y 95–655 until 2026-10-04: a
 *  fitted chart's floor sat under the captions. */
export const FIT_BAND: Readonly<{ y: number; h: number }> = Object.freeze({ y: CAPTION_TOP, h: CONTENT_TOP - CAPTION_TOP });
