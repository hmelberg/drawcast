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

import { CANVAS } from "./canvas";

/** Between the two halves, and outside them. */
const GUTTER = 40;
const MARGIN = 60;
/** The code panel's half — the geometry the hand-tuned examples already use. */
export const CODE_HALF = Object.freeze({ x: 225, width: 410 });
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
  /** Its params_schema declares `box` — most templates own the whole canvas. */
  templateTakesBox: boolean;
  /** The author already placed the figure. */
  boxGiven: boolean;
  /** The code element that DRAWS, or null when the script only feeds data. */
  code: { x?: number; width?: number } | null;
}): FigureSplit {
  const { hasTemplate, templateTakesBox, boxGiven, code } = input;
  if (!hasTemplate || !code) return {};
  const out: FigureSplit = {};
  // Untouched by the author: the script takes the reading side, the left.
  if (code.x === undefined && code.width === undefined) out.code = { ...CODE_HALF };
  if (!templateTakesBox || boxGiven) return out;
  // The figure takes the band the code panel leaves — whichever side that is,
  // so an author who moved the script right does not get the chart on top of it.
  const cx = code.x ?? CODE_HALF.x;
  const cw = code.width ?? CODE_HALF.width;
  const left = cx - cw / 2;
  const right = cx + cw / 2;
  const roomRight = CANVAS.w - MARGIN - (right + GUTTER);
  const roomLeft = left - GUTTER - MARGIN;
  const w = Math.max(roomRight, roomLeft);
  if (w < MIN_FIGURE_W) return out; // nothing worth boxing: the lint speaks instead
  out.box = { x: roomRight >= roomLeft ? right + GUTTER : MARGIN, y: BAND.y, w, h: BAND.h };
  return out;
}
