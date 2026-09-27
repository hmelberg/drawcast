// maxwell_boltzmann: the distribution of molecular speeds (or kinetic
// energies) in a gas, normalised and exact (physics.ts), at one temperature
// or two (or two gases), with what the chemistry lesson marks on it — the
// activation energy's line and the share of molecules beyond it shaded and
// written (computed, not guessed), a catalyst's lower line and the extra
// share it lets through, the most probable / mean / rms speeds — and, since
// that share is often far too thin to see, an optional magnified tail.
//
// The axes are scaled once from t_range (the temperatures the figure is for,
// the widget's bounds too), so a hotter gas FLATTENS and SHIFTS on fixed
// axes. Everything is live: the layout re-runs on each animate frame
// (animate T) and each widget patch; `values` carries the numbers for
// {mb.<key>} tokens.
import { plotArea, type PlotArea } from "../../layout/canvas";
import { COLORS, SKETCH_MS, type Drawable, type Pt } from "../../layout/model";
import { simplifyPolyline } from "../../layout/geometry";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { PARAM_COLOR } from "../params-ui/equation";
import { drawAxes, roundTicks } from "../plot-axes";
import { boltzmannFactor, eMean, eMostProbable, fractionAbove, pdf, vMean, vMostProbable, vRms } from "./physics";
import { axisOfEnergy, readModel, type Curve, type MaxwellParams, type Model } from "./model";

export type { MaxwellParams } from "./model";

const MAIN = COLORS.supply;
const OTHER = COLORS.demand;
const SAMPLES = 240;

/** The plot's box: the page's, less a title's line. */
export function plotBox(title: boolean): PlotArea {
  const page = plotArea();
  return { ...page, y1: page.y1 - (title ? 60 : 0) };
}

const sig = (v: number, n = 6): number => (v === 0 ? 0 : Number(v.toPrecision(n)));

/** A share written for the eye: "46 %", "4.6 %", "0.46 %", or "1 in 3 000" when it is thinner than a tenth of a percent. */
export function shareText(f: number): string {
  if (!(f > 0)) return "0 %";
  const pct = f * 100;
  if (pct >= 10) return `${kit.num(Math.round(pct), 0)} %`;
  if (pct >= 0.1) return `${kit.num(Number(pct.toPrecision(2)), pct >= 1 ? 1 : 2)} %`;
  const n = Number((1 / f).toPrecision(2));
  return `1 in ${n.toLocaleString("en-US").replace(/,/g, " ")}`;
}

/** The curve's label: "300 K", or "N₂ 300 K" with a name. */
export const curveText = (c: Curve): string => `${c.label ? `${c.label} ` : ""}${Math.round(c.T)} K`;

