// des_hta's layout: a patient-level simulation drawn five ways (`view`):
//
//   timelines  the same patients under each strategy, side by side: a row
//              per patient, a coloured bar per state, ◆ an adverse event,
//              ✕ death — and under each column the average over ALL the
//              simulated patients (default)
//   curves     survival from the simulated patients: alive (OS, solid) and
//              still in the first state (PFS, dashed) for both strategies,
//              the life-years gained shaded between the OS curves
//   results    the per-patient means (discounted costs and QALYs, life
//              years), the difference and the ICER; under it a CE plane of
//              each patient's own difference
//   diagram    the model: states as boxes, events as arrows with their
//              time-to-event laws, each state's QALY weight and cost
//   overview   the header, a few timelines, the curves and the table at once
//
// Every view but "diagram" carries the model as a small header strip, which
// is also the colour key for the bars. The controls row (hazard ratio, the
// treatment's cost, ↻ new patients) sits at the page's foot. `t` is the
// time cursor: the timelines fill in and the curves draw up to it.
import { COLORS, SKETCH_MS, defaultDrawOpts, type Drawable, type Pt } from "../../layout/model";
import { kit } from "../kit";
import { roundTicks } from "../plot-axes";
import type { SceneLayout } from "../types";
import { occAt, simulateParams, type ArmResult, type SimResult } from "./engine";
import { discountOf, medianOf, readModel, slugify, VIEWS, weibullScale, type HtaEvent, type HtaParams, type Model, type View } from "./model";

export type { HtaParams } from "./model";

/** State colours: the bars and the header's boxes (the dead state is plain ink). */
export const STATE_COLORS = ["#87a878", "#d0865f", "#f2c14e", "#2f6b8f", "#b5482e"];
/** Strategy inks: the comparator ink, the intervention the accent (as markov_model's compare). */
export const ARM_COLORS = [COLORS.ink, COLORS.accent] as const;
export const ARM_KEYS = ["a", "b"] as const;
const MIN_FS = 14;
const MAX_TL_SHOW = 16;

type Box = { x0: number; y0: number; x1: number; y1: number };

export function viewOf(P: HtaParams): View {
  return VIEWS.includes(P.view as View) ? (P.view as View) : "timelines";
}

