// Deterministic layout for the generic_axes_diagram scene: any single-panel
// curve figure that isn't a supply/demand market — production functions,
// cost/utility curves, dose-response, growth/decay. World→canvas mapping
// mirrors supply_demand's (domain 0–100 both axes, onto the shared plot
// box), but the axes are a single L-shaped stroke and the captions are
// their own top-level elements (x_label/y_label), not bundled into a group
// the way makeAxes does — so a command can reveal them independently.

import { linearScale, plotArea } from "../../layout/canvas";
import { centroid } from "../../layout/geometry";
import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { kit } from "../kit";

export type CurveColorName = "ink" | "demand" | "supply" | "accent" | "shifted";
export type CurveShape = "linear_up" | "linear_down" | "convex_up" | "concave_down" | "s_curve" | "u_shape" | "bell";

export interface AxesCurveSpec {
  /** Custom element id for this curve; default "curve_<i>". */
  id?: string;
  label?: string;
  /** y = f(x), x in [0, 100] (via kit.expr). Wins over `shape` when both are set. */
  expression?: string;
  /** A canned qualitative shape, used when `expression` is not set. Default "linear_up". */
  shape?: CurveShape;
  color?: CurveColorName;
}

export interface AxesPointSpec {
  x: number;
  y: number;
  label: string;
}

export interface AxesLineSpec {
  x?: number;
  y?: number;
  label?: string;
}

export interface ShadeSpec {
  /** Indices into `curves` — the two curves to shade between. */
  between?: [number, number];
  /** Index into `curves` — the curve to shade under, down to y = 0. */
  under?: number;
  x_from: number;
  x_to: number;
}

export interface GenericAxesParams {
  x_label: string;
  y_label: string;
  title?: string;
  /** 1–4 curves, each y = f(x) over x ∈ [0, 100]. */
  curves: AxesCurveSpec[];
  points?: AxesPointSpec[];
  vlines?: AxesLineSpec[];
  hlines?: AxesLineSpec[];
  /** Shade a region under one curve or between two, over [x_from, x_to]. */
  shade?: ShadeSpec;
}

// Canned shapes, all y ∈ [0, 100] over x ∈ [0, 100] — plain kit.expr strings
// (not qualitativeShape()'s normalized [0,1] shape space) so `expression`
// and `shape` share one sampling path below.
const SHAPE_EXPR: Record<CurveShape, string> = {
  linear_up: "x",
  linear_down: "100 - x",
  convex_up: "x^2/100",
  concave_down: "80*(1 - exp(-0.05*x))",
  s_curve: "100/(1+exp(-0.12*(x-50)))",
  u_shape: "((x-50)^2)/25",
  bell: "100*exp(-((x-50)^2)/300)",
};

const CURVE_COLORS: CurveColorName[] = ["demand", "supply", "accent", "shifted"];