export function layoutMaxwell(P: MaxwellParams): SceneLayout {
  const m = readModel(P);
  const title = typeof P.title === "string" && P.title.trim() ? P.title.trim() : null;
  const plot = plotBox(!!title);
  const X: [number, number] = [0, m.xMax];
  const Y: [number, number] = [0, m.yMax];
  const sx = (x: number): number => plot.x0 + (x / m.xMax) * (plot.x1 - plot.x0);
  const sy = (y: number): number => plot.y0 + (Math.min(m.yMax, Math.max(0, y)) / m.yMax) * (plot.y1 - plot.y0);
  const f = (c: Curve, x: number): number => pdf(m.mode, x, c.T, c.M);

  const drawables: Drawable[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const values: Record<string, number> = {};
  const attached: Record<string, string[]> = {};
  const drawnWith: Record<string, string[]> = {};
  const curveSamples: Record<string, Pt[]> = {};
  const push = (d: Drawable, at: Pt): void => {
    drawables.push(d);
    order.push(d.id);
    anchors[d.id] = at;
  };
  const follow = (owner: string, ids: string[]): void => {
    attached[owner] = [...(attached[owner] ?? []), ...ids];
    drawnWith[owner] = [...(drawnWith[owner] ?? []), ...ids];
  };
  const xs = (a: number, b: number, n = SAMPLES): number[] => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

  // ---- axes -----------------------------------------------------------------
  const xt = roundTicks(0, m.xMax, 8);
  const axes = drawAxes({
    plot,
    x: X,
    y: Y,
    xTicks: xt.ticks,
    xDecimals: xt.decimals,
    yTicks: [],
    yDecimals: 0,
    yNumbers: false,
    xCaption: typeof P.x_label === "string" && P.x_label.trim() ? P.x_label : m.mode === "speed" ? "speed (m/s)" : "kinetic energy (kJ/mol)",
    yCaption: typeof P.y_label === "string" && P.y_label.trim() ? P.y_label : "fraction of molecules",
  });
  axes.drawables.forEach((d) => push(d, axes.anchors[d.id]));
  Object.assign(attached, axes.attached);
  Object.assign(drawnWith, axes.drawnWith);

  const curves: [string, Curve, string][] = [["curve", m.main, MAIN], ...(m.compare ? [["compare_curve", m.compare, OTHER] as [string, Curve, string]] : [])];
  const eaAt = (c: Curve): number | null => (m.ea === null ? null : axisOfEnergy(m.mode, m.ea, c.M));
  // Where the magnified tail starts: the lowest barrier drawn.
  const tailFrom = (c: Curve): number => axisOfEnergy(m.mode, Math.min(m.ea ?? Infinity, m.eaCat ?? Infinity), c.M);
  const zoom = m.ea !== null && m.tailZoom !== null ? m.tailZoom : 1;
  // What is drawn beyond Ea: the curve itself, or its magnified tail.
  const tailY = (c: Curve, x: number): number => f(c, x) * zoom;

  // ---- the shaded shares beyond Ea (behind the curves) ------------------------
  const shadeUnder = (id: string, c: Curve, a: number, b: number, color: string, opacity: number, scale: number): void => {
    if (!(b > a) || a >= m.xMax) return;
    const top = xs(a, Math.min(b, m.xMax), 120).map((x): Pt => [sx(x), sy(f(c, x) * scale)]);
    const ring: Pt[] = [[sx(a), plot.y0], ...top, [top[top.length - 1][0], plot.y0]];
    push(kit.area(id, simplifyPolyline(ring, 0.2), color, { opacity, ms: SKETCH_MS.region }), [sx(a) + 20, plot.y0 + 20]);
  };
  if (m.ea !== null) {
    if (m.compare) shadeUnder("compare_shade", m.compare, eaAt(m.compare)!, m.xMax, OTHER, 0.28, zoom);
    shadeUnder("shade", m.main, eaAt(m.main)!, m.xMax, COLORS.region1, 0.6, zoom);
    if (m.eaCat !== null && m.eaCat < m.ea) shadeUnder("catalyst_shade", m.main, axisOfEnergy(m.mode, m.eaCat, m.main.M), eaAt(m.main)!, COLORS.region2, 0.55, zoom);
  }

  // ---- the curves -----------------------------------------------------------
  for (const [id, c, color] of [...curves].reverse()) {
    const pts = simplifyPolyline(xs(0, m.xMax).map((x): Pt => [sx(x), sy(f(c, x))]), 0.3);
    push(kit.stroke(id, pts, { color, strokeWidth: 4.5, ms: SKETCH_MS.curve }), pts[Math.round(pts.length / 4)]);
    curveSamples[id] = pts;
  }
  // The magnified tails, dashed, from Ea on — and the main curve's stretch
  // between the catalyst's barrier and Eₐ, which comes with the catalyst.
  if (zoom > 1) {
    const zoomIds: string[] = [];
    const dashed = (tid: string, c: Curve, a: number, b: number, color: string): void => {
      if (a >= m.xMax || !(b > a)) return;
      const pts = simplifyPolyline(xs(a, Math.min(b, m.xMax), 120).map((x): Pt => [sx(x), sy(tailY(c, x))]), 0.3);
      push(kit.stroke(tid, pts, { color, strokeWidth: 3, dash: true, ms: SKETCH_MS.curve }), pts[0]);
    };
    for (const [id, c, color] of [...curves].reverse()) {
      const tid = id === "curve" ? "tail" : "compare_tail";
      dashed(tid, c, eaAt(c)!, m.xMax, color);
      if (order.includes(tid)) zoomIds.push(tid);
    }
    const cat = tailFrom(m.main);
    if (m.eaCat !== null && cat < eaAt(m.main)!) dashed("catalyst_tail", m.main, cat, eaAt(m.main)!, MAIN);
    if (zoomIds.length > 0) {
      const a = eaAt(m.main)!;
      const xz = a + (m.xMax - a) * 0.45;
      const yTop = Math.max(...curves.map(([, c]) => tailY(c, xz)));
      const at: Pt = [sx(xz), sy(yTop) + 16];
      push(kit.text("zoom_label", at, `×${zoomText(zoom)}`, { fontSize: 22, anchor: "start", color: COLORS.guide }), at);
      follow(zoomIds[zoomIds.length - 1], ["zoom_label"]);
    }
  }

  // ---- Ea and the catalyst's line --------------------------------------------
  const lineTo = (id: string, x: number, h: number, dash: boolean, labelId: string, text: string, side: "top" | "left"): void => {
    const X0 = sx(x);
    const top = plot.y0 + (plot.y1 - plot.y0) * h;
    push(kit.stroke(id, [[X0, plot.y0], [X0, top]], { color: PARAM_COLOR, strokeWidth: 3.5, dash, ms: SKETCH_MS.priceLine }), [X0, top]);
    // Over the line's top — or, for the catalyst's, beside it on the left, clear of the tail it opens.
    const at: Pt = side === "top" ? [X0, top + 12] : [X0 - 10, top - 18];
    push(kit.text(labelId, at, text, { fontSize: 24, anchor: side === "top" ? "middle" : "end", color: PARAM_COLOR }), at);
    follow(id, [labelId]);
  };
  if (m.ea !== null) {
    const a = eaAt(m.main)!;
    values.ea = m.ea;
    if (a <= m.xMax) lineTo("ea_line", a, 0.72, false, "ea_label", "Eₐ", "top");
    if (m.eaCat !== null) {
      values.ea_catalyst = m.eaCat;
      const ac = axisOfEnergy(m.mode, m.eaCat, m.main.M);
      // As tall as the (magnified) tail it opens, at least.
      const reach = Math.max(0.56, Math.min(0.9, (tailY(m.main, ac) * (zoom > 1 ? 1 : 0)) / m.yMax + 0.08));
      if (ac <= m.xMax) lineTo("ea_cat_line", ac, reach, true, "ea_cat_label", "catalyst", "left");
      if (order.includes("catalyst_tail")) follow("ea_cat_line", ["catalyst_tail"]);
    }
  }

  // ---- speed marks (main curve) ------------------------------------------------
  const marks: [string, number, string][] = [];
  if (m.mode === "speed") {
    if (m.speeds.has("mp")) marks.push(["mp", vMostProbable(m.main.T, m.main.M), "peak"]);
    if (m.speeds.has("mean")) marks.push(["mean", vMean(m.main.T, m.main.M), "mean"]);
    if (m.speeds.has("rms")) marks.push(["rms", vRms(m.main.T, m.main.M), "rms"]);
  } else {
    if (m.speeds.has("mp")) marks.push(["mp", eMostProbable(m.main.T), "peak"]);
    if (m.speeds.has("mean")) marks.push(["mean", eMean(m.main.T), "mean"]);
  }
  const peakY = sy(f(m.main, m.mode === "speed" ? vMostProbable(m.main.T, m.main.M) : eMostProbable(m.main.T)));
  marks.forEach(([key, x, text], k) => {
    const X0 = sx(x);
    // Each line rises past the curve to its word; the words step up, one a row, so neighbours never meet.
    const top = peakY + 22 + 30 * k;
    push(kit.stroke(`${key}_line`, [[X0, plot.y0], [X0, top]], { color: COLORS.ink, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }), [X0, top]);
    const at: Pt = [X0, top + 8];
    push(kit.text(`${key}_label`, at, text, { fontSize: 20, anchor: "middle" }), at);
    follow(`${key}_line`, [`${key}_label`]);
  });

  // ---- the shares, written -----------------------------------------------------
  const fMain = m.ea !== null ? fractionAbove(m.ea, m.main.T) : null;
  const fOther = m.ea !== null && m.compare ? fractionAbove(m.ea, m.compare.T) : null;
  if (m.ea !== null && m.showFraction) {
    const a = eaAt(m.main)!;
    if (a < m.xMax) {
      // Right of the Ea line, above whatever is drawn there.
      const x0 = sx(a) + 14;
      const reach = [a, a + (m.xMax * 150) / (plot.x1 - plot.x0)];
      let high = 0;
      for (const [, c] of curves) for (const x of xs(reach[0], Math.min(m.xMax, reach[1]), 20)) high = Math.max(high, f(c, x), tailY(c, x));
      const y0 = Math.min(sy(high) + 28, plot.y0 + (plot.y1 - plot.y0) * 0.62);
      const rows: [string, number, string][] = [["fraction_label", fMain!, MAIN]];
      if (fOther !== null) rows.push(["compare_fraction_label", fOther, OTHER]);
      rows.forEach(([id, share, color], k) => {
        const at: Pt = [x0, y0 + 30 * (rows.length - 1 - k)];
        push(kit.text(id, at, shareText(share), { fontSize: 22, anchor: "start", color }), at);
      });
      follow("shade", ["fraction_label"]);
      if (fOther !== null) follow("compare_shade", ["compare_fraction_label"]);
    }
  }

  // ---- the curves' names (the temperatures, scrubbable) ------------------------
  curves.forEach(([id, c, color], k) => {
    const lid = id === "curve" ? "curve_label" : "compare_label";
    const at: Pt = [plot.x1 - 6, plot.y1 - 26 - 32 * k];
    push(kit.text(lid, at, curveText(c), { fontSize: 24, anchor: "end", color }), at);
    follow(id, [lid]);
  });

  if (title) {
    const at: Pt = [500, plot.y1 + 88];
    push(kit.text("title", at, title, { fontSize: 30, anchor: "middle" }), at);
  }

  // ---- values -------------------------------------------------------------------
  const { T, M } = m.main;
  Object.assign(values, {
    T,
    molar_mass: M,
    v_mp: sig(vMostProbable(T, M)),
    v_mean: sig(vMean(T, M)),
    v_rms: sig(vRms(T, M)),
    e_mp: sig(eMostProbable(T)),
    e_mean: sig(eMean(T)),
  });
  if (fMain !== null) {
    values.fraction_above = sig(fMain);
    values.percent_above = sig(fMain * 100, 4);
    values.boltzmann_factor = sig(boltzmannFactor(m.ea!, T));
  }
  if (m.eaCat !== null && fMain !== null) {
    const fc = fractionAbove(m.eaCat, T);
    values.fraction_above_cat = sig(fc);
    values.catalyst_ratio = sig(fc / fMain, 4);
  }
  if (m.compare) {
    const c = m.compare;
    Object.assign(values, { T2: c.T, molar_mass_2: c.M, v_mp_2: sig(vMostProbable(c.T, c.M)), v_mean_2: sig(vMean(c.T, c.M)), v_rms_2: sig(vRms(c.T, c.M)) });
    if (fOther !== null && fMain !== null) {
      values.fraction_above_2 = sig(fOther);
      values.percent_above_2 = sig(fOther * 100, 4);
      values.ratio = sig(fOther / fMain, 4);
    }
  }

  return {
    drawables,
    labels: [],
    anchors,
    order,
    curveSamples,
    attached,
    drawnWith,
    values,
    frame: { x: X, y: Y, box: plot },
  };
}

/** A magnification written short: 100, 1 000, 10⁶. */
export function zoomText(k: number): string {
  const e = Math.log10(k);
  if (Math.abs(e - Math.round(e)) < 1e-9 && e >= 5) return `10${String(Math.round(e)).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)])}`;
  return Number(k.toPrecision(3)).toLocaleString("en-US").replace(/,/g, " ");
}

export type { Model };