/** Money as markov_model writes it: thousands separated, millions as "£1.39m". */
export function fmtMoney(v: number, cur: string): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}${cur}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m`;
  if (a >= 1e4) return `${sign}${cur}${(Math.round(a / 100) * 100).toLocaleString("en-GB")}`;
  return `${sign}${cur}${Math.round(a).toLocaleString("en-GB")}`;
}
/** The step fmtMoney rounds an amount of this size to. */
export function moneyStep(v: number): number {
  const a = Math.abs(v);
  return a >= 1e7 ? 1e5 : a >= 1e6 ? 1e4 : a >= 1e4 ? 100 : 1;
}
const signed = (abs: string, v: number): string => (v > 0 ? `+${abs}` : v < 0 ? `−${abs}` : abs);
const q2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * The per-patient numbers the table WRITES, and differences taken between
 * the written numbers (markov_model's rule): QALYs and life years to two
 * decimals, both costs to the coarser of their rounding steps, so "+0.41"
 * is exactly 3.12 − 2.71 as printed. The ICER is the simulation's own
 * (unrounded) ratio to the nearest 100 — within rounding of the printed
 * difference over the printed gain — and only when QALYs are gained at a
 * cost; otherwise the words say which corner of the plane it is.
 */
export interface Shown {
  cost: [number, number];
  qalys: [number, number];
  ly: [number, number];
  dcost: number;
  dqaly: number;
  dly: number;
  icer: number | null;
  verdict: string | null;
}
export function shownResults(sim: SimResult): Shown {
  const [a, b] = sim.arms;
  const step = Math.max(moneyStep(a.cost), moneyStep(b.cost));
  const k = (v: number): number => Math.round(v / step) * step;
  const dq = b.qalys - a.qalys, dc = b.cost - a.cost;
  const icer = dq > 0 && dc >= 0 ? Math.round(dc / dq / 100) * 100 : null;
  const verdict =
    icer !== null
      ? null
      : dq > 0
        ? kit.say({ en: "Dominant: more QALYs for less", nb: "Dominerer: flere QALY for mindre" })
        : dc >= 0
          ? kit.say({ en: "Dominated: fewer QALYs for more", nb: "Dominert: færre QALY for mer" })
          : kit.say({ en: "Fewer QALYs for less", nb: "Færre QALY for mindre" });
  const cost: [number, number] = [k(a.cost), k(b.cost)];
  const qalys: [number, number] = [q2(a.qalys), q2(b.qalys)];
  const ly: [number, number] = [q2(a.ly), q2(b.ly)];
  return { cost, qalys, ly, dcost: cost[1] - cost[0], dqaly: q2(qalys[1] - qalys[0]), dly: q2(ly[1] - ly[0]), icer, verdict };
}

/** An event's law in a few words: "median 2 y", "rate 0.1/y", "Weibull", "shape 1.6". */
export function lawWords(e: HtaEvent): { main: string; shape: string | null } {
  const dist = e.dist ?? "exponential";
  const yr = kit.say({ en: "y", nb: "år" });
  const n = (v: number): string => kit.num(Number(v.toPrecision(3)));
  if (dist === "exponential") return { main: typeof e.median === "number" ? `${kit.say({ en: "median", nb: "median" })} ${n(e.median)} ${yr}` : `${n(e.rate ?? 0)}/${yr}`, shape: null };
  if (dist === "weibull") {
    const med = typeof e.median === "number" ? e.median : typeof e.scale === "number" && typeof e.shape === "number" ? e.scale * Math.log(2) ** (1 / e.shape) : 0;
    return { main: typeof e.median === "number" ? `${kit.say({ en: "median", nb: "median" })} ${n(med)} ${yr}` : `${kit.say({ en: "scale", nb: "skala" })} ${n(e.scale ?? 0)} ${yr}`, shape: `Weibull ${kit.say({ en: "shape", nb: "form" })} ${n(e.shape ?? 1)}` };
  }
  if (dist === "gompertz") return { main: `${n(e.rate ?? 0)}/${yr}`, shape: `Gompertz ${n(e.shape ?? 0)}` };
  return { main: kit.say({ en: "piecewise", nb: "stykkevis" }), shape: (e.rates ?? []).map((r) => n(r)).join(" → ") + `/${yr}` };
}

// ---------------------------------------------------------------------------

interface Out {
  drawables: Drawable[];
  anchors: Record<string, Pt>;
  order: string[];
  groups: Record<string, string[]>;
  attached: Record<string, string[]>;
  drawnWith: Record<string, string[]>;
}

function newOut(): Out {
  return { drawables: [], anchors: {}, order: [], groups: {}, attached: {}, drawnWith: {} };
}

function pusher(o: Out) {
  return (d: Drawable, at?: Pt): void => {
    o.drawables.push(d);
    o.order.push(d.id);
    if (at) o.anchors[d.id] = at;
  };
}

const text = (id: string, at: Pt, s: string, fs: number, o: { color?: string; anchor?: "start" | "middle" | "end" } = {}): Drawable => kit.text(id, at, s, { fontSize: Math.max(MIN_FS, fs), ...o });

/** A font no bigger than `fs` that fits `s` in `w`, floored at MIN_FS. */
function fit(s: string, fs: number, w: number): number {
  const tw = kit.textWidth(s, fs);
  return tw <= w ? fs : Math.max(MIN_FS, (fs * w) / tw);
}

function rectPts(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const pts: Pt[] = [];
  const c = (cx: number, cy: number, a0: number): void => {
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (k / 4) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  c(x1 - r, y0 + r, -Math.PI / 2);
  c(x1 - r, y1 - r, 0);
  c(x0 + r, y1 - r, Math.PI / 2);
  c(x0 + r, y0 + r, Math.PI);
  return pts;
}

const diamond = (c: Pt, r: number): Pt[] => [
  [c[0], c[1] + r],
  [c[0] + r * 0.75, c[1]],
  [c[0], c[1] - r],
  [c[0] - r * 0.75, c[1]],
];

function cross(id: string, c: Pt, r: number, color: string = COLORS.ink): Drawable {
  return kit.group(id, [
    kit.stroke(`${id}__1`, [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]], { color, strokeWidth: 2.5, ms: 200 }),
    kit.stroke(`${id}__2`, [[c[0] - r, c[1] + r], [c[0] + r, c[1] - r]], { color, strokeWidth: 2.5, ms: 200 }),
  ]);
}

/** Color of state s (the dead state is none: it is where a bar ends). */
function stateColor(m: Model, s: number): string {
  if (s === m.dead) return COLORS.ink;
  let k = 0;
  for (let i = 0; i < s; i++) if (i !== m.dead) k++;
  return STATE_COLORS[k % STATE_COLORS.length];
}

// ---- the model diagram -------------------------------------------------------

/**
 * States in a row (the order of `states`), events as arrows: to the next
 * state straight, skipping ahead as an arc over the row, back as an arc
 * under it, a recurrent event as a loop over its state with a ◆. Detailed:
 * each arrow carries its law (event_label_<i>, event_shape_<i>) and each
 * state its QALY weight and cost under it.
 */
function drawDiagram(o: Out, P: HtaParams, m: Model, box: Box, detailed: boolean): void {
  const push = pusher(o);
  const n = m.states.length;
  const w = box.x1 - box.x0;
  const gap = w / n;
  const bw = Math.min(detailed ? 190 : 150, gap * (detailed ? 0.6 : 0.66));
  const bh = detailed ? 80 : 38;
  const cy = detailed ? box.y0 + (box.y1 - box.y0) * 0.5 : box.y0 + bh / 2 + 4;
  const cx = (i: number): number => box.x0 + gap * (i + 0.5);
  const cur = P.currency ?? "£";
  const fsName = detailed ? 28 : 18;
  const members: string[] = [];
  m.states.forEach((s, i) => {
    const id = `state_${s.slug}`;
    const x = cx(i);
    const color = stateColor(m, i);
    const dead = i === m.dead;
    const pts = roundRect(x - bw / 2, cy - bh / 2, x + bw / 2, cy + bh / 2, 10);
    const kids: Drawable[] = [];
    if (!dead) kids.push(kit.area(`${id}__fill`, pts, color, { opacity: 0.55, precise: true }));
    kids.push(kit.stroke(`${id}__edge`, pts, { closed: true, color: dead ? COLORS.ink : color, strokeWidth: 3, ms: SKETCH_MS.node }));
    push(kit.group(id, kids), [x, cy]);
    push(text(`state_label_${s.slug}`, [x, cy], s.name, fit(s.name, fsName, bw - 12)), [x, cy]);
    (o.attached[id] ??= []).push(`state_label_${s.slug}`);
    o.drawnWith[id] = [`state_label_${s.slug}`];
    members.push(id, `state_label_${s.slug}`);
    if (detailed && !dead) {
      const u = `${kit.num(s.utility, 2)} QALY/${kit.say({ en: "yr", nb: "år" })}`;
      const c = `${fmtMoney(s.cost, cur)}/${kit.say({ en: "yr", nb: "år" })}`;
      push(text(`state_utility_${s.slug}`, [x, cy - bh / 2 - 22], u, fit(u, 19, gap - 10), { color: COLORS.supply }), [x, cy - bh / 2 - 22]);
      push(text(`state_cost_${s.slug}`, [x, cy - bh / 2 - 52], c, fit(c, 19, gap - 10), { color: COLORS.supply }), [x, cy - bh / 2 - 52]);
      members.push(`state_utility_${s.slug}`, `state_cost_${s.slug}`);
    }
  });
  // Arcs over the row stack by span; loops sit on their state.
  let up = 0;
  let down = 0;
  const fsLab = detailed ? 19 : 15;
  m.events.forEach((e) => {
    const id = `event_${e.index}`;
    const x0 = cx(e.from), x1 = cx(e.to);
    const words = lawWords(e.spec);
    let pts: Pt[];
    let labAt: Pt;
    let shapeAt: Pt | null = null;
    if (e.recurrent) {
      const top = cy + bh / 2;
      const r = detailed ? 22 : 13;
      // On the box's left shoulder (arcs leave from its right): a loop, the ◆ at its top.
      const lx = x0 - bw * 0.28;
      pts = [];
      for (let k = 0; k <= 18; k++) {
        const a = Math.PI * (-0.2 + (1.4 * k) / 18);
        pts.push([lx + r * Math.cos(a), top + r * 0.45 + r * Math.sin(a)]);
      }
      const apex: Pt = [lx, top + r * 1.45];
      push(kit.stroke(id, pts, { arrowhead: "end", color: COLORS.guide, strokeWidth: 2, ms: SKETCH_MS.arrow }), apex);
      const mark: Pt = [lx, apex[1] + (detailed ? 12 : 9)];
      push(kit.area(`event_mark_${e.index}`, diamond(mark, detailed ? 9 : 7), COLORS.demand, { precise: true }), mark);
      o.attached[id] = [`event_mark_${e.index}`];
      members.push(id, `event_mark_${e.index}`);
      const cap = `${e.name} ${words.main}`;
      if (detailed) {
        labAt = [lx, mark[1] + 24];
        push(text(`event_label_${e.index}`, labAt, cap, fit(cap, fsLab, gap * 0.9), { color: COLORS.guide }), labAt);
        o.attached[id].push(`event_label_${e.index}`);
        members.push(`event_label_${e.index}`);
      }
      return;
    }
    const adjacent = e.to === e.from + 1 && !m.events.some((f) => f.from === e.to && f.to === e.from);
    if (adjacent) {
      pts = [
        [x0 + bw / 2 + 6, cy],
        [x1 - bw / 2 - 8, cy],
      ];
      labAt = [(x0 + x1) / 2, cy + (detailed ? 18 : 12)];
      shapeAt = [(x0 + x1) / 2, cy - (detailed ? 18 : 12)];
    } else {
      const forward = e.to > e.from;
      const k = forward ? ++up : ++down;
      const h = (detailed ? 58 : 26) + (k - 1) * (detailed ? 44 : 14);
      const sgn = forward ? 1 : -1;
      const ya = cy + sgn * (bh / 2 + 4);
      const a: Pt = [x0 + (forward ? 1 : -1) * bw * 0.18, ya];
      const b: Pt = [x1 - (forward ? 1 : -1) * bw * 0.18, ya + sgn * 6];
      pts = [];
      for (let j = 0; j <= 24; j++) {
        const u = j / 24;
        pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + sgn * h * 4 * u * (1 - u)]);
      }
      const apex: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sgn * h];
      labAt = [apex[0], apex[1] + sgn * (detailed ? 16 : 11)];
      shapeAt = detailed ? [apex[0], apex[1] + sgn * 38] : null;
    }
    push(kit.stroke(id, pts, { arrowhead: "end", color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.arrow }), pts[Math.floor(pts.length / 2)]);
    members.push(id);
    if (detailed || adjacent) {
      const room = adjacent ? gap - bw - 8 : gap * Math.max(1, Math.abs(e.to - e.from)) - 20;
      const main = words.main;
      push(text(`event_label_${e.index}`, labAt, main, fit(main, fsLab, room)), labAt);
      o.attached[id] = [`event_label_${e.index}`];
      members.push(`event_label_${e.index}`);
      // The shape says what kind of law it is (a rising Weibull hazard); in
      // the header strip too, under the arrow, where only a neighbour's arrow is.
      if (words.shape && shapeAt && (detailed || adjacent)) {
        push(text(`event_shape_${e.index}`, shapeAt, words.shape, fit(words.shape, detailed ? fsLab - 2 : 14, room), { color: COLORS.guide }), shapeAt);
        o.attached[id].push(`event_shape_${e.index}`);
        members.push(`event_shape_${e.index}`);
      }
    }
  });
  o.groups.model = members;
}

// ---- the timelines -------------------------------------------------------------

function timeTicks(H: number, target = 5): { ticks: number[]; decimals: number } {
  const r = roundTicks(0, H, target);
  return { ticks: r.ticks.filter((v) => v >= 0 && v <= H + 1e-9), decimals: r.decimals };
}

/** A time axis under a column: line, ticks and numbers. */
function timeAxis(id: string, x0: number, x1: number, y: number, H: number, fs: number, target: number): Drawable {
  const { ticks, decimals } = timeTicks(H, target);
  const kids: Drawable[] = [kit.stroke(`${id}__line`, [[x0, y], [x1, y]], { color: COLORS.guide, strokeWidth: 2, ms: SKETCH_MS.axis })];
  ticks.forEach((v, i) => {
    const X = x0 + (v / H) * (x1 - x0);
    kids.push(kit.stroke(`${id}__m${i}`, [[X, y - 5], [X, y + 5]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    kids.push({ ...kit.text(`${id}__t${i}`, [X, y - fs * 0.95], kit.num(v, decimals), { fontSize: fs, color: COLORS.guide }), drawOpts: defaultDrawOpts("instant") });
  });
  return kit.group(id, kids);
}

interface TLGeom {
  cols: [Box, Box];
  rowH: number;
  rows: number;
  /** Top of the first row. */
  top: number;
  axisY: number;
}

function tlGeom(box: Box, rows: number, labelW: number): TLGeom {
  const headH = 58;
  const top = box.y1 - headH;
  // Under the axis: its numbers, "years", then the column's mean.
  const axisY = box.y0 + 92;
  const rowH = Math.min(56, (top - axisY - 10) / Math.max(1, rows));
  const colGap = 44;
  const cw = (box.x1 - box.x0 - labelW - colGap) / 2;
  const a: Box = { x0: box.x0 + labelW, x1: box.x0 + labelW + cw, y0: axisY, y1: top };
  const b: Box = { x0: a.x1 + colGap, x1: box.x1, y0: axisY, y1: top };
  return { cols: [a, b], rowH, rows, top, axisY };
}

function drawTimelines(o: Out, P: HtaParams, sim: SimResult, box: Box, rows: number, tCur: number, compact: boolean): TLGeom {
  const push = pusher(o);
  const m = sim.model;
  const H = m.horizon;
  const labelW = compact ? 26 : 34;
  const g = tlGeom(box, rows, labelW);
  const cur = P.currency ?? "£";
  const sh = shownResults(sim);
  const fsHead = compact ? 20 : 24;
  const barH = Math.max(8, Math.min(22, g.rowH * 0.56));
  sim.arms.forEach((arm, ai) => {
    const k = ARM_KEYS[ai];
    const c = g.cols[ai];
    const X = (t: number): number => c.x0 + (Math.min(t, H) / H) * (c.x1 - c.x0);
    const head = arm.name;
    push(text(`tl_head_${k}`, [(c.x0 + c.x1) / 2, box.y1 - 12], head, fit(head, fsHead, c.x1 - c.x0), { color: ARM_COLORS[ai] }), [(c.x0 + c.x1) / 2, box.y1 - 14]);
    const lanes: string[] = [];
    // Faint guides for the whole horizon (where a bar could still go), one
    // element per column, drawn with its first lane: a lane is only its bars
    // and marks, so a highlight of a patient lights up that life alone.
    const rails: Drawable[] = [];
    for (let r = 0; r < Math.min(rows, arm.paths.length); r++) {
      const path = arm.paths[r];
      const yc = g.top - g.rowH * (r + 0.5);
      const kids: Drawable[] = [];
      rails.push(kit.stroke(`rails_${k}__${r + 1}`, [[c.x0, yc], [c.x1, yc]], { color: "#d9d3c7", strokeWidth: 1.5, instant: true }));
      path.stays.forEach((st, j) => {
        if (st.t0 >= tCur) return;
        const x0 = X(st.t0), x1 = X(Math.min(st.t1, tCur));
        if (x1 - x0 < 0.5) return;
        kids.push(kit.area(`lane_${r + 1}_${k}__s${j}`, rectPts(x0, yc - barH / 2, x1, yc + barH / 2), stateColor(m, st.s), { precise: true, opacity: 0.8 }));
      });
      path.events.forEach((ev, j) => {
        if (ev.t > tCur) return;
        const at: Pt = [X(ev.t), yc];
        if (ev.kind === "ae") kids.push(kit.area(`lane_${r + 1}_${k}__ae${j}`, diamond([at[0], yc + barH / 2 + 2], Math.max(5, barH * 0.38)), COLORS.demand, { precise: true }));
        else if (ev.kind === "death") kids.push(cross(`lane_${r + 1}_${k}__x${j}`, at, Math.max(5, barH * 0.36)));
      });
      const id = `lane_${r + 1}_${k}`;
      if (kids.length === 0) kids.push(kit.stroke(`${id}__start`, [[c.x0, yc - barH / 2], [c.x0, yc + barH / 2]], { color: stateColor(m, 0), strokeWidth: 2, instant: true }));
      push(kit.group(id, kids), [(c.x0 + c.x1) / 2, yc]);
      lanes.push(id);
    }
    o.groups[`lanes_${k}`] = lanes;
    if (rails.length) {
      push(kit.group(`rails_${k}`, rails), [(c.x0 + c.x1) / 2, (g.top + g.axisY) / 2]);
      (o.drawnWith[lanes[0]] ??= []).push(`rails_${k}`);
    }
    push(timeAxis(`tl_axis_${k}`, c.x0, c.x1, g.axisY, H, compact ? 15 : 17, compact ? 4 : 5), [(c.x0 + c.x1) / 2, g.axisY]);
    const years = kit.say({ en: "years", nb: "år" });
    const yAt: Pt = [(c.x0 + c.x1) / 2, g.axisY - (compact ? 40 : 44)];
    push(text(`tl_years_${k}`, yAt, years, compact ? 15 : 17, { color: COLORS.guide }), yAt);
    o.attached[`tl_axis_${k}`] = [`tl_years_${k}`];
    o.drawnWith[`tl_axis_${k}`] = [`tl_years_${k}`];
    const mean = `${kit.num(sh.qalys[ai], 2)} QALYs · ${fmtMoney(sh.cost[ai], cur)}`;
    const fy = box.y0 + 12;
    if (!compact) push(text(`tl_mean_${k}`, [(c.x0 + c.x1) / 2, fy], mean, fit(mean, compact ? 18 : 21, c.x1 - c.x0), { color: ARM_COLORS[ai] }), [(c.x0 + c.x1) / 2, fy]);
  });
  // Patient numbers, once, left of the first column.
  const nums: Drawable[] = [];
  for (let r = 0; r < Math.min(rows, sim.arms[0].paths.length); r++) {
    const yc = g.top - g.rowH * (r + 0.5);
    nums.push({ ...kit.text(`lane_labels__${r + 1}`, [g.cols[0].x0 - 10, yc], String(r + 1), { fontSize: compact ? 14 : 16, color: COLORS.guide, anchor: "end" }), drawOpts: defaultDrawOpts("instant") });
  }
  push(kit.group("lane_labels", nums), [g.cols[0].x0 - 14, (g.top + g.axisY) / 2]);
  return g;
}

// ---- the curves -----------------------------------------------------------------

/** The curves' plot box inside their panel. */
function curvePlot(box: Box, compact: boolean): Box {
  // Right: room for "years" past the axis's end; below: the numbers, then the t pill.
  return { x0: box.x0 + (compact ? 56 : 70), x1: box.x1 - (compact ? 56 : 66), y0: box.y0 + (compact ? 76 : 62), y1: box.y1 - (compact ? 28 : 36) };
}

interface CurveGeom {
  plot: Box;
  X: (t: number) => number;
  Y: (v: number) => number;
}

function drawCurves(o: Out, sim: SimResult, box: Box, tCur: number, compact: boolean): CurveGeom {
  const push = pusher(o);
  const m = sim.model;
  const H = m.horizon;
  const plot = curvePlot(box, compact);
  const X = (t: number): number => plot.x0 + (t / H) * (plot.x1 - plot.x0);
  const Y = (v: number): number => plot.y0 + v * (plot.y1 - plot.y0);
  const fsT = compact ? 15 : 18;
  // Axes: L-shaped, round ticks.
  const kids: Drawable[] = [
    kit.stroke("curve_axes__x", [[plot.x0, plot.y0], [plot.x1 + 10, plot.y0]], { color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.axis }),
    kit.stroke("curve_axes__y", [[plot.x0, plot.y0], [plot.x0, plot.y1 + 10]], { color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.axis }),
  ];
  const { ticks, decimals } = timeTicks(H, compact ? 4 : 6);
  ticks.forEach((v, i) => {
    kids.push(kit.stroke(`curve_axes__xm${i}`, [[X(v), plot.y0 - 5], [X(v), plot.y0 + 5]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    kids.push({ ...kit.text(`curve_axes__xt${i}`, [X(v), plot.y0 - fsT - 2], kit.num(v, decimals), { fontSize: fsT, color: COLORS.guide }), drawOpts: defaultDrawOpts("instant") });
  });
  [0, 0.5, 1].forEach((v, i) => {
    kids.push(kit.stroke(`curve_axes__ym${i}`, [[plot.x0 - 5, Y(v)], [plot.x0 + 5, Y(v)]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    kids.push({ ...kit.text(`curve_axes__yt${i}`, [plot.x0 - 10, Y(v)], `${Math.round(v * 100)}%`, { fontSize: fsT, color: COLORS.guide, anchor: "end" }), drawOpts: defaultDrawOpts("instant") });
  });
  push(kit.group("curve_axes", kids), [plot.x0, plot.y0]);
  const xl = kit.say({ en: "years", nb: "år" });
  const xlAt: Pt = [plot.x1 + 26, plot.y0];
  push(text("curve_x_label", xlAt, xl, fsT, { anchor: "start", color: COLORS.guide }), [xlAt[0] + 20, xlAt[1]]);
  const yl = kit.say({ en: "share of patients", nb: "andel pasienter" });
  push(text("curve_y_label", [plot.x0 - 8, plot.y1 + 22], yl, fsT, { anchor: "start", color: COLORS.guide }), [plot.x0 + 50, plot.y1 + 22]);
  o.attached.curve_axes = ["curve_x_label", "curve_y_label"];
  o.drawnWith.curve_axes = ["curve_x_label", "curve_y_label"];

  const upto = Math.max(0, Math.min(H, tCur));
  const series = (arm: ArmResult, which: "os" | "pfs"): Pt[] => {
    const pts: Pt[] = [];
    const n = sim.grid.length;
    for (let k = 0; k < n; k++) {
      const t = sim.grid[k];
      if (t > upto + 1e-9) break;
      pts.push([X(t), Y(which === "os" ? 1 - (m.dead >= 0 ? arm.occ[m.dead][k] : 0) : arm.occ[0][k])]);
    }
    if (upto > 0 && (pts.length === 0 || X(upto) - pts[pts.length - 1][0] > 0.5)) pts.push([X(upto), Y(which === "os" ? 1 - (m.dead >= 0 ? occAt(arm, m.dead, upto, H) : 0) : occAt(arm, 0, upto, H))]);
    // At t = 0 a curve is its first point twice: its id exists from the
    // start, so a cast can name it before the sweep draws it out.
    if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1]]);
    return pts;
  };
  // Life-years gained: between the OS curves, to the cursor.
  const osA = series(sim.arms[0], "os");
  const osB = series(sim.arms[1], "os");
  if (osA.length > 1 && m.dead >= 0) {
    push(kit.area("ly_gain", [...osB, ...osA.slice().reverse()], COLORS.accent, { opacity: 0.18 }), osB[Math.floor(osB.length / 3)]);
  }
  sim.arms.forEach((arm, ai) => {
    const k = ARM_KEYS[ai];
    const os = ai === 0 ? osA : osB;
    if (os.length > 1 && m.dead >= 0) push(kit.stroke(`os_${k}`, os, { color: ARM_COLORS[ai], strokeWidth: 3.5, ms: SKETCH_MS.curve }), os[Math.floor(os.length / 2)]);
    const pfs = series(arm, "pfs");
    if (pfs.length > 1) push(kit.stroke(`pfs_${k}`, pfs, { color: ARM_COLORS[ai], strokeWidth: 3, dash: true, ms: SKETCH_MS.curve }), pfs[Math.floor(pfs.length / 3)]);
  });
  // The key, outside the plot (the cursor sweeps all of it): one row over
  // the plot, right of the y caption; in the overview two rows under the axis.
  const fsK = compact ? 15 : 17;
  const entries = [
    { id: "key_a", sub: "a", color: ARM_COLORS[0], dash: false, label: sim.arms[0].name },
    { id: "key_b", sub: "b", color: ARM_COLORS[1], dash: false, label: sim.arms[1].name },
    { id: "key_lines", sub: "os", color: COLORS.guide, dash: false, label: kit.say({ en: "alive", nb: "i live" }) },
    { id: "key_lines", sub: "pfs", color: COLORS.guide, dash: true, label: m.states[0].name },
  ];
  const wOf = (e: (typeof entries)[number]): number => 30 + 8 + kit.textWidth(e.label, fsK) + 22;
  const rows: (typeof entries)[] = compact ? [entries.slice(0, 2), entries.slice(2)] : [entries];
  const keyKids: Record<string, Drawable[]> = { key_a: [], key_b: [], key_lines: [] };
  rows.forEach((row, r) => {
    const total = row.reduce((a, e) => a + wOf(e), 0) - 22;
    let x = compact ? plot.x0 : plot.x1 + 40 - total;
    const y = compact ? plot.y0 - 42 - r * (fsK + 9) : plot.y1 + 22;
    for (const e of row) {
      keyKids[e.id].push(kit.stroke(`${e.id}__${e.sub}_line`, [[x, y], [x + 30, y]], { color: e.color, strokeWidth: 3.5, dash: e.dash, instant: true }));
      keyKids[e.id].push(kit.text(`${e.id}__${e.sub}_t`, [x + 38, y], e.label, { fontSize: fsK, color: e.color, anchor: "start" }));
      x += wOf(e);
    }
  });
  for (const id of ["key_a", "key_b", "key_lines"]) {
    const first = keyKids[id][0] as { pts: Pt[] };
    push(kit.group(id, keyKids[id]), [first.pts[0][0] + 40, first.pts[0][1]]);
  }
  o.groups.key = ["key_a", "key_b", "key_lines"];
  return { plot, X, Y };
}

// ---- the results table and the plane -----------------------------------------------

function drawTable(o: Out, P: HtaParams, sim: SimResult, box: Box, compact: boolean): void {
  const push = pusher(o);
  const sh = shownResults(sim);
  const cur = P.currency ?? "£";
  const d = discountOf(P);
  const FS = compact ? 19 : 24;
  const LFS = compact ? 17 : 21;
  const wtp = typeof P.wtp === "number" && P.wtp > 0 ? P.wtp : null;
  const rows = wtp ? 6 : 5;
  const ROW = Math.min(compact ? 34 : 46, (box.y1 - box.y0) / (rows + 0.6));
  const w = box.x1 - box.x0;
  const labelW = w * 0.36;
  const colW = (w - labelW) / 3;
  const cx = (j: number): number => box.x0 + labelW + colW * (j + 0.5);
  let y = box.y1 - ROW / 2;
  const row = (id: string, label: string, cells: string[], color: string = COLORS.ink, lcolor: string = color): void => {
    const kids: Drawable[] = [];
    if (label) kids.push(kit.text(`${id}__l`, [box.x0, y], label, { fontSize: fit(label, LFS, labelW - 8), anchor: "start", color: lcolor }));
    cells.forEach((c, j) => {
      if (c) kids.push(kit.text(`${id}__c${j}`, [cx(j), y], c, { fontSize: fit(c, FS, colW - 6), color }));
    });
    push(kit.group(id, kids), [(box.x0 + box.x1) / 2, y]);
    y -= ROW;
  };
  const rule = (id: string): void => {
    push(kit.stroke(id, [[box.x0, y + ROW / 2], [box.x1, y + ROW / 2]], { color: COLORS.guide, strokeWidth: 1.5, ms: SKETCH_MS.guides }), [(box.x0 + box.x1) / 2, y + ROW / 2]);
  };
  row("res_head", "", [kit.say({ en: "Cost", nb: "Kostnad" }), "QALYs", kit.say({ en: "Life years", nb: "Leveår" })], COLORS.ink);
  rule("res_rule_head");
  sim.arms.forEach((arm, ai) => row(`res_${ARM_KEYS[ai]}`, arm.name, [fmtMoney(sh.cost[ai], cur), kit.num(sh.qalys[ai], 2), kit.num(sh.ly[ai], 2)], ARM_COLORS[ai]));
  rule("res_rule_diff");
  row("res_diff", kit.say({ en: "Difference", nb: "Forskjell" }), [signed(fmtMoney(Math.abs(sh.dcost), cur), sh.dcost), signed(kit.num(Math.abs(sh.dqaly), 2), sh.dqaly), signed(kit.num(Math.abs(sh.dly), 2), sh.dly)], COLORS.ink, COLORS.guide);
  const icerId = "res_icer";
  const perQaly = (v: number): string => `${fmtMoney(v, cur)} ${kit.say({ en: "per QALY", nb: "per QALY" })}`;
  const icerWord = compact ? kit.say({ en: "ICER", nb: "IKER" }) : kit.say({ en: "ICER (per QALY)", nb: "IKER (per QALY)" });
  if (sh.icer !== null) {
    const kids: Drawable[] = [
      kit.text(`${icerId}__l`, [box.x0, y], icerWord, { fontSize: fit(icerWord, LFS, labelW - 8), anchor: "start", color: COLORS.accent }),
      kit.text(`${icerId}__v`, [cx(0.5), y], perQaly(sh.icer), { fontSize: fit(perQaly(sh.icer), FS, 2 * colW - 6), color: COLORS.accent }),
    ];
    push(kit.group(icerId, kids), [cx(0), y]);
  } else {
    push(kit.group(icerId, [kit.text(`${icerId}__v`, [box.x0, y], sh.verdict ?? "", { fontSize: LFS, anchor: "start", color: COLORS.accent })]), [box.x0 + kit.textWidth(sh.verdict ?? "", LFS) / 2, y]);
  }
  if (wtp) {
    y -= ROW;
    const w = kit.say({ en: "Threshold", nb: "Terskel" });
    push(
      kit.group("res_wtp", [
        kit.text("res_wtp__l", [box.x0, y], w, { fontSize: fit(w, LFS, labelW - 8), anchor: "start", color: COLORS.guide }),
        kit.text("res_wtp__v", [cx(0.5), y], perQaly(wtp), { fontSize: fit(perQaly(wtp), FS, 2 * colW - 6), color: COLORS.guide }),
      ]),
      [cx(0.5), y],
    );
  }
  y -= ROW * 0.8;
  const pct = (r: number): string => kit.num(Number((r * 100).toFixed(2)));
  const disc = d.costs === d.qalys ? (d.costs > 0 ? kit.say({ en: `costs and QALYs discounted ${pct(d.costs)}%`, nb: `kostnader og QALY diskontert ${pct(d.costs)} %` }) : kit.say({ en: "undiscounted", nb: "udiskontert" })) : kit.say({ en: `discounted ${pct(d.costs)}% costs, ${pct(d.qalys)}% QALYs`, nb: `diskontert ${pct(d.costs)} % kostnader, ${pct(d.qalys)} % QALY` });
  const note = kit.say({ en: `Mean per patient of ${sim.model.patients.toLocaleString("en-GB")} · ${disc}`, nb: `Snitt per pasient av ${sim.model.patients.toLocaleString("en-GB")} · ${disc}` });
  push(text("res_note", [box.x0, y], note, fit(note, compact ? 15 : 18, w), { anchor: "start", color: COLORS.guide }), [box.x0 + Math.min(w, kit.textWidth(note, 18)) / 2, y]);
  o.groups.results = ["res_head", "res_rule_head", "res_a", "res_b", "res_rule_diff", "res_diff", "res_icer", ...(wtp ? ["res_wtp"] : []), "res_note"];
}

interface PlaneGeom {
  x: [number, number];
  y: [number, number];
  box: Box;
}

function drawPlane(o: Out, P: HtaParams, sim: SimResult, box: Box): PlaneGeom {
  const push = pusher(o);
  const [a, b] = sim.arms;
  const N = sim.model.patients;
  const dq: number[] = [];
  const dc: number[] = [];
  for (let i = 0; i < N; i++) (dq[i] = b.perQaly[i] - a.perQaly[i]), (dc[i] = b.perCost[i] - a.perCost[i]);
  const pct = (xs: number[], p: number): number => {
    const s = xs.slice().sort((u, v) => u - v);
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  };
  const mq = b.qalys - a.qalys, mc = b.cost - a.cost;
  const span = (xs: number[], mean: number): [number, number] => {
    let lo = Math.min(pct(xs, 0.03), mean, 0), hi = Math.max(pct(xs, 0.97), mean, 0);
    if (hi - lo < 1e-9) (lo -= 1), (hi += 1);
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  };
  const xr = span(dq, mq), yr = span(dc, mc);
  const plot: Box = { x0: box.x0 + 20, x1: box.x1 - 20, y0: box.y0 + 30, y1: box.y1 - 10 };
  const X = (v: number): number => plot.x0 + ((v - xr[0]) / (xr[1] - xr[0])) * (plot.x1 - plot.x0);
  const Y = (v: number): number => plot.y0 + ((v - yr[0]) / (yr[1] - yr[0])) * (plot.y1 - plot.y0);
  push(
    kit.group("plane_axes", [
      kit.stroke("plane_axes__x", [[plot.x0, Y(0)], [plot.x1, Y(0)]], { color: COLORS.guide, strokeWidth: 2, arrowhead: "end", ms: SKETCH_MS.axis }),
      kit.stroke("plane_axes__y", [[X(0), plot.y0], [X(0), plot.y1]], { color: COLORS.guide, strokeWidth: 2, arrowhead: "end", ms: SKETCH_MS.axis }),
    ]),
    [X(0), Y(0)],
  );
  // A few round numbers on each axis, away from the origin.
  const cur = P.currency ?? "£";
  const tk: Drawable[] = [];
  const xt = roundTicks(xr[0], xr[1], 4);
  xt.ticks.forEach((v, i) => {
    if (Math.abs(v) < 1e-12 || X(v) > plot.x1 - 60) return;
    tk.push(kit.stroke(`plane_ticks__xm${i}`, [[X(v), Y(0) - 5], [X(v), Y(0) + 5]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    tk.push({ ...kit.text(`plane_ticks__xt${i}`, [X(v), Y(0) - 18], kit.num(v, xt.decimals), { fontSize: 15, color: COLORS.guide }), drawOpts: defaultDrawOpts("instant") });
  });
  const yt = roundTicks(yr[0], yr[1], 4);
  yt.ticks.forEach((v, i) => {
    if (Math.abs(v) < 1e-9 || Y(v) > plot.y1 - 30) return;
    tk.push(kit.stroke(`plane_ticks__ym${i}`, [[X(0) - 5, Y(v)], [X(0) + 5, Y(v)]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    tk.push({ ...kit.text(`plane_ticks__yt${i}`, [X(0) - 10, Y(v)], fmtMoney(v, cur), { fontSize: 15, color: COLORS.guide, anchor: "end" }), drawOpts: defaultDrawOpts("instant") });
  });
  push(kit.group("plane_ticks", tk), [X(0), Y(0)]);
  const lx = kit.say({ en: "QALYs gained", nb: "QALY vunnet" });
  const ly = kit.say({ en: "extra cost", nb: "merkostnad" });
  push(text("plane_x_label", [plot.x1, Y(0) - 20], lx, 17, { anchor: "end", color: COLORS.guide }), [plot.x1 - 50, Y(0) - 20]);
  push(text("plane_y_label", [X(0) + 10, plot.y1 - 4], ly, 17, { anchor: "start", color: COLORS.guide }), [X(0) + 50, plot.y1 - 4]);
  o.attached.plane_axes = ["plane_x_label", "plane_y_label", "plane_ticks"];
  o.drawnWith.plane_axes = ["plane_x_label", "plane_y_label", "plane_ticks"];
  if (typeof P.wtp === "number" && P.wtp > 0) {
    // The threshold line through the origin, clipped to the plot.
    const pts: Pt[] = [];
    for (let k = 0; k <= 20; k++) {
      const q = xr[0] + ((xr[1] - xr[0]) * k) / 20;
      const c = q * P.wtp;
      if (c >= yr[0] && c <= yr[1]) pts.push([X(q), Y(c)]);
    }
    if (pts.length > 1) {
      const end = pts[pts.length - 1];
      push(kit.stroke("plane_wtp", pts, { color: COLORS.guide, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }), end);
      const w = `${fmtMoney(P.wtp, cur)}/QALY`;
      const at: Pt = [end[0] + 8, end[1] - 10];
      push(text("plane_wtp_label", at, w, 16, { anchor: "start", color: COLORS.guide }), [at[0] + kit.textWidth(w, 16) / 2, at[1]]);
      o.attached.plane_wtp = ["plane_wtp_label"];
      o.drawnWith.plane_wtp = ["plane_wtp_label"];
    }
  }
  const dots: Drawable[] = [];
  const nDots = Math.min(N, 300);
  for (let i = 0; i < nDots; i++) {
    const x = X(dq[i]), y = Y(dc[i]);
    if (x < plot.x0 || x > plot.x1 || y < plot.y0 || y > plot.y1) continue;
    dots.push(kit.area(`plane_dots__${i}`, kit.circle([x, y], 3, 8), COLORS.accent, { precise: true, opacity: 0.35 }));
  }
  push(kit.group("plane_dots", dots), [X(mq), Y(mc)]);
  const mean: Pt = [X(mq), Y(mc)];
  push(kit.group("plane_mean", [kit.area("plane_mean__dot", kit.circle(mean, 9, 16), COLORS.accent, { precise: true }), kit.stroke("plane_mean__ring", kit.circle(mean, 9, 16), { closed: true, color: COLORS.ink, strokeWidth: 2, instant: true })]), mean);
  const ml = kit.say({ en: "mean", nb: "snitt" });
  const mlAt: Pt = [mean[0] + 16, mean[1] + 16];
  push(text("plane_mean_label", mlAt, ml, 18, { anchor: "start", color: COLORS.accent }), [mlAt[0] + 20, mlAt[1]]);
  o.attached.plane_mean = ["plane_mean_label"];
  o.drawnWith.plane_mean = ["plane_mean_label"];
  return { x: xr, y: yr, box: plot };
}

// ---- the controls and the cursor ------------------------------------------------------

/** The hazard ratio the controls show: a number, or the first entry of a map. */
export function shownHr(P: HtaParams): { value: number; key: string | null } | null {
  const h = P.strategies?.[1]?.hr;
  if (typeof h === "number") return { value: h, key: null };
  if (h && typeof h === "object") {
    const k = Object.keys(h)[0];
    if (k !== undefined && typeof h[k] === "number") return { value: h[k], key: k };
  }
  return null;
}

function drawControls(o: Out, P: HtaParams, y: number, x0: number, x1: number): void {
  const push = pusher(o);
  const cur = P.currency ?? "£";
  const FS = 22;
  const items: { id: string; label: string; value: string }[] = [];
  const hr = shownHr(P);
  if (hr) items.push({ id: "knob_hr", label: hr.key ? `HR (${hr.key})` : kit.say({ en: "hazard ratio", nb: "hasardratio" }), value: kit.num(hr.value, 2) });
  const cost = P.strategies?.[1]?.cost;
  if (typeof cost === "number") items.push({ id: "knob_cost", label: kit.say({ en: "drug", nb: "legemiddel" }), value: `${fmtMoney(cost, cur)}/${kit.say({ en: "yr", nb: "år" })}` });
  let X = x0;
  for (const it of items) {
    const lw = kit.textWidth(it.label, FS - 2), vw = kit.textWidth(it.value, FS);
    push(
      kit.group(it.id, [
        kit.text(`${it.id}__l`, [X, y], it.label, { fontSize: FS - 2, anchor: "start", color: COLORS.guide }),
        kit.text(`${it.id}__v`, [X + lw + 8, y], it.value, { fontSize: FS, anchor: "start", color: COLORS.accent }),
      ]),
      [X + lw + 8 + vw / 2, y],
    );
    X += lw + vw + 36;
  }
  const re = kit.say({ en: "new patients ↻", nb: "nye pasienter ↻" });
  const rw = kit.textWidth(re, 17) + 24;
  const at: Pt = [x1 - rw / 2, y];
  push(kit.pad("reseed", at, re, { w: rw, h: 30 }, { fontSize: 17, color: COLORS.guide }), at);
  o.groups.controls = [...items.map((i) => i.id), "reseed"];
}

/**
 * The cursor: a dashed line per time axis — `cursor` on the first (the
 * frame's), `cursor_b` on the intervention's column, `cursor_curves` on the
 * overview's curves — each drawn with what it crosses (the first lane of a
 * column, the curves' axes), so a cast that has not drawn the second column
 * yet shows no line through its empty half. `cursors` is the SET.
 */
function drawCursor(o: Out, tCur: number, H: number, spans: Span[], knobAt: number): void {
  const push = pusher(o);
  spans.forEach((c) => {
    const X = c.x0 + (tCur / H) * (c.x1 - c.x0);
    push(kit.stroke(c.id, [[X, c.y0], [X, c.y1]], { color: COLORS.ink, strokeWidth: 1.8, dash: true, instant: true }), [X, (c.y0 + c.y1) / 2]);
  });
  const X0 = spans[0].x0 + (tCur / H) * (spans[0].x1 - spans[0].x0);
  const s = `t = ${kit.num(Number(tCur.toFixed(1)), 1)}`;
  const w = kit.textWidth(s, 16) + 16;
  push(kit.pad("cursor_knob", [X0, knobAt], s, { w, h: 24 }, { fontSize: 16, color: COLORS.ink }), [X0, knobAt]);
  o.attached.cursor = ["cursor_knob"];
  o.drawnWith.cursor = ["cursor_knob"];
  o.groups.cursors = [...spans.map((c) => c.id), "cursor_knob"];
  for (const c of spans.slice(1)) {
    const host = c.id === "cursor_b" ? (o.groups.lanes_b ?? []).slice(0, 1) : ["curve_axes"];
    for (const h of host) (o.drawnWith[h] ??= []).push(c.id);
  }
}

/** One stretch of time axis on the page: x0 is t = 0, x1 the horizon; y0…y1 the height its cursor line runs. */
export interface Span {
  /** The cursor line's id on this axis. */
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * The page's time axes (layout units) — the timelines' two columns, the
 * curves' plot — in the order the cursor's frame reads them: the FIRST is
 * the layout's `frame` (x: 0…horizon, y: 0…1 over its y0…y1), so a widget
 * reads any pointer through the frame and finds the span it is in. Null for
 * a view without time (results, diagram).
 */
export function timeSpans(P: HtaParams): { horizon: number; spans: Span[]; knobAt: number } | null {
  const m = readModel(P);
  if (!m) return null;
  const g = geometryOf(P);
  const spans: Span[] = [];
  let knobAt = 0;
  if (g.timelines) {
    const tg = tlGeom(g.timelines, g.rows, g.view === "overview" ? 26 : 34);
    tg.cols.forEach((c, i) => spans.push({ id: i === 0 ? "cursor" : "cursor_b", x0: c.x0, x1: c.x1, y0: tg.axisY, y1: tg.top + 4 }));
    knobAt = tg.top + 12;
  }
  if (g.curves) {
    const p = curvePlot(g.curves, g.view === "overview");
    spans.push({ id: spans.length ? "cursor_curves" : "cursor", x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 });
    if (!g.timelines) knobAt = p.y0 - 44;
  }
  return spans.length ? { horizon: m.horizon, spans, knobAt } : null;
}

// ---- the page ----------------------------------------------------------------------------

/** Where each view puts its parts (also what the widget reads the pointer through). */
export interface Geometry {
  view: View;
  header: Box | null;
  timelines: Box | null;
  rows: number;
  curves: Box | null;
  table: Box | null;
  plane: Box | null;
  diagram: Box | null;
  controlsY: number;
}

export function geometryOf(P: HtaParams): Geometry {
  const view = viewOf(P);
  const title = typeof P.title === "string" && P.title.trim() !== "";
  // The top strip stays free for a card heading (its underline sits near
  // y 696): nothing inks above 680 — above 650 under the template's own title.
  const top = title ? 650 : 680;
  const rows = Math.max(1, Math.min(MAX_TL_SHOW, Math.round(typeof P.show === "number" ? P.show : 12)));
  const header: Box = { x0: 60, x1: 940, y0: top - 78, y1: top };
  const base = { view, header: null, timelines: null, rows, curves: null, table: null, plane: null, diagram: null, controlsY: 26 } as Geometry;
  if (view === "timelines") return { ...base, header, timelines: { x0: 30, x1: 970, y0: 50, y1: header.y0 - 16 } };
  if (view === "curves") return { ...base, header, curves: { x0: 60, x1: 960, y0: 50, y1: header.y0 - 10 } };
  if (view === "results") return { ...base, table: { x0: 150, x1: 850, y0: top - 270, y1: top }, plane: { x0: 200, x1: 800, y0: 60, y1: top - 300 } };
  if (view === "diagram") return { ...base, diagram: { x0: 40, x1: 960, y0: 200, y1: top - 40 } };
  // overview
  return {
    ...base,
    header,
    rows: Math.min(rows, 8),
    timelines: { x0: 20, x1: 500, y0: 50, y1: header.y0 - 16 },
    curves: { x0: 520, x1: 985, y0: 300, y1: header.y0 - 8 },
    table: { x0: 540, x1: 975, y0: 60, y1: 285 },
  };
}

/** The cursor's time: `t` clamped to the horizon, or the horizon when unset. */
export function cursorOf(P: HtaParams, H: number): { t: number; shown: boolean } {
  return typeof P.t === "number" && Number.isFinite(P.t) ? { t: Math.max(0, Math.min(H, P.t)), shown: true } : { t: H, shown: false };
}

export function layoutDesHta(P: HtaParams): SceneLayout {
  const o = newOut();
  const push = pusher(o);
  const sim = simulateParams(P);
  const m = sim?.model ?? readModel(P);
  if (!sim || !m) {
    push(text("empty", [500, 380], kit.say({ en: "No model to simulate", nb: "Ingen modell å simulere" }), 26, { color: COLORS.guide }), [500, 380]);
    return { drawables: o.drawables, labels: [], anchors: o.anchors, order: o.order };
  }
  const g = geometryOf(P);
  const H = m.horizon;
  const cur = cursorOf(P, H);
  if (typeof P.title === "string" && P.title.trim()) push(text("title", [500, 715], P.title, fit(P.title, 30, 900)), [500, 715]);
  if (g.header) drawDiagram(o, P, m, g.header, false);
  if (g.diagram) {
    drawDiagram(o, P, m, g.diagram, true);
    drawStrategies(o, P, m, 150);
  }
  let frame: SceneLayout["frame"];
  if (g.timelines) drawTimelines(o, P, sim, g.timelines, g.rows, cur.t, g.view === "overview");
  if (g.curves) {
    const cg = drawCurves(o, sim, g.curves, cur.t, g.view === "overview");
    if (cur.shown) readouts(o, sim, cg, cur.t);
  }
  const ts = timeSpans(P);
  if (ts) {
    const f = ts.spans[0];
    frame = { x: [0, H], y: [0, 1], box: { x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1 } };
  }
  if (g.table) drawTable(o, P, sim, g.table, g.view === "overview");
  if (g.plane) {
    const pg = drawPlane(o, P, sim, g.plane);
    frame = { x: pg.x, y: pg.y, box: pg.box };
  }
  if (cur.shown && ts) drawCursor(o, cur.t, H, ts.spans, ts.knobAt);
  drawControls(o, P, g.controlsY, g.view === "overview" ? 40 : 60, g.view === "overview" ? 985 : 940);
  const values = htaValues(P, sim, cur.t);
  return {
    drawables: o.drawables,
    labels: [],
    anchors: o.anchors,
    order: o.order,
    ...(frame ? { frame } : {}),
    ...(Object.keys(o.groups).length ? { groups: o.groups } : {}),
    ...(Object.keys(o.attached).length ? { attached: o.attached } : {}),
    ...(Object.keys(o.drawnWith).length ? { drawnWith: o.drawnWith } : {}),
    values,
  };
}

/** Dots on the curves at the cursor, and the share alive under each. */
function readouts(o: Out, sim: SimResult, cg: CurveGeom, t: number): void {
  const push = pusher(o);
  const m = sim.model;
  if (m.dead < 0) return;
  const alive = sim.arms.map((arm) => 1 - occAt(arm, m.dead, t, m.horizon));
  // Right of the cursor, where no curve is drawn yet (the curves stop at t).
  const left = false;
  // The higher curve's number above its dot, the lower's below — unless below
  // is the axis: then both go above, the higher one clear of the lower.
  const hi = alive[1] >= alive[0] ? 1 : 0;
  const lowY = cg.Y(alive[1 - hi]);
  const floor = lowY - cg.Y(0) < 50;
  const yOf = [0, 0];
  yOf[1 - hi] = floor ? Math.max(lowY + 14, cg.Y(0) + 34) : lowY - 14;
  yOf[hi] = Math.max(cg.Y(alive[hi]) + 14, floor ? yOf[1 - hi] + 28 : -Infinity);
  // At the plot's top (everyone alive): both under their dots instead.
  if (yOf[hi] > cg.plot.y1 - 8) {
    yOf[hi] = cg.Y(alive[hi]) - 16;
    yOf[1 - hi] = Math.min(lowY - 16, yOf[hi] - 28);
  }
  sim.arms.forEach((_arm, ai) => {
    const k = ARM_KEYS[ai];
    const v = alive[ai];
    const at: Pt = [cg.X(t), cg.Y(v)];
    push(kit.area(`alive_dot_${k}`, kit.circle(at, 6, 12), ARM_COLORS[ai], { precise: true }), at);
    const s = `${Math.round(v * 100)}%`;
    const lat: Pt = [at[0] + (left ? -10 : 10), yOf[ai]];
    push(text(`alive_${k}`, lat, s, 17, { anchor: left ? "end" : "start", color: ARM_COLORS[ai] }), [lat[0] + (left ? -15 : 15), lat[1]]);
    o.attached[`alive_dot_${k}`] = [`alive_${k}`];
  });
}

/** Under the big diagram: what each strategy does, in a line each. */
function drawStrategies(o: Out, P: HtaParams, m: Model, y: number): void {
  const push = pusher(o);
  const cur = P.currency ?? "£";
  m.strategies.forEach((s, ai) => {
    const k = ARM_KEYS[ai];
    const bits: string[] = [];
    const hrs = m.events.map((e, i) => (s.hr[i] !== 1 ? `HR ${kit.num(s.hr[i], 2)} ${e.name}` : null)).filter(Boolean) as string[];
    const uniq = [...new Set(hrs)];
    if (uniq.length) bits.push(uniq.join(", "));
    if (s.cost) bits.push(`${fmtMoney(s.cost, cur)}/${kit.say({ en: "yr", nb: "år" })}${s.until >= 0 ? ` ${kit.say({ en: "until", nb: "til" })} ${m.states[s.until].name}` : ""}`);
    const line = `${s.name}${bits.length ? ": " + bits.join(" · ") : ""}`;
    const at: Pt = [500, y - ai * 34];
    push(text(`strategy_${k}`, at, line, fit(line, 21, 900), { color: ARM_COLORS[ai] }), at);
  });
  const bits: string[] = [];
  if (m.background) bits.push(kit.say({ en: `background mortality from age ${m.age}`, nb: `bakgrunnsdødelighet fra ${m.age} år` }));
  if (m.risk) bits.push(`${P.risk?.label ?? kit.say({ en: "risk factor", nb: "risikofaktor" })}: ${Math.round(m.risk.share * 100)}%, HR ${kit.num(m.risk.hr, 2)}`);
  if (bits.length) {
    const s = bits.join(" · ");
    push(text("model_note", [500, y - 72], s, fit(s, 17, 900), { color: COLORS.guide }), [500, y - 72]);
  }
}

/**
 * The simulation's numbers for `{hta.<key>}` tokens, as the table writes
 * them (so a caption quoting {hta.dqaly} agrees with the table's row):
 *
 *   cost_a, cost_b, qalys_a, qalys_b   mean per patient, discounted (a the comparator, b the intervention)
 *   dcost, dqaly                       b − a, of the shown numbers
 *   icer                               cost per QALY gained (only when QALYs are gained at a cost)
 *   ly_a, ly_b, dly                    mean life years within the horizon (restricted mean OS), undiscounted
 *   os_a, os_b                         the same as ly_*
 *   pfs_a, pfs_b                       mean years in the first state (restricted mean PFS)
 *   alive_a, alive_b, pf_a, pf_b       % alive / in the first state at the cursor t
 *   t, horizon, patients, hr, seed
 */
export function htaValues(P: HtaParams, sim: SimResult, t: number): Record<string, number> {
  const sh = shownResults(sim);
  const m = sim.model;
  const v: Record<string, number> = {
    cost_a: sh.cost[0],
    cost_b: sh.cost[1],
    qalys_a: sh.qalys[0],
    qalys_b: sh.qalys[1],
    dcost: sh.dcost,
    dqaly: sh.dqaly,
    ly_a: sh.ly[0],
    ly_b: sh.ly[1],
    os_a: sh.ly[0],
    os_b: sh.ly[1],
    dly: sh.dly,
    pfs_a: q2(sim.arms[0].timeIn[0]),
    pfs_b: q2(sim.arms[1].timeIn[0]),
    t: Number(t.toFixed(2)),
    horizon: m.horizon,
    patients: m.patients,
    seed: m.seed,
  };
  if (sh.icer !== null) v.icer = sh.icer;
  const hr = shownHr(P);
  if (hr) v.hr = hr.value;
  sim.arms.forEach((arm, ai) => {
    const k = ARM_KEYS[ai];
    if (m.dead >= 0) v[`alive_${k}`] = Math.round((1 - occAt(arm, m.dead, t, m.horizon)) * 100);
    v[`pf_${k}`] = Math.round(occAt(arm, 0, t, m.horizon) * 100);
  });
  return v;
}

export { slugify, weibullScale, medianOf };
