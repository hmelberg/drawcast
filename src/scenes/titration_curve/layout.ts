// titration_curve: pH against the volume of titrant added, computed exactly
// (chem.ts: the charge balance's root at every volume), with what a teacher
// marks on it — the equivalence point(s), half-equivalence where pH = pKa,
// the buffer region, an indicator's colour-change band — a volume cursor
// with its readout, an optional second curve to compare (a strong acid
// beside a weak one), the numbers the curve is made of written above it
// (each its own part, scrubbed or typed while paused), and an optional
// burette over a flask whose liquid takes the indicator's colour.
//
// Everything is live: the layout re-runs on each animate frame (animate `v`
// and the titrant runs in) and each widget patch; `values` carries the
// numbers for {titration.<key>} tokens.
import { plotArea, type PlotArea } from "../../layout/canvas";
import { COLORS, SKETCH_MS, type Drawable, type Pt } from "../../layout/model";
import { simplifyPolyline } from "../../layout/geometry";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { PARAM_COLOR } from "../params-ui/equation";
import { drawAxes, roundTicks } from "../plot-axes";
import { equivalenceVolumes, indicatorColor, isAcid, isWeak, phAt, sampleCurve, volumeAtPh, type Titration } from "./chem";
import { readModel, type Model, type TitrationParams } from "./model";

export type { TitrationParams } from "./model";

const MAIN = COLORS.supply;
const OTHER = COLORS.demand;
const LEGEND_FONT = 24;
const LEGEND_GAP = 11;
const FLASK_W = 150;

/** Where the plot, the numbers' line and the flask go. */
export function pageGeometry(m: Model, title: boolean): { plot: PlotArea; legendY: number; flaskX: number } {
  const page = plotArea();
  const top = page.y1 - (title ? 40 : 0);
  // The numbers' line sits above the y axis's caption, which sits above its arrow.
  const plot: PlotArea = { ...page, y1: top - (m.numbers ? 84 : 0) };
  if (m.flask) plot.x1 = 1000 - 25 - FLASK_W - 60;
  return { plot, legendY: top - 8, flaskX: 1000 - 25 - FLASK_W };
}

/** The numbers' line: which parts it has, in order — words, and numbers with the key they edit. */
export type LegendPiece = { text: string } | { key: "c_analyte" | "v_analyte" | "c_titrant" | "pka"; index?: number; value: number; decimals: number };

/** Decimals a concentration is written with: 2, or 3 when it needs them. */
export const concDecimals = (c: number): number => (Math.abs(c * 100 - Math.round(c * 100)) > 1e-6 ? 3 : 2);

export function legendPieces(m: Model): LegendPiece[] {
  const t = m.main;
  const out: LegendPiece[] = [
    { text: m.analyte },
    { key: "c_analyte", value: t.ca, decimals: concDecimals(t.ca) },
    { text: "M," },
    { key: "v_analyte", value: t.va, decimals: Number.isInteger(t.va) ? 0 : 1 },
    { text: "mL" },
    { text: "·" },
    { text: m.titrant },
    { key: "c_titrant", value: t.ct, decimals: concDecimals(t.ct) },
    { text: "M" },
  ];
  if (isWeak(t.kind)) {
    out.push({ text: "·" }, { text: "pKa" });
    t.pkas.forEach((p, i) => {
      if (i > 0) out.push({ text: "," });
      out.push({ key: "pka", index: i, value: p, decimals: 2 });
    });
  }
  return out;
}

/** A legend number's part id: num_c_analyte, num_pka, num_pka_2 … */
export const legendId = (p: { key: string; index?: number }): string => `num_${p.key}${p.index ? `_${p.index + 1}` : ""}`;

const r3 = (v: number): number => Number(v.toFixed(3));

