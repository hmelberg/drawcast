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
import { COLORS, Z_STROKE, Z_TEXT, SKETCH_MS, defaultDrawOpts, defaultStyle, type Drawable, type Pt, type TextDrawable } from "../../layout/model";
import { bboxOfText, polylineIntersectsBox, simplifyPolyline } from "../../layout/geometry";
import { heuristicMeasure } from "../../layout/measure";
import { getLoadedEngines, type MathJaxEngine } from "../engines";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { drawEquation, equationTeX } from "../params-ui/equation";
import { drawPanel, panelRows, PANEL_W } from "../params-ui/panel";
import { autoYRange, extremaOf, fromU, logTicks, markAt, markColor as drivenColor, markIds, niceTicks, readModel, rootsOf, sampleCurve, slopeAt, toU, yNeeds, type EquationPlotParams, type MarkSpec, type Model } from "./model";
import { withPreset } from "./presets";

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

/** The y range drawn: the author's (or the preset's), else the calm auto range of every curve and hline. */
export function yRangeOf(m: Model, P: EquationPlotParams): [number, number] {
  const yr = withPreset(P).y_range;
  if (Array.isArray(yr) && Number.isFinite(yr[0]) && Number.isFinite(yr[1]) && yr[1] > yr[0]) return [yr[0], yr[1]];
  return autoYRange(yNeeds(m));
}

/** Ids of the marks, in their order: what the manifest documents. */
function markSuffix(mk: MarkSpec): string {
  return (mk.curve ?? 0) > 0 ? `_c${mk.curve}` : "";
}

/** A mark's words may be written a little shorter than the page allows. */
const MARK_FONT = 22;

const trim = (v: number, d = 2): string => {
  const s = kit.num(Number(v.toFixed(d)));
  return s === "-0" ? "0" : s;
};

/** Room between the last equation line's ink and the plot's top. */
const EQ_PLOT_GAP = 54;
/** Room between two equation lines' ink. */
const EQ_GAP = 10;

/** Move a drawable (and its children) up or down in place. */
function shiftY(d: Drawable, dy: number): void {
  if (d.kind === "group") for (const c of d.children) shiftY(c, dy);
  else if (d.kind === "area") {
    d.pts = d.pts.map(([x, y]): Pt => [x, y + dy]);
    if (d.holes) d.holes = d.holes.map((h) => h.map(([x, y]): Pt => [x, y + dy]));
  } else if (d.kind === "stroke") d.pts = d.pts.map(([x, y]): Pt => [x, y + dy]);
  else if (d.kind === "text") d.pos = [d.pos[0], d.pos[1] + dy];
}

/** The ink's lowest and highest y (canvas y runs up). */
function inkSpan(ds: Drawable[]): [number, number] | null {
  const ys: number[] = [];
  const walk = (d: Drawable): void => {
    if (d.kind === "group") d.children.forEach(walk);
    else if (d.kind === "area" || d.kind === "stroke") for (const p of d.pts) ys.push(p[1]);
  };
  ds.forEach(walk);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

/**
 * The parts that write a parameter's LETTER (a symbols line's
 * eq_param_<name>[_k]), numbered as layoutEquations numbers them — every
 * line in turn, the symbols line first. What lights while the viewer changes
 * the parameter: a letter never changes under the drag, a number would.
 */
export function letterParts(m: Model): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const c of m.curves) {
    if (!c.node) continue;
    const forms: ("symbols" | "values")[] = m.form === "both" ? ["symbols", "values"] : [m.form];
    for (const form of forms)
      for (const name of equationTeX({ lhsTeX: c.lhsTeX, node: c.node, variables: m.variable, set: m, form }).order) {
        const k = (seen.get(name) ?? 0) + 1;
        seen.set(name, k);
        if (form === "symbols") out.push(`eq_param_${name}${k > 1 ? `_${k}` : ""}`);
      }
  }
  return out;
}

