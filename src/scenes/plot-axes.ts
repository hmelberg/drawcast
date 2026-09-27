// A chart's two axes, drawn the way equation_plot draws its own — arrows,
// round ticks with their numbers, a caption under the x axis and one over
// the y axis's tip — for the templates whose plot always starts at the
// origin's corner (titration_curve, maxwell_boltzmann). Ids:
//
//   axes      the two arrows (x_ticks, y_ticks, x_label, y_label come with it)
//   x_ticks   the x axis's tick marks and numbers
//   y_ticks   the y axis's (absent when `yNumbers` is false and no marks)
//   x_label / y_label   the captions
import { AXIS_OVERHANG, axisLabelPlacement } from "../layout/axes";
import type { PlotArea } from "../layout/canvas";
import { COLORS, Z_STROKE, Z_TEXT, SKETCH_MS, defaultDrawOpts, defaultStyle, type Drawable, type Pt } from "../layout/model";
import { kit } from "./kit";

const TICK_FONT = 22;

/** Round tick values over [lo, hi]: 1, 2 or 5 × a power of ten apart, about `target` of them. */
export function roundTicks(lo: number, hi: number, target = 6): { step: number; ticks: number[]; decimals: number } {
  const raw = (hi - lo) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw * (1 - 1e-9)) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { step, ticks, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

/** A round number at or above v (1, 2, 2.5, 5 × a power of ten) — an axis's end. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v * (1 - 1e-9)) return Number((m * pow).toPrecision(6));
  return 10 * pow;
}

export interface AxesOpts {
  plot: PlotArea;
  x: [number, number];
  y: [number, number];
  xTicks: number[];
  xDecimals: number;
  yTicks: number[];
  yDecimals: number;
  /** Write the y axis's numbers (a density's are meaningless to the reader): default true. */
  yNumbers?: boolean;
  xCaption: string;
  yCaption: string;
}

export interface DrawnAxes {
  drawables: Drawable[];
  anchors: Record<string, Pt>;
  ids: string[];
  attached: Record<string, string[]>;
  drawnWith: Record<string, string[]>;
}

export function drawAxes(o: AxesOpts): DrawnAxes {
  const { plot } = o;
  const sx = (v: number): number => plot.x0 + ((v - o.x[0]) / (o.x[1] - o.x[0])) * (plot.x1 - plot.x0);
  const sy = (v: number): number => plot.y0 + ((v - o.y[0]) / (o.y[1] - o.y[0])) * (plot.y1 - plot.y0);
  const out: DrawnAxes = { drawables: [], anchors: {}, ids: [], attached: {}, drawnWith: {} };
  const push = (d: Drawable, at: Pt): void => {
    out.drawables.push(d);
    out.anchors[d.id] = at;
    out.ids.push(d.id);
  };
  const axisStyle = defaultStyle({ strokeWidth: 3.5, roughness: 1 });
  push(
    {
      id: "axes",
      kind: "group",
      z: Z_STROKE,
      style: axisStyle,
      drawOpts: defaultDrawOpts("sketch"),
      children: [
        { id: "axes__x", kind: "stroke", pts: [[plot.x0 - 6, plot.y0], [plot.x1 + AXIS_OVERHANG, plot.y0]], arrowhead: "end", z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) },
        { id: "axes__y", kind: "stroke", pts: [[plot.x0, plot.y0 - 6], [plot.x0, plot.y1 + AXIS_OVERHANG]], arrowhead: "end", z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) },
      ],
    },
    [plot.x0, plot.y0],
  );
  const tickText = (id: string, pos: Pt, s: string, anchor: "middle" | "end"): Drawable => ({ ...kit.text(id, pos, s, { fontSize: TICK_FONT, color: COLORS.guide, anchor }), drawOpts: defaultDrawOpts("instant") });
  const group = (id: string, children: Drawable[]): Drawable => ({ id, kind: "group", children, z: Z_TEXT, style: defaultStyle({ color: COLORS.guide }), drawOpts: defaultDrawOpts("instant") });
  const xs: Drawable[] = [];
  for (const v of o.xTicks) {
    const X = sx(v);
    if (X < plot.x0 - 0.5 || X > plot.x1 + 0.5) continue;
    xs.push(kit.stroke(`x_ticks__m${xs.length}`, [[X, plot.y0 - 6], [X, plot.y0 + 6]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    xs.push(tickText(`x_ticks__t${xs.length}`, [X, plot.y0 - 30], kit.num(v, o.xDecimals), "middle"));
  }
  const ys: Drawable[] = [];
  for (const v of o.yTicks) {
    const Y = sy(v);
    if (Y < plot.y0 - 0.5 || Y > plot.y1 + 0.5) continue;
    ys.push(kit.stroke(`y_ticks__m${ys.length}`, [[plot.x0 - 6, Y], [plot.x0 + 6, Y]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    if (o.yNumbers !== false) ys.push(tickText(`y_ticks__t${ys.length}`, [plot.x0 - 14, Y - 7], kit.num(v, o.yDecimals), "end"));
  }
  if (xs.length > 0) push(group("x_ticks", xs), [plot.x1, plot.y0]);
  if (ys.length > 0) push(group("y_ticks", ys), [plot.x0, plot.y1]);
  const xl: Pt = [(plot.x0 + plot.x1) / 2, plot.y0 - 66];
  push(kit.text("x_label", xl, o.xCaption, { fontSize: 26, anchor: "middle" }), xl);
  const yl = axisLabelPlacement("y", plot, o.yCaption, 26);
  push(kit.text("y_label", yl.pos, o.yCaption, { fontSize: 26, anchor: yl.anchor }), yl.pos);
  const follow = out.ids.filter((id) => id !== "axes");
  out.attached.axes = follow;
  out.drawnWith.axes = follow;
  return out;
}