export function layoutTitration(P: TitrationParams): SceneLayout {
  const m = readModel(P);
  const title = typeof P.title === "string" && P.title.trim() ? P.title.trim() : null;
  const { plot, legendY, flaskX } = pageGeometry(m, !!title);
  const X: [number, number] = [0, m.vMax];
  const Y: [number, number] = [0, 14];
  const sx = (v: number): number => plot.x0 + (v / m.vMax) * (plot.x1 - plot.x0);
  const sy = (p: number): number => plot.y0 + (Math.min(14, Math.max(0, p)) / 14) * (plot.y1 - plot.y0);

  const drawables: Drawable[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const values: Record<string, number> = {};
  const attached: Record<string, string[]> = {};
  const drawnWith: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};
  const curveSamples: Record<string, Pt[]> = {};
  const push = (d: Drawable, at: Pt): void => {
    drawables.push(d);
    order.push(d.id);
    anchors[d.id] = at;
  };
  const follow = (owner: string, id: string): void => {
    (attached[owner] ??= []).push(id);
  };

  // ---- the indicator's band, behind everything ------------------------------
  if (m.indicator) {
    const ind = m.indicator;
    const [y0, y1] = [sy(ind.lo), sy(ind.hi)];
    const tint = indicatorColor(ind, ind.hi);
    push(kit.area("indicator_band", kit.rect(plot.x0, y0, plot.x1 - plot.x0, y1 - y0), tint, { opacity: 0.22, ms: SKETCH_MS.region }), [plot.x1, (y0 + y1) / 2]);
    const at: Pt = [plot.x1 - 8, y1 + 8];
    push(kit.text("indicator_label", at, ind.label, { fontSize: 20, anchor: "end", color: COLORS.ink }), at);
    follow("indicator_band", "indicator_label");
    drawnWith.indicator_band = ["indicator_label"];
  }

  // ---- axes -----------------------------------------------------------------
  const xt = roundTicks(0, m.vMax, 8);
  const axes = drawAxes({
    plot,
    x: X,
    y: Y,
    xTicks: xt.ticks,
    xDecimals: xt.decimals,
    yTicks: [0, 2, 4, 6, 7, 8, 10, 12, 14].filter((v) => v !== 7),
    yDecimals: 0,
    xCaption: typeof P.x_label === "string" && P.x_label.trim() ? P.x_label : `${m.titrant} added (mL)`,
    yCaption: typeof P.y_label === "string" && P.y_label.trim() ? P.y_label : "pH",
  });
  axes.drawables.forEach((d) => push(d, axes.anchors[d.id]));
  Object.assign(attached, axes.attached);
  Object.assign(drawnWith, axes.drawnWith);

  if (m.neutral) {
    push(kit.stroke("neutral_line", [[plot.x0, sy(7)], [plot.x1, sy(7)]], { color: COLORS.guide, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }), [plot.x1, sy(7)]);
    const at: Pt = [plot.x0 + 10, sy(7) + 10];
    push(kit.text("neutral_label", at, "pH 7", { fontSize: 20, anchor: "start", color: COLORS.guide }), at);
    follow("neutral_line", "neutral_label");
    drawnWith.neutral_line = ["neutral_label"];
  }

  // ---- buffer regions (weak analytes): pH within pKa ± 1 before each equivalence
  const eqs = equivalenceVolumes(m.main);
  let bufferBox: { x0: number; y0: number; y1: number } | null = null;
  if (isWeak(m.main.kind) && m.marks.has("buffer")) {
    const acid = isAcid(m.main.kind);
    m.main.pkas.forEach((pka, i) => {
      const a = i === 0 ? 0 : eqs[i - 1];
      const b = eqs[i];
      if (a >= m.vMax) return;
      const lo = volumeAtPh(m.main, acid ? pka - 1 : pka + 1, a, Math.min(b, m.vMax)) ?? a;
      const hi = volumeAtPh(m.main, acid ? pka + 1 : pka - 1, a, Math.min(b, m.vMax));
      if (hi === null || !(hi > lo)) return;
      const id = i === 0 ? "buffer" : `buffer_${i + 1}`;
      const [x0, x1, y0, y1] = [sx(lo), sx(hi), sy(pka - 1), sy(pka + 1)];
      push(kit.area(id, kit.rect(x0, y0, x1 - x0, y1 - y0), COLORS.region2, { opacity: 0.3, ms: SKETCH_MS.region }), [(x0 + x1) / 2, y1]);
      if (i === 0) {
        bufferBox = { x0, y0, y1 };
        values.buffer_start = r3(lo);
        values.buffer_end = r3(hi);
      }
      // Over the box's inner corner (its outer one is the curve's name's).
      const lab: Pt = [x1 - 4, acid ? y1 + 12 : y0 - 30];
      push(kit.text(`${id}_label`, lab, "buffer", { fontSize: 22, anchor: "end", color: "#4f7a43" }), lab);
      follow(id, `${id}_label`);
      drawnWith[id] = [`${id}_label`];
    });
  }

  // ---- the curves -----------------------------------------------------------
  const curve = (id: string, t: Titration, color: string, upTo: number | null): Pt[] | null => {
    const pts = sampleCurve(t, upTo ?? m.vMax).map(([v, p]): Pt => [sx(v), sy(p)]);
    if (pts.length < 2) return null;
    const line = simplifyPolyline(pts, 0.3);
    push(kit.stroke(id, line, { color, strokeWidth: 4.5, ms: SKETCH_MS.curve }), line[line.length - 1]);
    curveSamples[id] = line;
    return line;
  };
  const labelCurve = (owner: string, id: string, t: Titration, text: string, color: string, box: { x0: number; y0: number; y1: number } | null): void => {
    // Beside the curve a third of the way to its first equivalence point:
    // above it for an acid (the curve climbs), below for a base — or, when
    // a buffer box sits there, over the box's outer corner.
    const acid = isAcid(t.kind);
    const v = Math.min(m.vMax * 0.9, equivalenceVolumes(t)[0] * 0.3);
    const at: Pt = box ? [box.x0 + 4, acid ? box.y1 + 12 : box.y0 - 30] : [sx(v), sy(phAt(t, v)) + (acid ? 18 : -38)];
    push(kit.text(id, at, text, { fontSize: 22, anchor: box ? "start" : "middle", color }), at);
    follow(owner, id);
    drawnWith[owner] = [id];
  };
  if (m.compare) {
    const upTo = m.trace && m.v !== null ? Math.max(m.v, 1e-6) : null;
    if (curve("compare_curve", m.compare, OTHER, upTo) && m.compareLabel) labelCurve("compare_curve", "compare_label", m.compare, m.compareLabel, OTHER, null);
  }
  const mainLine = curve("curve", m.main, MAIN, m.trace && m.v !== null ? Math.max(m.v, 1e-6) : null);
  if (mainLine && m.label) labelCurve("curve", "curve_label", m.main, m.label, MAIN, bufferBox);

  // ---- marks ----------------------------------------------------------------
  const shown = (v: number): boolean => v <= m.vMax + 1e-9 && (!m.trace || m.v === null || v <= m.v + 1e-9);
  const dot = (id: string, v: number, p: number, color: string): Pt => {
    const c: Pt = [sx(v), sy(p)];
    push(kit.stroke(id, [c], { shapeHint: { type: "circle", c, r: 8 }, color, fill: color, strokeWidth: 2, ms: SKETCH_MS.dot }), c);
    return c;
  };
  eqs.forEach((ve, i) => {
    const ph = phAt(m.main, ve);
    const sfx = i === 0 ? "" : `_${i + 1}`;
    values[`v_eq${sfx}`] = r3(ve);
    values[`ph_eq${sfx}`] = r3(ph);
    if (!m.marks.has("equivalence") || !shown(ve)) return;
    const c = dot(`eq_point${sfx}`, ve, ph, COLORS.ink);
    drawables.push(kit.stroke(`eq_point${sfx}_guide`, [[c[0], plot.y0], c], { color: COLORS.guide, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }));
    // Left of the point, where the curve has not yet climbed (or fallen) to it; right when the axis is too near.
    const right = c[0] - 16 - kit.textWidth("equivalence", 22) < plot.x0 + 10;
    const at: Pt = [c[0] + (right ? 16 : -16), c[1] - 8];
    push(kit.text(`eq_label${sfx}`, at, "equivalence", { fontSize: 22, anchor: right ? "start" : "end" }), at);
    follow(`eq_point${sfx}`, `eq_label${sfx}`);
    drawnWith[`eq_point${sfx}`] = [`eq_label${sfx}`];
  });
  if (isWeak(m.main.kind)) {
    m.main.pkas.forEach((pka, i) => {
      const vh = (i === 0 ? 0 : eqs[i - 1]) + eqs[0] / 2;
      const ph = phAt(m.main, vh);
      const sfx = i === 0 ? "" : `_${i + 1}`;
      values[`pka${sfx}`] = pka;
      values[`v_half${sfx}`] = r3(vh);
      values[`ph_half${sfx}`] = r3(ph);
      if (!m.marks.has("half") || !shown(vh)) return;
      const c = dot(`half_point${sfx}`, vh, ph, PARAM_COLOR);
      drawables.push(kit.stroke(`half_point${sfx}_guide`, [[plot.x0, c[1]], c, [c[0], plot.y0]], { color: PARAM_COLOR, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }));
      const acid = isAcid(m.main.kind);
      // Up and left of the dot for an acid (the curve comes from below-left), down and left for a base.
      const at: Pt = [c[0] - 14, c[1] + (acid ? 14 : -32)];
      push(kit.text(`half_label${sfx}`, at, "pH = pKa", { fontSize: 22, anchor: "end", color: PARAM_COLOR }), at);
      follow(`half_point${sfx}`, `half_label${sfx}`);
      drawnWith[`half_point${sfx}`] = [`half_label${sfx}`];
    });
  }
  if (m.compare) {
    const ce = equivalenceVolumes(m.compare);
    values.compare_v_eq = r3(ce[0]);
    values.compare_ph_eq = r3(phAt(m.compare, ce[0]));
    values.compare_ph_start = r3(phAt(m.compare, 0));
    if (m.marks.has("equivalence") && shown(ce[0])) {
      dot("compare_eq_point", ce[0], phAt(m.compare, ce[0]), OTHER);
    }
  }

  // ---- the cursor -----------------------------------------------------------
  values.ph_start = r3(phAt(m.main, 0));
  if (m.v !== null) {
    const ph = phAt(m.main, m.v);
    values.v = r3(m.v);
    values.ph = r3(ph);
    if (m.compare) values.compare_ph = r3(phAt(m.compare, m.v));
    const c: Pt = [sx(m.v), sy(ph)];
    push(kit.stroke("cursor", [[c[0], plot.y0], [c[0], plot.y1]], { color: COLORS.ink, strokeWidth: 2, opacity: 0.55, ms: SKETCH_MS.guides }), [c[0], plot.y1]);
    push(kit.stroke("cursor_dot", [c], { shapeHint: { type: "circle", c, r: 10 }, color: COLORS.ink, fill: COLORS.paper, strokeWidth: 3, ms: SKETCH_MS.dot }), c);
    const text = `${kit.num(Number(m.v.toFixed(1)), 1)} mL, pH ${kit.num(Number(ph.toFixed(2)), 2)}`;
    const w = kit.textWidth(text, 22);
    // The readout hangs at the top of the cursor, beside the line — or at its
    // foot when a curve runs up there (a strong base's start, a strong
    // titrant's excess).
    const leftSide = c[0] + 10 + w > plot.x1 + 20;
    const span: [number, number] = leftSide ? [m.v - ((w + 10) / (plot.x1 - plot.x0)) * m.vMax, m.v] : [m.v, m.v + ((w + 10) / (plot.x1 - plot.x0)) * m.vMax];
    let high = -Infinity;
    for (const t of [m.main, ...(m.compare ? [m.compare] : [])]) for (let k = 0; k <= 8; k++) high = Math.max(high, phAt(t, span[0] + ((span[1] - span[0]) * k) / 8));
    const at: Pt = [leftSide ? c[0] - 10 : c[0] + 10, high < 12.9 ? plot.y1 - 14 : plot.y0 + 28];
    push(kit.text("cursor_label", at, text, { fontSize: 22, anchor: leftSide ? "end" : "start" }), at);
    attached.cursor = ["cursor_dot", "cursor_label"];
    drawnWith.cursor = ["cursor_dot", "cursor_label"];
  }

  // ---- the numbers the curve is made of ---------------------------------------
  if (m.numbers) {
    const pieces = legendPieces(m);
    const texts = pieces.map((p) => ("text" in p ? p.text : kit.num(p.value, p.decimals)));
    // Each piece its own text, a word's space apart (a comma hugs its number).
    const gapBefore = (i: number): number => (i === 0 ? 0 : texts[i] === "," ? 0 : texts[i] === "·" || texts[i - 1] === "·" ? 16 : LEGEND_GAP);
    const total = texts.reduce((a, s, i) => a + kit.textWidth(s, LEGEND_FONT) + gapBefore(i), 0);
    let x = (plot.x0 + plot.x1) / 2 - total / 2;
    const ids: string[] = [];
    const words: Drawable[] = [];
    const nums: [Drawable, Pt][] = [];
    pieces.forEach((p, i) => {
      x += gapBefore(i);
      const w = kit.textWidth(texts[i], LEGEND_FONT);
      if ("text" in p) {
        words.push(kit.text(`legend__w${i}`, [x, legendY], texts[i], { fontSize: LEGEND_FONT, anchor: "start" }));
      } else {
        const id = legendId(p);
        ids.push(id);
        nums.push([kit.text(id, [x, legendY], texts[i], { fontSize: LEGEND_FONT, anchor: "start", color: PARAM_COLOR }), [x + w / 2, legendY]]);
      }
      x += w;
    });
    // The words first, then the numbers into them.
    push(kit.group("legend", words), [(plot.x0 + plot.x1) / 2, legendY]);
    for (const [d, at] of nums) push(d, at);
    attached.legend = ids;
    drawnWith.legend = ids;
  }

  // ---- burette and flask ----------------------------------------------------
  if (m.flask) drawFlask(m, flaskX, plot, push, attached, drawnWith);

  if (title) {
    const at: Pt = [500, plotArea().y1 + 8];
    push(kit.text("title", at, title, { fontSize: 30, anchor: "middle" }), at);
  }
  groups.marks = order.filter((id) => /^(eq_point|half_point|buffer|compare_eq_point)/.test(id) && !id.endsWith("_label"));
  if (groups.marks.length === 0) delete groups.marks;

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
    frame: { x: X, y: Y, box: plot },
  };
}

