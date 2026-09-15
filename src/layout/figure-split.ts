// The figure split: when one figure holds BOTH a template and a script on
// screen, they used to contest the same canvas — a code element defaults to
// the full width and so does a template, so the chart landed on top of the
// code (Hans, 2026-09-04: "de skal ha hver sine områder"). Saying where the
// code sits — beside, above, below its output — has always implied that the
// output does not paint over it; this is that promise kept one level up,
// between the panel and the figure beside it.
//
// It is a DEFAULT, not a layout engine: it fills in only what the author left
// out. An x, a width, a box — anything written explicitly still wins, and
// what remains contested is the lint's business (rule overlap-code-figure).
//
// One shape it does NOT invent a box for: a side-by-side panel (show:
// "left"/"right") needs the whole width (schema: ≥ 700) and so can never
// share a page with a figure — beside a template, write "below" instead.

import { CANVAS } from "./canvas";
import { CHAR_W, PAD } from "./code";

/** Between the two halves, and outside them. */
const GUTTER = 40;
const MARGIN = 60;
/** The code panel's half — the geometry the hand-tuned examples already use.
 *  It is a CEILING, not a fixed share: a script narrower than this hands the
 *  slack to the figure (Hans, 2026-09-04) — but a long line still wraps inside
 *  the half rather than eating the chart's room. */
export const CODE_HALF = Object.freeze({ x: 225, width: 410 });
/** The panel's left edge, and the narrowest panel worth reading code in. */
const LEFT_EDGE = 20;
const MIN_CODE_W = 260;

/** A panel wide enough for the script's longest line, within the half. */
export function hugWidth(code: string, fontSize: number): number {
  const longest = code.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  const needed = longest * fontSize * CHAR_W + 2 * PAD;
  return Math.round(Math.min(CODE_HALF.width, Math.max(MIN_CODE_W, needed)));
}
/** Top and bottom of the figure's band when the split has to invent one. */
const BAND = Object.freeze({ y: 95, h: 560 });
/** Narrower than this and the leftover band is not worth calling a figure. */
const MIN_FIGURE_W = 220;

export interface FigureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FigureSplit {
  /** What the code element was missing — never what it already declared. */
  code?: { x: number; width: number };
  /** The box the template gets, when it takes one and had none. */
  box?: FigureBox;
}

export function figureSplit(input: {
  /** A template that actually lays out (a stub falls through to tier-2). */
  hasTemplate: boolean;
  /** The template lays out at all (every such template can take a box since
   *  the template box round — natively, or fitted by template-fit.ts). */
  templateTakesBox: boolean;
  /** The author already placed the figure. */
  boxGiven: boolean;
  /** The code element that DRAWS, or null when the script only feeds data. */
  code: { x?: number; width?: number; show?: string; code?: string; fontSize?: number } | null;
}): FigureSplit {
  const { hasTemplate, templateTakesBox, boxGiven, code } = input;
  if (!hasTemplate || !code) return {};
  const out: FigureSplit = {};
  if (code.x === undefined && code.width === undefined) {
    // A side-by-side panel (show: "left"/"right") is not sized like the
    // others: the schema needs it width ≥ 700 (55% of the canvas), which is
    // too wide to share a page with a figure at all — so it is NOT hugged to
    // a half and gets no invented box; the pre-existing overlap-code-figure
    // warn reports the combination instead (item 4, 2026-09-15).
    if (code.show === "left" || code.show === "right") {
      out.code = { x: 500, width: 900 }; // every bundled side-by-side example uses this
      return out;
    }
    // Untouched by the author: the script takes the reading side, the left,
    // and no more of it than its own lines need. Only for a panel that is
    // ALL code — one carrying its own output pane (code, below, above) sizes
    // that pane from the panel width, so hugging the script would squeeze
    // the output instead of the chart.
    const width = code.show === "code" ? hugWidth(code.code ?? "", code.fontSize ?? 17) : CODE_HALF.width;
    out.code = { x: LEFT_EDGE + width / 2, width };
  }
  if (!templateTakesBox || boxGiven) return out;
  // The figure takes the band the code panel leaves — whichever side that is,
  // so an author who moved the script right does not get the chart on top of it.
  const cx = code.x ?? out.code?.x ?? CODE_HALF.x;
  const cw = code.width ?? out.code?.width ?? CODE_HALF.width;
  const left = cx - cw / 2;
  const right = cx + cw / 2;
  const roomRight = CANVAS.w - MARGIN - (right + GUTTER);
  const roomLeft = left - GUTTER - MARGIN;
  const w = Math.max(roomRight, roomLeft);
  if (w < MIN_FIGURE_W) return out; // nothing worth boxing: the lint speaks instead
  out.box = { x: roomRight >= roomLeft ? right + GUTTER : MARGIN, y: BAND.y, w, h: BAND.h };
  return out;
}
