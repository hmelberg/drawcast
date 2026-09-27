// equation_plot: any y = f(x) with parameters, drawn — the axes with round
// ticks, the curve(s) by hand, the equation above them in the drawing's own
// hand with the parameters' CURRENT values written in (each value its own
// part, eq_param_<name>, so a cast can point at it and the paused viewer can
// scrub it), an optional drawn panel of sliders and number boxes, and marks
// computed from the curve (roots, turning points, the intercept, a point, a
// tangent). Every number is live: the layout re-runs on each animate frame
// and each widget patch, and `values` carries them for {eq.<key>} tokens.
import { AXIS_OVERHANG, axisLabelPlacement } from "../../layout/axes";
import { plotArea, type PlotArea } from "../../layout/canvas";
import { COLORS, Z_STROKE, Z_TEXT, SKETCH_MS, defaultDrawOpts, defaultStyle, type Drawable, type Pt } from "../../layout/model";
import { bboxOfText, polylineIntersectsBox, simplifyPolyline } from "../../layout/geometry";
import { heuristicMeasure } from "../../layout/measure";
import { getLoadedEngines, type MathJaxEngine } from "../engines";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { drawEquation, PARAM_COLOR } from "../params-ui/equation";
import { drawPanel, panelRows, PANEL_W } from "../params-ui/panel";
import { autoYRange, extremaOf, niceTicks, readModel, rootsOf, sampleCurve, slopeAt, type EquationPlotParams, type MarkSpec, type Model } from "./model";

export type { EquationPlotParams } from "./model";

/** Curve colours in order: blue, red, sage, orange. */
export const CURVE_COLORS = [COLORS.supply, COLORS.demand, "#5d8a4f", COLORS.shifted];

const EQ_LINE = 60;
const PANEL_GAP = 75;
const TICK_FONT = 22;

/** Where everything goes: the plot box, the equation lines' centres, the panel's column. */
export function pageGeometry(m: Model): { plot: PlotArea; eqLines: number; eqTop: number; eqCx: number; eqWidth: number; panel: { x0: number; x1: number; yMid: number } } {
  const page = plotArea();
  const lines = m.curves.length * (m.form === "both" ? 2 : 1);
  const plot: PlotArea = { ...page };
  const eqTop = page.y1 + 8;
  plot.y1 = page.y1 - lines * EQ_LINE - 62;
  if (m.panel.length > 0) plot.x1 = 1000 - 25 - PANEL_W - PANEL_GAP;
  const eqCx = m.panel.length > 0 ? (plot.x0 + 1000 - 25) / 2 : (plot.x0 + plot.x1) / 2;
  const eqWidth = m.panel.length > 0 ? 1000 - 25 - 40 : 1000 - 40;
  const panel = { x0: 1000 - 25 - PANEL_W, x1: 1000 - 25, yMid: (plot.y0 + plot.y1) / 2 };
  return { plot, eqLines: lines, eqTop, eqCx, eqWidth, panel };
}

export interface Frame {
  x: [number, number];
  y: [number, number];
  box: PlotArea;
}

/** The y range drawn: the author's, else the calm auto range of every curve. */
export function yRangeOf(m: Model, P: EquationPlotParams): [number, number] {
  const yr = P.y_range;
  if (Array.isArray(yr) && Number.isFinite(yr[0]) && Number.isFinite(yr[1]) && yr[1] > yr[0]) return [yr[0], yr[1]];
  return autoYRange(m.curves.map((c) => sampleCurve(c, m.env, m.xRange).ys));
}

/** Ids of the marks, in their order: what the manifest documents. */
function markSuffix(mk: MarkSpec): string {
  return (mk.curve ?? 0) > 0 ? `_c${mk.curve}` : "";
}

const trim = (v: number, d = 2): string => {
  const s = kit.num(Number(v.toFixed(d)));
  return s === "-0" ? "0" : s;
};

