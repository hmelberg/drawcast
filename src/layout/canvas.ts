// Fixed logical canvas: 1000×750, Cartesian, y-up, origin bottom-left.
// The single y-flip to SVG space happens in the backend (see toSvgY), nowhere else.

// Frozen: exposed live on `kit` (src/scenes/kit.ts) to compiled template
// bodies — see the matching note on COLORS in layout/model.ts.
export const CANVAS = Object.freeze({ w: 1000, h: 750 } as const);

/**
 * Paper round the canvas: the player can show the 1000 × 750 canvas inside
 * a slightly larger box, a margin no author has to remember. Tried at
 * 30 × 22.5 (Hans, 2026-09-25) and set back to none the same day: every
 * figure drew ~6 % smaller, a figure with its own background got a paper
 * frame, and nothing could bleed to the edge — while the layout defaults
 * (plot area, fit, at.place) already keep most figures off it. Kept as a
 * constant so a margin (or a per-cast one) is one change away; keep x : y
 * at 4 : 3 so the view never letterboxes.
 */
export const VIEW_PAD = Object.freeze({ x: 0, y: 0 } as const);

/** The un-zoomed view, logical y-up: the canvas and its paper. */
export const FULL_VIEW = Object.freeze({ x: -VIEW_PAD.x, y: -VIEW_PAD.y, w: CANVAS.w + 2 * VIEW_PAD.x, h: CANVAS.h + 2 * VIEW_PAD.y } as const);

/** Default plot-area margins (logical units) for diagrams with axes. */
// top: the y arrow overshoots the plot by AXIS_OVERHANG (22) and the y-axis
// caption sits above the arrowhead (a 28pt label box is 35 units) — 55 units
// could not hold both, which pinned the label ONTO the arrowhead (Hans
// 2026-09-02: "there should be some space there"). 75 gives arrow + gap +
// label room; the pack templates that set their own plot already chose tops
// in this range (y1 ≤ 630).
export const PLOT_MARGIN = { left: 120, right: 70, top: 75, bottom: 95 } as const;

import { fitRegion, isFitName } from "./regions";

export interface PlotArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A page's data coordinates: the domain ranges and the canvas box they fill.
 * A spec's `domain` makes one on the default plot area; a template that
 * draws a chart reports its own (SceneLayout.frame), so `{data: [x, y]}` —
 * and curves and regions on a template page with no domain — land on the
 * template's axes (2026-09-25).
 */
export interface DataFrame {
  x: [number, number];
  y: [number, number];
  box: PlotArea;
}

/** The linear data → canvas map of a frame, before any template fit. */
export function frameToCanvas(f: DataFrame): (p: [number, number]) => [number, number] {
  const sx = linearScale(f.x, [f.box.x0, f.box.x1]);
  const sy = linearScale(f.y, [f.box.y0, f.box.y1]);
  return ([x, y]) => [sx(x), sy(y)];
}

/**
 * Where the card heading's underline sits on this page, or null for a page
 * without one — set once per layout (layout.ts, beside setHeadingBox). The
 * heading is the page's title, not part of any plot: Hans 2026-09-26, on a
 * demand curve and a y-axis name level with the heading, "the headline
 * becomes part of the plot almost". A plot keeps its top this far below the
 * underline, which leaves the y-axis name (drawn just above the plot) a
 * clear strip of paper under the heading.
 */
let headingFloor: number | null = null;
const HEADING_CLEAR = 50;
export function setHeadingFloor(y: number | null): void {
  headingFloor = y;
}

/**
 * The plot a page's `domain` is drawn on: the standard plot area, or — with
 * `domain.box` — a named region ("left", "right", …) or a rectangle, less a
 * margin for the tick labels and axis names. What lets a chart share the page
 * with a drawing of the thing it measures (a ball falling beside its speed,
 * Hans 2026-09-26). Every reader of a domain's frame goes through here.
 */
export function domainPlot(domain: { box?: unknown } | undefined): PlotArea {
  const full = plotArea();
  const b = domain?.box;
  const r = isFitName(b)
    ? fitRegion(b)
    : b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => typeof (b as Record<string, unknown>)[k] === "number")
      ? (b as { x: number; y: number; w: number; h: number })
      : null;
  if (!r || !(r.w > 0) || !(r.h > 0)) return full;
  // Room inside the region for the y-axis numbers and name (left), the
  // x-axis numbers and name (below), and the y name above the plot's top.
  return { x0: r.x + 70, y0: r.y + 60, x1: r.x + r.w - 20, y1: Math.min(r.y + r.h - 25, full.y1) };
}

export function plotArea(): PlotArea {
  const top = CANVAS.h - PLOT_MARGIN.top;
  return {
    x0: PLOT_MARGIN.left,
    y0: PLOT_MARGIN.bottom,
    x1: CANVAS.w - PLOT_MARGIN.right,
    y1: headingFloor === null ? top : Math.min(top, headingFloor - HEADING_CLEAR),
  };
}

/** The one y-flip: logical y-up → SVG y-down. Backends call this at emission time only. */
export function toSvgY(y: number): number {
  return CANVAS.h - y;
}

/** Linear domain → logical scale. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}