/**
 * The equation lines, top down from the page's top: each at its usual
 * height, and a line whose ink reaches into the one above (a fraction under
 * a fraction) moved down clear of it. `bottom` is the last line's lowest ink.
 */
function layoutEquations(m: Model, eqTop: number, eqCx: number, eqWidth: number): { lines: (ReturnType<typeof drawEquation> & { id: string })[]; bottom: number } {
  const mathjax = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
  const seen = new Map<string, number>();
  const lines: (ReturnType<typeof drawEquation> & { id: string })[] = [];
  let line = 0;
  let floor = eqTop;
  let bottom = eqTop - EQ_LINE;
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
      const span = inkSpan(r.drawables);
      if (span) {
        const dy = Math.min(0, floor - span[1]);
        if (dy < 0) {
          for (const d of r.drawables) shiftY(d, dy);
          for (const k of Object.keys(r.anchors)) r.anchors[k] = [r.anchors[k][0], r.anchors[k][1] + dy];
        }
        floor = span[0] + dy - EQ_GAP;
        bottom = Math.min(cy - EQ_LINE / 2, span[0] + dy);
      }
      lines.push({ ...r, id });
    }
  }
  return { lines, bottom };
}

export function layoutEquationPlot(raw: EquationPlotParams): SceneLayout {
  const P = withPreset(raw);
  const m = readModel(P);
  const { plot, eqTop, eqCx, eqWidth, panel: column } = pageGeometry(m);
  const eqs = layoutEquations(m, eqTop, eqCx, eqWidth);
  // A tall line (a fraction, two stacked) pushes the plot's top down.
  plot.y1 = Math.min(plot.y1, eqs.bottom - EQ_PLOT_GAP);
  const [x0, x1] = m.xRange;
  const [y0, y1] = yRangeOf(m, P);
  const log = m.xScale === "log";
  const [u0, u1] = [toU(m.xScale, x0), toU(m.xScale, x1)];
  const sx = (x: number): number => plot.x0 + ((toU(m.xScale, x) - u0) / (u1 - u0)) * (plot.x1 - plot.x0);
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
  const ox = !log && x0 < 0 && x1 > 0 ? sx(0) : plot.x0;
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
    const { xs, ys } = sampleCurve(c, m.env, m.xRange, undefined, m.xScale);
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
  // A point mark's words at the feet of its guides ("Km" under the x axis,
  // "Vmax/2" left of the y axis) sit where tick numbers sit: worked out
  // first, so a number they would cover stands aside like one under a curve.
  const ids = markIds(m.marks);
  const markId = (mk: MarkSpec): string => ids.get(mk) ?? mk.kind;
  const feet = new Map<MarkSpec, { x?: TextDrawable; y?: TextDrawable }>();
  for (const mk of m.marks) {
    if (mk.kind !== "point" || (!mk.x_label && !mk.y_label)) continue;
    const c = m.curves[mk.curve ?? 0];
    if (!c || !c.node) continue;
    const xAt = markAt(mk, m);
    const y = c.f(xAt, m.env);
    if (!(Number.isFinite(xAt) && Number.isFinite(y) && xAt >= x0 && xAt <= x1 && y >= y0 && y <= y1)) continue;
    const id = markId(mk);
    const foot: { x?: TextDrawable; y?: TextDrawable } = {};
    // Two feet that would overlap (Km and the apparent Km close together)
    // step apart: the later one a row further from its axis.
    const clear = (make: (row: number) => TextDrawable): TextDrawable => {
      for (let row = 0; ; row++) {
        const t = make(row);
        const b = bboxOfText(t, heuristicMeasure);
        const hit = [...feet.values()].flatMap((f) => [f.x, f.y]).some((o) => {
          if (!o) return false;
          const q = bboxOfText(o, heuristicMeasure);
          return q.x < b.x + b.w + 4 && q.x + q.w + 4 > b.x && q.y < b.y + b.h && q.y + q.h > b.y;
        });
        if (!hit || row >= 2) return t;
      }
    };
    if (typeof mk.x_label === "string" && mk.x_label.trim()) {
      const text = mk.x_label;
      foot.x = clear((row) => kit.text(`${id}_x_label`, [sx(xAt), oy - 22 - row * 24], text, { fontSize: MARK_FONT, anchor: "middle" }));
    }
    if (typeof mk.y_label === "string" && mk.y_label.trim()) {
      const text = mk.y_label;
      foot.y = clear((row) => kit.text(`${id}_y_label`, [ox - 12, sy(y) - 7 - row * 24], text, { fontSize: MARK_FONT, anchor: "end" }));
    }
    feet.set(mk, foot);
  }
  const footBoxes = [...feet.values()].flatMap((f) => [f.x, f.y]).filter((d): d is TextDrawable => !!d).map((d) => bboxOfText(d, heuristicMeasure));
  const tickText = (id: string, pos: Pt, s: string, anchor: "start" | "middle" | "end"): Drawable | null => {
    const t = { ...kit.text(id, pos, s, { fontSize: TICK_FONT, color: COLORS.guide, anchor }), drawOpts: defaultDrawOpts("instant") };
    const b = bboxOfText(t, heuristicMeasure);
    const pad = { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 };
    // …and so does one under an axis caption (a long x caption sits below the arrow's end) or a mark's foot.
    const underCaption = [...captionBoxes, ...footBoxes].some((c) => c.x < pad.x + pad.w && c.x + c.w > pad.x && c.y < pad.y + pad.h && c.y + c.h > pad.y);
    return underCaption || curvePolys.some((poly) => polylineIntersectsBox(poly, pad)) ? null : t;
  };
  // A log axis: powers of ten (with 2s and 5s over a short span).
  const xt = log ? { step: NaN, ticks: logTicks(x0, x1) } : niceTicks(x0, x1, 8);
  const yTicks0 = niceTicks(y0, y1, 6).ticks[0] ?? NaN;
  const xDigits = (v: number): number => (log ? Math.max(0, -Math.floor(Math.log10(v) + 1e-9)) : Math.max(0, -Math.floor(Math.log10(xt.step) + 1e-9)));
  const xChildren: Drawable[] = [];
  for (const v of xt.ticks) {
    const X = sx(v);
    if (Math.abs(X - ox) < 1 && ox !== plot.x0) continue;
    if (X < plot.x0 - 0.5 || X > plot.x1 + 0.5) continue;
    xChildren.push({ ...kit.stroke(`x_ticks__m${xChildren.length}`, [[X, oy - 6], [X, oy + 6]], { color: COLORS.guide, strokeWidth: 2, instant: true }) });
    // At the y axis the number would sit on the axis's line (x axis mid-plot)
    // or on the y axis's own number at the corner (a log axis's 0.001 on its 0).
    const corner = Math.abs(X - ox) < 1 && (oy !== plot.y0 || (ox === plot.x0 && Math.abs(yTicks0 - y0) < 1e-9 && (log || kit.num(v, xDigits(v)) !== "0")));
    const label = corner ? null : tickText(`x_ticks__t${xChildren.length}`, [X, oy - 22], kit.num(v, xDigits(v)), "middle");
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

  // ---- the equation(s), in the drawing's hand (laid out above) --------------
  const eqIds: string[] = [];
  const paramIdsAll: string[] = [];
  for (const r of eqs.lines) {
    for (const d of r.drawables) push(d, r.anchors[d.id]);
    eqIds.push(r.id);
    if (r.paramIds.length > 0) {
      attached[r.id] = r.paramIds;
      drawnWith[r.id] = r.paramIds;
      paramIdsAll.push(...r.paramIds);
    }
  }
  groups.equations = [...eqIds, ...paramIdsAll].filter((id) => order.includes(id));

  // ---- marks --------------------------------------------------------------
  const markColor: string = COLORS.ink;
  const dot = (id: string, x: number, y: number, color = markColor): void => {
    const c: Pt = [sx(x), sy(y)];
    push(kit.stroke(id, [c], { shapeHint: { type: "circle", c, r: 7 }, color, fill: color, strokeWidth: 2, ms: SKETCH_MS.dot }), c);
  };
  const inView = (x: number, y: number): boolean => Number.isFinite(y) && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const markLabel = (id: string, at: Pt, text: string): void => {
    let pos: Pt = [at[0] + 12, at[1] + 14];
    let t = kit.text(id, pos, text, { fontSize: 22, anchor: "start" });
    // A word that would run past the plot's right edge (into a panel) turns to the mark's left.
    const b = bboxOfText(t, heuristicMeasure);
    if (b.x + b.w > plot.x1 + 10) {
      pos = [at[0] - 12, at[1] + 14];
      t = kit.text(id, pos, text, { fontSize: 22, anchor: "end" });
    }
    push(t, pos);
    const owner = id.replace(/_label$/, "");
    (attached[owner] ??= []).push(id);
    // …and comes with the mark's draw, not at the cast's end.
    (drawnWith[owner] ??= []).push(id);
  };
  const labelText = (mk: MarkSpec, coords: string): string | null => (mk.label === undefined || mk.label === "" ? null : typeof mk.label === "string" ? mk.label : mk.label === true ? coords : null);
  // Roots and turning points are found along the page's own axis (in powers
  // of ten on a log axis — the same points, sampled where they are drawn).
  const onAxis = (f: (x: number) => number): ((u: number) => number) => (u) => f(fromU(m.xScale, u));
  const uRange: [number, number] = [u0, u1];
  // A line's word and a point's axis-foot words follow their mark, and come with its draw.
  const attach = (owner: string, id: string): void => {
    (attached[owner] ??= []).push(id);
    (drawnWith[owner] ??= []).push(id);
  };
  for (const mk of m.marks) {
    const c = m.curves[mk.curve ?? 0];
    if (!c || !c.node) continue;
    const f = (x: number): number => c.f(x, m.env);
    const sfx = markSuffix(mk);
    // A mark whose `at` follows a parameter is drawn in that parameter's colour.
    const driven = drivenColor(mk, m);
    if (mk.kind === "hline" || mk.kind === "vline") {
      const id = markId(mk);
      const v = markAt(mk, m);
      if (!Number.isFinite(v)) continue;
      values[id] = Number(v.toFixed(6));
      const t = typeof mk.label === "string" && mk.label.trim() ? mk.label : mk.label === true ? trim(v) : null;
      if (mk.kind === "hline") {
        if (v < y0 || v > y1) continue;
        const Y = sy(v);
        push(kit.stroke(id, [[plot.x0, Y], [plot.x1, Y]], { color: driven ?? COLORS.guide, strokeWidth: 2.5, dash: true, ms: SKETCH_MS.guides }), [plot.x1, Y]);
        // Its word at the end of the line the curves keep farther from (an
        // asymptote's curve hugs it at one end), on the side away from them.
        if (t) {
          const near = (left: boolean): { gap: number; above: boolean } => {
            let gap = Infinity;
            let above = false;
            for (const cv of m.curves) {
              if (!cv.node) continue;
              for (let i = 0; i <= 12; i++) {
                const u = left ? u0 + ((u1 - u0) * i) / 60 : u1 - ((u1 - u0) * i) / 60;
                const yy = cv.f(fromU(m.xScale, u), m.env);
                if (!Number.isFinite(yy)) continue;
                const d = Math.abs(sy(yy) - Y);
                if (d < gap) [gap, above] = [d, sy(yy) > Y];
              }
            }
            return { gap, above };
          };
          const [l, r] = [near(true), near(false)];
          const left = l.gap > r.gap + 1;
          const side = left ? l : r;
          const pos: Pt = [left ? ox + 12 : plot.x1 - 4, side.above && side.gap < 40 ? Y - 26 : Y + 10];
          push(kit.text(`${id}_label`, pos, t, { fontSize: MARK_FONT, anchor: left ? "start" : "end" }), pos);
          attach(id, `${id}_label`);
        }
      } else {
        if (v < x0 || v > x1) continue;
        const X = sx(v);
        push(kit.stroke(id, [[X, plot.y0], [X, plot.y1]], { color: driven ?? COLORS.guide, strokeWidth: 2.5, dash: true, ms: SKETCH_MS.guides }), [X, plot.y1]);
        if (t) {
          const pos: Pt = [X + 8, plot.y1 - 24];
          push(kit.text(`${id}_label`, pos, t, { fontSize: MARK_FONT, anchor: "start" }), pos);
          attach(id, `${id}_label`);
        }
      }
      continue;
    }
    if (mk.kind === "roots") {
      rootsOf(onAxis(f), uRange).map((u) => fromU(m.xScale, u)).forEach((r, k) => {
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
      for (const e of extremaOf(onAxis(f), uRange).map((e) => ({ ...e, x: fromU(m.xScale, e.x) }))) {
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
      const xAt = mk.at === undefined ? fromU(m.xScale, (u0 + u1) / 2) : markAt(mk, m);
      const y = f(xAt);
      const id = markId(mk);
      if (!Number.isFinite(xAt) || !Number.isFinite(y)) continue;
      values[`${id}_x`] = Number(xAt.toFixed(6));
      values[`${id}_y`] = Number(y.toFixed(6));
      if (mk.kind === "tangent") {
        // A straight tangent is a curve on a log axis: not drawn there (the lint says so).
        if (log) continue;
        const k = slopeAt(f, xAt, x1 - x0);
        if (!Number.isFinite(k)) continue;
        values[`${id}_slope`] = Number(k.toFixed(6));
        const seg = clipLine(xAt, y, k, [x0, x1], [y0, y1]);
        if (seg) {
          const pts = seg.map(([x, yy]): Pt => [sx(x), sy(yy)]);
          push(kit.stroke(id, pts, { color: driven ?? COLORS.ink, strokeWidth: 3, ms: SKETCH_MS.connector }), pts[1]);
          if (inView(xAt, y)) {
            const c0: Pt = [sx(xAt), sy(y)];
            drawables.push(kit.stroke(`${id}_dot`, [c0], { shapeHint: { type: "circle", c: c0, r: 7 }, color: driven ?? COLORS.ink, fill: driven ?? COLORS.ink, strokeWidth: 2, ms: SKETCH_MS.dot }));
          }
          const t = labelText(mk, `${kit.say({ en: "slope", nb: "stigning", nn: "stigning", sv: "lutning", da: "hældning", de: "Steigung" })} ${trim(k)}`);
          if (t) markLabel(`${id}_label`, pts[1][1] > plot.y1 - 30 ? [pts[1][0] - 120, pts[1][1] - 40] : pts[1], t);
        }
      } else {
        if (!inView(xAt, y)) continue;
        dot(id, xAt, y, driven ?? markColor);
        // Dashed guides down and across to the axes (the point's own sub-part).
        const c0 = anchors[id];
        drawables.push(kit.stroke(`${id}_guides`, [[c0[0], oy], c0, [ox, c0[1]]], { color: COLORS.guide, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }));
        const t = labelText(mk, `(${trim(xAt)}, ${trim(y)})`);
        if (t) markLabel(`${id}_label`, c0, t);
        const foot = feet.get(mk);
        for (const d of [foot?.x, foot?.y]) {
          if (!d) continue;
          push(d, d.pos);
          attach(id, d.id);
        }
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
    // On a log axis the frame is linear in log10 x: what a domain point means there.
    frame: { x: log ? [u0, u1] : [x0, x1], y: [y0, y1], box: plot },
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
