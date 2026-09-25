// Fixed logical canvas: 1000×750, Cartesian, y-up, origin bottom-left.
// The single y-flip to SVG space happens in the backend (see toSvgY), nowhere else.

// Frozen: exposed live on `kit` (src/scenes/kit.ts) to compiled template
// bodies — see the matching note on COLORS in layout/model.ts.
export const CANVAS = Object.freeze({ w: 1000, h: 750 } as const);

/** Default plot-area margins (logical units) for diagrams with axes. */
// top: the y arrow overshoots the plot by AXIS_OVERHANG (22) and the y-axis
// caption sits above the arrowhead (a 28pt label box is 35 units) — 55 units
// could not hold both, which pinned the label ONTO the arrowhead (Hans
// 2026-09-02: "there should be some space there"). 75 gives arrow + gap +
// label room; the pack templates that set their own plot already chose tops
// in this range (y1 ≤ 630).
export const PLOT_MARGIN = { left: 120, right: 70, top: 75, bottom: 95 } as const;

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

export function plotArea(): PlotArea {
  return {
    x0: PLOT_MARGIN.left,
    y0: PLOT_MARGIN.bottom,
    x1: CANVAS.w - PLOT_MARGIN.right,
    y1: CANVAS.h - PLOT_MARGIN.top,
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