export function layoutEquationPlot(P: EquationPlotParams): SceneLayout {
  const m = readModel(P);
  const { plot, eqTop, eqCx, eqWidth, panel: column } = pageGeometry(m);
  const [x0, x1] = m.xRange;
  const [y0, y1] = yRangeOf(m, P);
  const sx = (x: number): number => plot.x0 + ((x - x0) / (x1 - x0)) * (plot.x1 - plot.x0);
  const sy = (y: number): number => plot.y0 + ((y - y0) / (y1 - y0)) * (plot.y1 - plot.y0);

  const drawables: Drawable[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const values: Record<string, number> = {};
  const attached: Record<string, string[]> = {};
  const drawnWith: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};
  const curveSamples: Record<string, Pt[]> = {};
  const push = (d: Drawable, anchor?: Pt): void => {
    drawables.push(d);
    order.push(d.id);
    if (anchor) anchors[d.id] = anchor;
  };

  // ---- axes, through the origin when the range spans it --------------------
  const ox = x0 < 0 && x1 > 0 ? sx(0) : plot.x0;
  const oy = y0 < 0 && y1 > 0 ? sy(0) : plot.y0;
  const axisStyle = defaultStyle({ strokeWidth: 3.5, roughness: 1 });
  push(
    {
      id: "axes",
      kind: "group",
      z: Z_STROKE,
      style: axisStyle,
      drawOpts: defaultDrawOpts("sketch"),
      children: [
        { id: "axes__x", kind: "stroke", pts: [[plot.x0 - 6, oy], [plot.x1 + AXIS_OVERHANG, oy]], arrowhead: "end", z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) },
        { id: "axes__y", kind: "stroke", pts: [[ox, plot.y0 - 6], [ox, plot.y1 + AXIS_OVERHANG]], arrowhead: "end", z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) },
      ],
    },
    [ox, oy],
  );
  const xCaption = typeof P.x_label === "string" && P.x_label.trim() ? P.x_label : m.variable;
  const yCaption = typeof P.y_label === "string" && P.y_label.trim() ? P.y_label : (m.curves[0]?.lhs ?? "y");
  const xl = axisLabelPlacement("x", { ...plot, y0: oy }, xCaption, 26);
  const xLabel = kit.text("x_label", xl.pos, xCaption, { fontSize: 26, anchor: xl.anchor });
  push(xLabel, xl.pos);
  const yl = axisLabelPlacement("y", { ...plot, x0: ox }, yCaption, 26);
  const yLabel = kit.text("y_label", yl.pos, yCaption, { fontSize: 26, anchor: yl.anchor });
  push(yLabel, yl.pos);
  const captionBoxes = [bboxOfText(xLabel, heuristicMeasure), bboxOfText(yLabel, heuristicMeasure)];

  // ---- curves, cut where they leave the y range or jump a pole -------------
  const band = (y1 - y0) * 0.02;
  const lo = y0 - band;
  const hi = y1 + band;
  const curveDrawables: [Drawable, Pt][] = [];
  const curvePolys: Pt[][] = [];
  for (const c of m.curves) {
    const id = `curve_${c.index}`;
    const { xs, ys } = sampleCurve(c, m.env, m.xRange);
    const segs = clipCurve(xs, ys, lo, hi).map((seg) => simplifyPolyline(seg.map(([x, y]): Pt => [sx(x), sy(y)]), 0.4));
    const color = CURVE_COLORS[c.index % CURVE_COLORS.length];
    const strokes = segs.filter((s) => s.length >= 2);
    if (strokes.length === 0) continue;
    const style = defaultStyle({ color, strokeWidth: 4.5 });
    const d: Drawable =
      strokes.length === 1
        ? { id, kind: "stroke", pts: strokes[0], z: Z_STROKE, style, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve) }
        : {
            id,
            kind: "group",
            z: Z_STROKE,
            style,
            drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve),
            children: strokes.map((pts, k) => ({ id: `${id}__s${k}`, kind: "stroke" as const, pts, z: Z_STROKE, style, drawOpts: defaultDrawOpts("sketch", Math.max(400, SKETCH_MS.curve / strokes.length)) })),
          };
    const longest = strokes.reduce((a, b) => (b.length > a.length ? b : a));
    curveDrawables.push([d, longest[longest.length - 1]]);
    curvePolys.push(...strokes);
    curveSamples[id] = longest;
  }

  // Ticks: round numbers, a short mark across the axis and the number
  // beside it; none where the other axis crosses (the origin's 0 would sit
  // on both axes' lines).
  // A number a curve runs through stands aside (it would be unreadable
  // under the ink): the tick mark stays, its number is left out.
  const tickText = (id: string, pos: Pt, s: string, anchor: "start" | "middle" | "end"): Drawable | null => {
    const t = { ...kit.text(id, pos, s, { fontSize: TICK_FONT, color: COLORS.guide, anchor }), drawOpts: defaultDrawOpts("instant") };
    const b = bboxOfText(t, heuristicMeasure);
    const pad = { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 };
    // …and so does one under an axis caption (a long x caption sits below the arrow's end).
    const underCaption = captionBoxes.some((c) => c.x < pad.x + pad.w && c.x + c.w > pad.x && c.y < pad.y + pad.h && c.y + c.h > pad.y);
    return underCaption || curvePolys.some((poly) => polylineIntersectsBox(poly, pad)) ? null : t;
  };
  const xt = niceTicks(x0, x1, 8);
  const xd = Math.max(0, -Math.floor(Math.log10(xt.step) + 1e-9));
  const xChildren: Drawable[] = [];
  for (const v of xt.ticks) {
    const X = sx(v);
    if (Math.abs(X - ox) < 1 && ox !== plot.x0) continue;
    if (X < plot.x0 - 0.5 || X > plot.x1 + 0.5) continue;
    xChildren.push({ ...kit.stroke(`x_ticks__m${xChildren.length}`, [[X, oy - 6], [X, oy + 6]], { color: COLORS.guide, strokeWidth: 2, instant: true }) });
    const label = tickText(`x_ticks__t${xChildren.length}`, [X, oy - 22], kit.num(v, xd), "middle");
    if (label) xChildren.push(label);
  }
  const yt = niceTicks(y0, y1, 6);
  const yd = Math.max(0, -Math.floor(Math.log10(yt.step) + 1e-9));
  const yChildren: Drawable[] = [];
  for (const v of yt.ticks) {
    const Y = sy(v);
    if (Math.abs(Y - oy) < 1 && oy !== plot.y0) continue;
    if (Y < plot.y0 - 0.5 || Y > plot.y1 + 0.5) continue;
    yChildren.push(kit.stroke(`y_ticks__m${yChildren.length}`, [[ox - 6, Y], [ox + 6, Y]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    const label = tickText(`y_ticks__t${yChildren.length}`, [ox - 12, Y - 7], kit.num(v, yd), "end");
    if (label) yChildren.push(label);
  }
  const tickGroup = (id: string, children: Drawable[]): Drawable => ({ id, kind: "group", children, z: Z_TEXT, style: defaultStyle({ color: COLORS.guide }), drawOpts: defaultDrawOpts("instant") });
  if (xChildren.length > 0) push(tickGroup("x_ticks", xChildren), [plot.x1, oy]);
  if (yChildren.length > 0) push(tickGroup("y_ticks", yChildren), [ox, plot.y1]);
  if (P.grid) {
    const lines: Drawable[] = [];
    for (const v of xt.ticks) if (sx(v) > plot.x0 + 1 && Math.abs(sx(v) - ox) > 1) lines.push(kit.stroke(`grid__x${lines.length}`, [[sx(v), plot.y0], [sx(v), plot.y1]], { color: COLORS.guide, strokeWidth: 1, opacity: 0.35, instant: true }));
    for (const v of yt.ticks) if (sy(v) > plot.y0 + 1 && Math.abs(sy(v) - oy) > 1) lines.push(kit.stroke(`grid__y${lines.length}`, [[plot.x0, sy(v)], [plot.x1, sy(v)]], { color: COLORS.guide, strokeWidth: 1, opacity: 0.35, instant: true }));
    if (lines.length > 0) push({ id: "grid", kind: "group", children: lines, z: Z_STROKE - 1, style: defaultStyle({ color: COLORS.guide }), drawOpts: defaultDrawOpts("instant") });
  }
  attached.axes = ["x_label", "y_label", ...(xChildren.length ? ["x_ticks"] : []), ...(yChildren.length ? ["y_ticks"] : [])];
  drawnWith.axes = attached.axes;
  for (const [d, at] of curveDrawables) push(d, at);

  if (m.curves.length > 1) groups.curves = m.curves.map((c) => `curve_${c.index}`).filter((id) => order.includes(id));

  // ---- the equation(s), in the drawing's hand ------------------------------
  const mathjax = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
  const seen = new Map<string, number>();
  const eqIds: string[] = [];
  const paramIdsAll: string[] = [];
  let line = 0;
  for (const c of m.curves) {
    if (!c.node) continue;
    const forms: ("symbols" | "values")[] = m.form === "both" ? ["symbols", "values"] : [m.form];
    for (const form of forms) {
      const base = c.index === 0 ? "eq" : `eq_${c.index}`;
      const id = form === "symbols" && m.form === "both" ? `${base}_symbols` : base;
      const cy = eqTop - EQ_LINE / 2 - line * EQ_LINE;
      line++;
      const ink = m.curves.length > 1 ? CURVE_COLORS[c.index % CURVE_COLORS.length] : COLORS.ink;
      const r = drawEquation(mathjax, { id, lhsTeX: c.lhsTeX, node: c.node, variables: m.variable, set: m, form, center: [eqCx, cy], width: eqWidth, ink, seen });
      for (const d of r.drawables) push(d, r.anchors[d.id]);
      eqIds.push(id);
      if (r.paramIds.length > 0) {
        attached[id] = r.paramIds;
        drawnWith[id] = r.paramIds;
        paramIdsAll.push(...r.paramIds);
      }
    }
  }
  groups.equations = [...eqIds, ...paramIdsAll].filter((id) => order.includes(id));

  // ---- marks --------------------------------------------------------------
  const markColor = COLORS.ink;
  const dot = (id: string, x: number, y: number, color = markColor): void => {
    const c: Pt = [sx(x), sy(y)];
    push(kit.stroke(id, [c], { shapeHint: { type: "circle", c, r: 7 }, color, fill: color, strokeWidth: 2, ms: SKETCH_MS.dot }), c);
  };
  const inView = (x: number, y: number): boolean => Number.isFinite(y) && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const markLabel = (id: string, at: Pt, text: string): void => {
    const pos: Pt = [at[0] + 12, at[1] + 14];
    push(kit.text(id, pos, text, { fontSize: 22, anchor: "start" }), pos);
    const owner = id.replace(/_label$/, "");
    (attached[owner] ??= []).push(id);
  };
  const labelText = (mk: MarkSpec, coords: string): string | null => (mk.label === undefined || mk.label === "" ? null : typeof mk.label === "string" ? mk.label : mk.label === true ? coords : null);
  let points = 0;
  let tangents = 0;
  for (const mk of m.marks) {
    const c = m.curves[mk.curve ?? 0];
    if (!c || !c.node) continue;
    const f = (x: number): number => c.f(x, m.env);
    const sfx = markSuffix(mk);
    if (mk.kind === "roots") {
      rootsOf(f, m.xRange).forEach((r, k) => {
        const id = `root_${k + 1}${sfx}`;
        values[id] = Number(r.toFixed(6));
        if (!inView(r, 0)) return;
        dot(id, r, 0);
        const t = labelText(mk, trim(r));
        if (t) markLabel(`${id}_label`, anchors[id], t);
      });
    } else if (mk.kind === "extrema") {
      let nMax = 0;
      let nMin = 0;
      for (const e of extremaOf(f, m.xRange)) {
        const id = e.kind === "max" ? `max_${++nMax}${sfx}` : `min_${++nMin}${sfx}`;
        values[`${id}_x`] = Number(e.x.toFixed(6));
        values[`${id}_y`] = Number(e.y.toFixed(6));
        if (!inView(e.x, e.y)) continue;
        dot(id, e.x, e.y);
        const t = labelText(mk, `(${trim(e.x)}, ${trim(e.y)})`);
        if (t) markLabel(`${id}_label`, anchors[id], t);
      }
    } else if (mk.kind === "y_intercept") {
      if (!(x0 <= 0 && 0 <= x1)) continue;
      const y = f(0);
      const id = `y_intercept${sfx}`;
      if (!Number.isFinite(y)) continue;
      values[id] = Number(y.toFixed(6));
      if (!inView(0, y)) continue;
      dot(id, 0, y);
      const t = labelText(mk, trim(y));
      if (t) markLabel(`${id}_label`, anchors[id], t);
    } else if (mk.kind === "point" || mk.kind === "tangent") {
      const xAt = typeof mk.at === "number" ? mk.at : typeof mk.at === "string" ? (m.byName.get(mk.at)?.value ?? NaN) : (x0 + x1) / 2;
      const y = f(xAt);
      const n = mk.kind === "point" ? ++points : ++tangents;
      const id = `${mk.kind}${n > 1 ? `_${n}` : ""}${sfx}`;
      if (!Number.isFinite(xAt) || !Number.isFinite(y)) continue;
      values[`${id}_x`] = Number(xAt.toFixed(6));
      values[`${id}_y`] = Number(y.toFixed(6));
      if (mk.kind === "tangent") {
        const k = slopeAt(f, xAt, x1 - x0);
        if (!Number.isFinite(k)) continue;
        values[`${id}_slope`] = Number(k.toFixed(6));
        const seg = clipLine(xAt, y, k, [x0, x1], [y0, y1]);
        if (seg) {
          const pts = seg.map(([x, yy]): Pt => [sx(x), sy(yy)]);
          push(kit.stroke(id, pts, { color: PARAM_COLOR, strokeWidth: 3, ms: SKETCH_MS.connector }), pts[1]);
          if (inView(xAt, y)) {
            const c0: Pt = [sx(xAt), sy(y)];
            drawables.push(kit.stroke(`${id}_dot`, [c0], { shapeHint: { type: "circle", c: c0, r: 7 }, color: PARAM_COLOR, fill: PARAM_COLOR, strokeWidth: 2, ms: SKETCH_MS.dot }));
          }
          const t = labelText(mk, `${kit.say({ en: "slope", nb: "stigning", nn: "stigning", sv: "lutning", da: "hældning", de: "Steigung" })} ${trim(k)}`);
          if (t) markLabel(`${id}_label`, pts[1][1] > plot.y1 - 30 ? [pts[1][0] - 120, pts[1][1] - 40] : pts[1], t);
        }
      } else {
        if (!inView(xAt, y)) continue;
        dot(id, xAt, y);
        // Dashed guides down and across to the axes (the point's own sub-part).
        const c0 = anchors[id];
        drawables.push(kit.stroke(`${id}_guides`, [[c0[0], oy], c0, [ox, c0[1]]], { color: COLORS.guide, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }));
        const t = labelText(mk, `(${trim(xAt)}, ${trim(y)})`);
        if (t) markLabel(`${id}_label`, c0, t);
      }
    }
  }

  // ---- the panel -----------------------------------------------------------
  const panel = drawPanel(panelRows(m.panel, column));
  for (const d of panel.drawables) push(d, panel.anchors[d.id]);
  Object.assign(drawnWith, panel.drawnWith);
  Object.assign(attached, panel.attached);
  if (panel.ids.length > 0) groups.panel = panel.ids;

  // ---- values --------------------------------------------------------------
  for (const p of m.params) values[p.name] = p.value;
  values.x_min = x0;
  values.x_max = x1;
  values.y_min = y0;
  values.y_max = y1;

  return {
    drawables,
    labels: [],
    anchors,
    order,
    curveSamples,
    attached,
    drawnWith,
    groups,
    values,
    frame: { x: [x0, x1], y: [y0, y1], box: plot },
  };
}

/** The curve's samples cut into the pieces that lie in [lo, hi] — each piece
 *  ending exactly on the band's edge where it leaves it — and broken at an
 *  undefined value or a pole (a jump across the whole band between two
 *  neighbouring samples). */
export function clipCurve(xs: number[], ys: number[], lo: number, hi: number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  const flush = (): void => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  const inside = (y: number): boolean => y >= lo && y <= hi;
  const edge = (xa: number, ya: number, xb: number, yb: number, e: number): [number, number] => [xa + ((e - ya) / (yb - ya)) * (xb - xa), e];
  for (let i = 0; i < xs.length; i++) {
    const [x, y] = [xs[i], ys[i]];
    if (!Number.isFinite(y)) {
      flush();
      continue;
    }
    const prevOk = i > 0 && Number.isFinite(ys[i - 1]);
    const [xp, yp] = prevOk ? [xs[i - 1], ys[i - 1]] : [NaN, NaN];
    // A pole: the neighbours sit on opposite sides of the band, far apart.
    if (prevOk && ((yp > hi && y < lo) || (yp < lo && y > hi))) {
      flush();
      continue;
    }
    if (inside(y)) {
      if (cur.length === 0 && prevOk && !inside(yp)) cur.push(edge(xp, yp, x, y, yp > hi ? hi : lo));
      cur.push([x, y]);
    } else if (cur.length > 0 && prevOk) {
      cur.push(edge(xp, yp, x, y, y > hi ? hi : lo));
      flush();
    }
  }
  flush();
  return out;
}

/** The line through (x, y) with slope k, cut to the plot's ranges. */
function clipLine(x: number, y: number, k: number, [x0, x1]: [number, number], [y0, y1]: [number, number]): [number, number][] | null {
  let t0 = x0 - x;
  let t1 = x1 - x;
  if (Math.abs(k) > 1e-12) {
    const ta = (y0 - y) / k;
    const tb = (y1 - y) / k;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (y < y0 || y > y1) return null;
  if (!(t1 > t0)) return null;
  return [
    [x + t0, y + k * t0],
    [x + t1, y + k * t1],
  ];
}