/** The burette's tube, logical: what the widget's drag reads its scale off. */
export const BURETTE = { w: 30, top: 590, bottom: 385 };

function drawFlask(m: Model, x0: number, plot: PlotArea, push: (d: Drawable, at: Pt) => void, attached: Record<string, string[]>, drawnWith: Record<string, string[]>): void {
  const cx = x0 + FLASK_W / 2;
  const { w, top, bottom } = BURETTE;
  const v = m.v ?? 0;
  const tube = kit.rect(cx - w / 2, bottom, w, top - bottom);
  push(kit.stroke("burette", tube, { closed: true, color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.stroke }), [cx, top]);
  // The titrant level falls as it runs out: full at 0 mL, empty at the axis's end.
  const level = top - 12 - ((top - 12 - bottom) * v) / m.vMax;
  push(kit.area("burette_liquid", kit.rect(cx - w / 2 + 4, bottom + 2, w - 8, Math.max(2, level - bottom - 2)), "#cfe0ea", { opacity: 0.9, ms: SKETCH_MS.region }), [cx, level]);
  // The tip and its tap.
  const tip = kit.stroke("burette_tip", [[cx - 7, bottom], [cx - 3, bottom - 36], [cx + 3, bottom - 36], [cx + 7, bottom]], { color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.connector });
  push(tip, [cx, bottom - 36]);
  // The flask: an Erlenmeyer's cone under a short neck.
  const fy = Math.max(plot.y0 + 10, 110);
  const neckTop = bottom - 60;
  const neckBot = neckTop - 38;
  const R = 72;
  const flask: Pt[] = [[cx - 20, neckTop], [cx - 20, neckBot], [cx - R, fy], [cx + R, fy], [cx + 20, neckBot], [cx + 20, neckTop]];
  push(kit.stroke("flask", flask, { color: COLORS.ink, strokeWidth: 3, ms: SKETCH_MS.stroke }), [cx, fy]);
  // Its liquid, the indicator's colour at this pH (pale when there is none), rising with the titrant.
  const ph = phAt(m.main, v);
  const fill = m.indicator ? indicatorColor(m.indicator, ph) : "#dfe9ee";
  const depth = 50 + 40 * Math.min(1, v / m.vMax);
  const t = depth / (neckBot - fy);
  const half = R - (R - 20) * t;
  push(kit.area("flask_liquid", [[cx - R + 3, fy + 3], [cx + R - 3, fy + 3], [cx + half - 3, fy + depth], [cx - half + 3, fy + depth]], fill, { opacity: 0.85, ms: SKETCH_MS.region }), [cx, fy + depth / 2]);
  attached.burette = ["burette_liquid", "burette_tip"];
  drawnWith.burette = ["burette_liquid", "burette_tip"];
  attached.flask = ["flask_liquid"];
  drawnWith.flask = ["flask_liquid"];
}