export function layoutGenericAxes(params: GenericAxesParams): SceneLayout {
  const plot = plotArea();
  const sx = linearScale([0, 100], [plot.x0, plot.x1]);
  const sy = linearScale([0, 100], [plot.y0, plot.y1]);
  const toLogical = (pts: Pt[]): Pt[] => pts.map(([x, y]): Pt => [sx(x), sy(y)]);

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const curveSamples: Record<string, Pt[]> = {};
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], text: string, color: string = COLORS.ink, fontSize = 24) => {
    labels.push({ id, anchor, side, text, fontSize, style: defaultStyle({ color }), drawOpts: defaultDrawOpts("instant") });
    anchors[id] = anchor;
    order.push(id);
  };

  // L-shaped axes as a single stroke — both arrowheads land on its two ends
  // (arrowhead: "both" on a bent polyline draws one at pts[0] and one at
  // pts[last], see render/svg-backend.ts's arrowheadPts) — kept apart from
  // the captions so x_label/y_label are their own addressable elements.
  push({
    id: "axes",
    kind: "stroke",
    pts: [
      [plot.x1 + 22, plot.y0],
      [plot.x0, plot.y0],
      [plot.x0, plot.y1 + 22],
    ],
    arrowhead: "both",
    z: Z_STROKE,
    style: defaultStyle({ strokeWidth: 4, roughness: 1.1 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis),
  });
  push(kit.text("x_label", [plot.x1 + 14, plot.y0 - 52], params.x_label, { fontSize: 28, anchor: "end" }));
  push(kit.text("y_label", [plot.x0 + 8, plot.y1 + 36], params.y_label, { fontSize: 28, anchor: "start" }));

  // Curves.
  const curves = params.curves.slice(0, 4);
  const curveFns: ((x: number) => number)[] = [];
  curves.forEach((c, i) => {
    const id = c.id ?? `curve_${i}`;
    const src = c.expression ?? SHAPE_EXPR[c.shape ?? "linear_up"];
    const evaluator = kit.expr(src, ["x"]);
    const fn = (x: number): number => evaluator({ x });
    curveFns.push(fn);
    const pts = toLogical(kit.sample(fn, 0, 100, 60));
    const color = COLORS[c.color ?? CURVE_COLORS[i % CURVE_COLORS.length]];
    push({
      id,
      kind: "stroke",
      pts,
      z: Z_STROKE,
      style: defaultStyle({ color, strokeWidth: 4.5 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve),
    });
    curveSamples[id] = pts;
    anchors[id] = pts[pts.length - 1];
    if (c.label) label(`label_${id}`, pts[pts.length - 1], "right", c.label, color);
  });

  // Reference points.
  (params.points ?? []).forEach((p, i) => {
    const c = toLogical([[p.x, p.y]])[0];
    const id = `point_${i}`;
    push({
      id,
      kind: "stroke",
      pts: [c],
      shapeHint: { type: "circle", c, r: 7 },
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 3, fill: COLORS.ink }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.dot),
    });
    anchors[id] = c;
    label(`point_label_${i}`, c, "above-right", p.label);
  });

  // Vertical / horizontal dashed reference lines, spanning the plot box.
  (params.vlines ?? []).forEach((v, i) => {
    if (v.x === undefined) return;
    const x = sx(v.x);
    const id = `vline_${i}`;
    push(
      guideLine(id, [
        [x, plot.y0],
        [x, plot.y1],
      ]),
    );
    anchors[id] = [x, plot.y1];
    if (v.label) label(`label_${id}`, [x, plot.y1], "above", v.label, COLORS.guide, 22);
  });
  (params.hlines ?? []).forEach((h, i) => {
    if (h.y === undefined) return;
    const y = sy(h.y);
    const id = `hline_${i}`;
    push(
      guideLine(id, [
        [plot.x0, y],
        [plot.x1, y],
      ]),
    );
    anchors[id] = [plot.x1, y];
    if (h.label) label(`label_${id}`, [plot.x1, y], "above-left", h.label, COLORS.guide, 22);
  });

  // Shaded region: between two curves, or under one, over [x_from, x_to].
  if (params.shade) {
    const { between, under, x_from, x_to } = params.shade;
    const N = 40;
    let domainPts: Pt[] = [];
    if (between && curveFns[between[0]] && curveFns[between[1]]) {
      const fa = curveFns[between[0]];
      const fb = curveFns[between[1]];
      const upper: Pt[] = [];
      const lower: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const x = x_from + ((x_to - x_from) * k) / N;
        upper.push([x, fa(x)]);
        lower.push([x, fb(x)]);
      }
      domainPts = [...upper, ...lower.reverse()];
    } else if (under !== undefined && curveFns[under]) {
      const f = curveFns[under];
      const top: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const x = x_from + ((x_to - x_from) * k) / N;
        top.push([x, f(x)]);
      }
      domainPts = [...top, [x_to, 0], [x_from, 0]];
    }
    if (domainPts.length > 0) {
      const pts = toLogical(domainPts);
      push({
        id: "shade",
        kind: "area",
        pts,
        z: Z_AREA,
        style: defaultStyle({ color: COLORS.region1, fill: COLORS.region1, opacity: 0.4, strokeWidth: 1 }),
        drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region),
      });
      anchors["shade"] = centroid(pts);
    }
  }

  if (params.title) {
    push(kit.text("title", [(plot.x0 + plot.x1) / 2, plot.y1 + 30], params.title, { fontSize: 30 }));
  }

  return { drawables, labels, anchors, order, curveSamples };
}

function guideLine(id: string, pts: Pt[]): Drawable {
  return {
    id,
    kind: "stroke",
    pts,
    z: Z_STROKE,
    style: defaultStyle({ color: COLORS.guide, strokeWidth: 2.5, dash: true, roughness: 0.9 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides),
  };
}
