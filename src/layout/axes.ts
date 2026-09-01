import { CANVAS, type PlotArea } from "./canvas";
import { heuristicMeasure } from "./measure";
import {
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type GroupDrawable,
  type Pt,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";

/**
 * How far each axis stroke runs PAST the plot box — the arrowhead's tip.
 * Every axis in the app (makeAxes below, and the `axes__x`/`axes__y` strokes
 * in the pack templates) uses this, and axisLabelPlacement hangs its labels
 * off it, so the two can never drift apart.
 */
export const AXIS_OVERHANG = 22;

/** Axis line → top of the x label's box. Was 34.5 for a 28pt label; Hans: "a little too far away". */
const X_LABEL_GAP = 16;
/** Arrow tip → left edge of an inline (short) x label. */
const X_LABEL_INLINE_GAP = 10;
/**
 * "Short word" for the in-line x label, in ems: ~2.5 × the font size is
 * about five characters — a symbol or a one-word name, never a phrase.
 * A phrase set in line with the axis would either run off the canvas or
 * eat into the figure, which is the whole reason the label lives below.
 */
const X_LABEL_SHORT_EMS = 2.5;
/** Arrow tip → bottom of the y label's box. */
const Y_LABEL_GAP = 8;
/** Never let a label's box touch the canvas edge. */
const CANVAS_EDGE_MARGIN = 4;

export interface AxisLabelPlacement {
  pos: Pt;
  anchor: "start" | "middle" | "end";
  /** x axis only: the label sits IN LINE with the axis, past the arrow tip. */
  inline: boolean;
}

/**
 * Where an axis caption goes, as one rule shared by every axes-shaped scene
 * (B13). The compromise Hans stated: the caption must never steal plot space
 * or crowd the markings drawn at crossing points, but it should still HUG its
 * arrow instead of floating off in the margin.
 *
 * x: right-justified under the axis with its RIGHT EDGE at the arrow tip
 * (was 8 units short of it) and X_LABEL_GAP below the axis line (was ~35).
 * A short word instead sits in line with the axis just past the arrow tip —
 * but only when it is both semantically short (X_LABEL_SHORT_EMS) and fits
 * in the strip of canvas beyond the arrow, so it never encroaches on the plot.
 *
 * y: centered on the arrow tip, just above it. A label too wide to centre —
 * one whose left edge would fall off the canvas — slides right until it
 * clears the edge, which puts its start at or left of the y axis, exactly as
 * Hans asked. That clamp IS the short/long threshold, and it is measured:
 * "short" means w ≤ 2 × (plot.x0 − CANVAS_EDGE_MARGIN), ≈ 15 characters at
 * 28pt on the standard plot box. The label rides just under the canvas top
 * when the arrow is close to it (the standard plot leaves only 33 units of
 * headroom, less than one 28pt line), which is why the vertical is a min().
 */
export function axisLabelPlacement(axis: "x" | "y", plot: PlotArea, text: string, fontSize: number): AxisLabelPlacement {
  const { w, h } = heuristicMeasure(text, fontSize);
  if (axis === "x") {
    const tipX = plot.x1 + AXIS_OVERHANG;
    const beyondArrow = CANVAS.w - CANVAS_EDGE_MARGIN - (tipX + X_LABEL_INLINE_GAP);
    if (w <= Math.min(beyondArrow, X_LABEL_SHORT_EMS * fontSize)) {
      return { pos: [tipX + X_LABEL_INLINE_GAP, plot.y0], anchor: "start", inline: true };
    }
    return { pos: [tipX, plot.y0 - X_LABEL_GAP - h / 2], anchor: "end", inline: false };
  }
  const tipY = plot.y1 + AXIS_OVERHANG;
  return {
    pos: [
      Math.max(plot.x0, CANVAS_EDGE_MARGIN + w / 2),
      Math.min(tipY + Y_LABEL_GAP + h / 2, CANVAS.h - CANVAS_EDGE_MARGIN - h / 2),
    ],
    anchor: "middle",
    inline: false,
  };
}

/** L-shaped axes with arrowheads and axis labels, shared by scenes and tier 2. */
export function makeAxes(id: string, plot: PlotArea, xLabel?: string, yLabel?: string): GroupDrawable {
  const style = defaultStyle({ strokeWidth: 4, roughness: 1.1 });
  const children: (StrokeDrawable | TextDrawable)[] = [
    {
      id: `${id}_x`,
      kind: "stroke",
      pts: [
        [plot.x0 - 6, plot.y0],
        [plot.x1 + AXIS_OVERHANG, plot.y0],
      ],
      arrowhead: "end",
      z: Z_STROKE,
      style,
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis),
    },
    {
      id: `${id}_y`,
      kind: "stroke",
      pts: [
        [plot.x0, plot.y0 - 6],
        [plot.x0, plot.y1 + AXIS_OVERHANG],
      ],
      arrowhead: "end",
      z: Z_STROKE,
      style,
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis),
    },
  ];
  const AXIS_LABEL_FONT = 28;
  // Placement (both axes) is axisLabelPlacement's job — see its doc comment
  // for the compromise it encodes; the strip under the axis stays free for
  // the quantity markings drawn at crossing points.
  if (xLabel) {
    const { pos, anchor } = axisLabelPlacement("x", plot, xLabel, AXIS_LABEL_FONT);
    children.push({
      id: `${id}_x_label`,
      kind: "text",
      pos,
      text: xLabel,
      fontSize: AXIS_LABEL_FONT,
      anchor,
      z: Z_TEXT,
      style: defaultStyle(),
      drawOpts: defaultDrawOpts("instant"),
    });
  }
  if (yLabel) {
    const { pos, anchor } = axisLabelPlacement("y", plot, yLabel, AXIS_LABEL_FONT);
    children.push({
      id: `${id}_y_label`,
      kind: "text",
      pos,
      text: yLabel,
      fontSize: AXIS_LABEL_FONT,
      anchor,
      z: Z_TEXT,
      style: defaultStyle(),
      drawOpts: defaultDrawOpts("instant"),
    });
  }
  return {
    id,
    kind: "group",
    children,
    z: Z_STROKE,
    style,
    drawOpts: defaultDrawOpts("sketch"),
  };
}
