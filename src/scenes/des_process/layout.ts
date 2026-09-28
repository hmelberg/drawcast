// des_process: a process or queueing network as a flow diagram, left → right
// — sources, stations (a lane of waiting tokens before c server boxes that
// show busy or idle), delays, sinks with their counter, routes with their
// shares — and the entities as tokens where the simulation has them at time
// `t`. Beside it a live readout per station, the clock, and up to two
// charts: a quantity over time with a cursor at t, or the mean wait against
// utilisation with queueing theory's curve.
//
// The run is simulated ONCE per params (engine.ts, cached here by the params
// that shape it); an animate of `t` only reads it. Tokens are the children
// of stable parts (queue_<id>, server_<id>, route_<a>_<b>, node_<id> of a
// delay), so an animate frame that moves them never mints an id.
import { plotArea, type PlotArea } from "../../layout/canvas";
import { COLORS, SKETCH_MS, type Drawable, type Pt } from "../../layout/model";
import { kit, type StrokeOpts } from "../kit";
import type { SceneLayout } from "../types";
import { drawAxes, niceCeil, roundTicks } from "../plot-axes";
import { simulate, stationStats, stationTheory, stepPoints, systemStats, tokensAt, trafficRates, waitApprox, type Run, type StationStats, type TokenAt } from "./engine";
import { readCharts, readModel, type ChartKind, type DesParams, type Model, type ModelNode } from "./model";

export type { DesParams } from "./model";

// ---- the run, cached by what shapes it -----------------------------------------------

const RUN_KEYS = ["nodes", "entity", "horizon", "warmup", "seed", "transit"] as const;
const cache = new Map<string, Run>();
const CACHE_SIZE = 24;

/** The params' run: simulated once, then read (an animate of t re-lays out ~60 times a second). */
export function runOf(P: DesParams): Run {
  const key = JSON.stringify(RUN_KEYS.map((k) => (P as Record<string, unknown>)[k] ?? null));
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const run = simulate(readModel(P));
  cache.set(key, run);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return run;
}

// ---- words and numbers ---------------------------------------------------------------

/** A number the way the figure writes it: 2 decimals under 1, 1 under 10, else whole. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return kit.num(Number(v.toFixed(a < 1 ? 2 : a < 10 ? 1 : 0)), a < 1 ? 2 : a < 10 ? 1 : 0);
}

/** The arrival text under a source. */
export function rateText(n: ModelNode, unit: string): string {
  if (n.schedule) {
    const lo = Math.min(...n.schedule.rates),
      hi = Math.max(...n.schedule.rates);
    return lo === hi ? `${fmt(hi)} / ${unit}` : `${fmt(lo)}–${fmt(hi)} / ${unit}`;
  }
  // Given as a rate, it reads as one whatever its spread (a CV animated through 0 keeps its words).
  if (n.inter && n.gapFrom === "rate") return `${fmt((n.batch?.mean ?? 1) / n.inter.mean)} / ${unit}`;
  if (n.inter) {
    if (n.inter.kind === "exponential") return `${fmt(1 / n.inter.mean)} / ${unit}`;
    if (n.inter.kind === "fixed") return `every ${fmt(n.inter.mean)} ${unit}`;
    return `every ≈${fmt(n.inter.mean)} ${unit}`;
  }
  if (n.times) return `${n.times.length} arrivals`;
  return "";
}

/** The service (or delay) text under a station or delay. */
export function serviceText(n: ModelNode, unit: string): string {
  const d = n.service;
  if (!d) return "";
  const s = d.spec as Record<string, number>;
  if (d.kind === "fixed") return `${fmt(d.mean)} ${unit}`;
  if (d.kind === "uniform" || d.kind === "triangular") return `${fmt(s.min)}–${fmt(s.max)} ${unit}`;
  return `≈${fmt(d.mean)} ${unit}`;
}

/** A node's variability readout ("CV 1.5"), or "" when the spec sets none. */
export function varText(n: ModelNode): string {
  return n.variability === undefined ? "" : `CV ${kit.num(Number(n.variability.toFixed(1)), 1)}`;
}

/** A source's group size ("groups of 3", "groups of ≈2"), or "". */
export function batchText(n: ModelNode): string {
  if (!n.batch) return "";
  return n.batch.fixed ? `groups of ${n.batch.mean}` : `groups of ≈${fmt(n.batch.mean)}`;
}

/** Colour of a token of priority class p, given the classes present. */
export function tokenColor(p: number, classes: number[]): string {
  if (classes.length <= 1) return COLORS.supply;
  const k = classes.indexOf(p);
  return [COLORS.demand, COLORS.shifted, COLORS.supply, COLORS.accent, COLORS.region2][Math.max(0, k) % 5];
}

// ---- geometry -------------------------------------------------------------------------

export const TOKEN_R = 10;
export const TOKEN_GAP = 25;
const LANE_H = 38;
const BOX = 40;
const BOX_GAP = 6;
const NODE_R = 30;
const LABEL_FONT = 26;
const NUM_FONT = 22;
const READ_FONT = 20;
const DELAY_W = 104;
const DELAY_H = 58;

export interface NodeGeo {
  index: number;
  /** Centre line: arrows meet the node here. */
  cx: number;
  cy: number;
  /** The node's core box (lane + servers, the circle, the delay's box). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Where arrows leave and arrive. */
  inPort: Pt;
  outPort: Pt;
  layer: number;
  // station
  laneX0?: number;
  laneX1?: number;
  slots?: number;
  serverAt?: Pt[];
}

export interface RouteGeo {
  from: number;
  to: number;
  p: number;
  pts: Pt[];
  /** Along it, cumulative length fractions. */
  cum: number[];
  labelAt: Pt;
}

export interface Geometry {
  nodes: NodeGeo[];
  routes: RouteGeo[];
  flow: { x0: number; x1: number; y0: number; y1: number };
  charts: { of: ChartKind; station: number | null; y_max?: number; plot: PlotArea; suffix: string }[];
  clock: Pt;
  reroll: Pt;
}

/** Server box centres of a station with c servers, its column's right edge at x1, centred on cy. */
function serverCentres(c: number, x0: number, cy: number): { at: Pt[]; w: number; h: number } {
  const rows = Math.min(c, 4);
  const cols = Math.ceil(c / 4);
  const at: Pt[] = [];
  for (let i = 0; i < c; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    at.push([x0 + BOX / 2 + col * (BOX + BOX_GAP), cy + ((rows - 1) / 2 - row) * (BOX + BOX_GAP)]);
  }
  return { at, w: cols * BOX + (cols - 1) * BOX_GAP, h: rows * BOX + (rows - 1) * BOX_GAP };
}

/** Layers by longest path from the sources over forward edges (back edges found by DFS); sinks last. */
export function layersOf(m: Model): { layer: number[]; back: Set<string> } {
  const N = m.nodes.length;
  const state = new Array(N).fill(0);
  const back = new Set<string>();
  const order: number[] = [];
  const visit = (i: number): void => {
    state[i] = 1;
    for (const r of m.nodes[i].routes) {
      if (state[r.to] === 1) back.add(`${i}>${r.to}`);
      else if (state[r.to] === 0) visit(r.to);
    }
    state[i] = 2;
    order.push(i);
  };
  for (const n of m.nodes) if (n.kind === "source" && state[n.index] === 0) visit(n.index);
  for (let i = 0; i < N; i++) if (state[i] === 0) visit(i);
  const layer = new Array(N).fill(0);
  for (const i of order.reverse())
    for (const r of m.nodes[i].routes) if (!back.has(`${i}>${r.to}`)) layer[r.to] = Math.max(layer[r.to], layer[i] + 1);
  const maxL = Math.max(0, ...layer);
  m.nodes.forEach((n, i) => {
    if (n.kind === "sink") layer[i] = maxL;
  });
  return { layer, back };
}

/** Where everything goes on the page. */
export function geometry(P: DesParams, m: Model): Geometry {
  const page = plotArea();
  const top = page.y1 + 45;
  const charts = readCharts(P, m);
  const hasCharts = charts.length > 0;
  const readouts = P.readouts !== false;
  const flow = { x0: 30, x1: 970, y0: hasCharts ? 350 : 130, y1: top };
  const { layer, back } = layersOf(m);
  const nL = Math.max(1, ...layer.map((l) => l + 1));
  const byLayer: number[][] = Array.from({ length: nL }, () => []);
  m.nodes.forEach((_n, i) => byLayer[layer[i]].push(i));

  // Widths: a station's lane takes what the page has left.
  const labelW = (n: ModelNode): number => kit.textWidth(n.label, LABEL_FONT) + 8;
  const serverW = (n: ModelNode): number => serverCentres(n.servers, 0, 0).w;
  const fixedW = (n: ModelNode): number =>
    n.kind === "station"
      ? serverW(n) + 12
      : n.kind === "delay"
        ? Math.max(DELAY_W, labelW(n))
        : Math.max(2 * NODE_R + 10, Math.min(labelW(n), 150), kit.textWidth(rateText(n, m.unit), NUM_FONT) + 8, ...[varText(n), batchText(n)].filter(Boolean).map((x) => kit.textWidth(x, READ_FONT) + 8));
  let gap = 80;
  const stationLayers = byLayer.filter((l) => l.some((i) => m.nodes[i].kind === "station")).length;
  const widthWith = (lane: number): number =>
    byLayer.reduce((a, l) => a + Math.max(0, ...l.map((i) => fixedW(m.nodes[i]) + (m.nodes[i].kind === "station" ? lane : 0))), 0) + gap * (nL - 1);
  const avail = flow.x1 - flow.x0;
  let lane = 190;
  if (stationLayers > 0) {
    lane = Math.min(230, (avail - widthWith(0)) / stationLayers);
    if (lane < 80) {
      gap = 50;
      lane = Math.max(60, (avail - widthWith(0)) / stationLayers);
    }
  }
  const layerW = byLayer.map((l) => Math.max(0, ...l.map((i) => fixedW(m.nodes[i]) + (m.nodes[i].kind === "station" ? lane : 0))));
  const total = layerW.reduce((a, b) => a + b, 0) + gap * (nL - 1);
  let x = flow.x0 + Math.max(0, (avail - total) / 2);
  const layerX: number[] = [];
  for (let k = 0; k < nL; k++) {
    layerX.push(x);
    x += layerW[k] + gap;
  }

  // Heights: the label above the core, the numbers and readouts below it.
  // (A variability readout, a batch's words: one more line each under the node.)
  const extra = (n: ModelNode): number => (varText(n) ? 30 : 0) + (batchText(n) ? 30 : 0);
  const below = (n: ModelNode): number => (n.kind === "station" ? 32 + (readouts ? 56 : 0) + (Number.isFinite(n.capacity) ? 26 : 0) : n.kind === "sink" ? 6 : 30) + extra(n);
  const coreH = (n: ModelNode): number => (n.kind === "station" ? Math.max(LANE_H, serverCentres(n.servers, 0, 0).h) : n.kind === "delay" ? DELAY_H : 2 * NODE_R);
  const above = 36;
  const nodes: NodeGeo[] = new Array(m.nodes.length);
  // The flow line every lone node of its layer sits on, so a chain's arrows run level.
  const lone = byLayer.filter((l) => l.length === 1).map((l) => m.nodes[l[0]]);
  const lo = Math.max(flow.y0, ...lone.map((n) => flow.y0 + coreH(n) / 2 + below(n)));
  const hi = Math.min(flow.y1, ...lone.map((n) => flow.y1 - above - coreH(n) / 2));
  // With charts below, the flow keeps to the top and the charts take what it leaves.
  const lineY = lo > hi ? hi : hasCharts ? Math.max(lo, hi - 25) : (lo + hi) / 2;
  byLayer.forEach((ids, k) => {
    const blocks = ids.map((i) => above + coreH(m.nodes[i]) + below(m.nodes[i]));
    const H = flow.y1 - flow.y0;
    const sum = blocks.reduce((a, b) => a + b, 0);
    const spare = hasCharts ? Math.min(18, Math.max(0, H - sum - 25) / (ids.length + 1)) : Math.max(0, H - sum) / (ids.length + 1);
    let y = flow.y1 - spare - (hasCharts && H - sum > 25 ? 25 : 0);
    ids.forEach((i, j) => {
      const n = m.nodes[i];
      const ch = coreH(n);
      // A lone node sits on the page's flow line, so a chain's arrows run level.
      const cy = ids.length === 1 ? lineY : y - above - ch / 2;
      y -= blocks[j] + spare;
      const w = fixedW(n) + (n.kind === "station" ? lane : 0);
      const cx = layerX[k] + layerW[k] / 2;
      const x0 = cx - w / 2;
      const g: NodeGeo = { index: i, cx, cy, x0, x1: x0 + w, y0: cy - ch / 2, y1: cy + ch / 2, inPort: [x0, cy], outPort: [x0 + w, cy], layer: k };
      if (n.kind === "station") {
        const sw = serverW(n);
        const laneX0 = x0;
        const laneX1 = x0 + lane;
        const sc = serverCentres(n.servers, laneX1 + 12, cy);
        g.laneX0 = laneX0;
        g.laneX1 = laneX1;
        g.slots = Math.max(2, Math.floor((lane - 6) / TOKEN_GAP));
        g.serverAt = sc.at;
        g.x1 = laneX1 + 12 + sw;
        g.outPort = [g.x1, cy];
      } else if (n.kind === "delay") {
        const dw = Math.max(DELAY_W, Math.min(w, DELAY_W + 40));
        g.x0 = cx - dw / 2;
        g.x1 = cx + dw / 2;
        g.inPort = [g.x0, cy];
        g.outPort = [g.x1, cy];
      } else {
        g.x0 = cx - NODE_R;
        g.x1 = cx + NODE_R;
        g.inPort = [cx - NODE_R, cy];
        g.outPort = [cx + NODE_R, cy];
      }
      nodes[i] = g;
    });
  });

  // Routes: straight to the next layer; bowed over anything in between; a
  // back edge loops under the page's flow.
  const routes: RouteGeo[] = [];
  const lowest = Math.min(...nodes.map((g) => g.y0 - below(m.nodes[g.index])));
  const highest = Math.max(...nodes.map((g) => g.y1 + above));
  for (const n of m.nodes)
    for (const r of n.routes) {
      const a = nodes[n.index];
      const b = nodes[r.to];
      const s: Pt = a.outPort;
      const e: Pt = b.inPort;
      let pts: Pt[];
      if (back.has(`${n.index}>${r.to}`) || b.layer <= a.layer) {
        const y = Math.max(flow.y0 + 8, lowest - 16);
        pts = kit.smooth([s, [s[0] + 26, s[1] - 30], [s[0] + 20, y], [(s[0] + e[0]) / 2, y - 6], [e[0] - 20, y], [e[0] - 26, e[1] - 30], e], 6);
      } else {
        const between = nodes.filter((g) => g.layer > a.layer && g.layer < b.layer);
        const blocked = between.some((g) => {
          const u = (g.cx - s[0]) / (e[0] - s[0]);
          const yLine = s[1] + u * (e[1] - s[1]);
          return yLine > g.y0 - 30 && yLine < g.y1 + 40;
        });
        if (blocked) {
          const y = Math.min(flow.y1 - 4, highest + 10);
          const mid: Pt = [(s[0] + e[0]) / 2, y];
          const q = (u: number): Pt => [(1 - u) ** 2 * s[0] + 2 * u * (1 - u) * mid[0] + u * u * e[0], (1 - u) ** 2 * s[1] + 2 * u * (1 - u) * (2 * y - (s[1] + e[1]) / 2) + u * u * e[1]];
          pts = Array.from({ length: 25 }, (_, k) => q(k / 24));
        } else pts = [s, e];
      }
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const L = cum[cum.length - 1] || 1;
      const frac = cum.map((c) => c / L);
      // The share's label: over the arrow, a third of the way along (branches fan apart there).
      const at = pointAlong(pts, frac, n.routes.length > 1 ? 0.42 : 0.5);
      const dir = pointAlong(pts, frac, 0.55);
      const prev = pointAlong(pts, frac, 0.3);
      const dx = dir[0] - prev[0],
        dy = dir[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len,
        ny = dx / len;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      routes.push({ from: n.index, to: r.to, p: r.p, pts, cum: frac, labelAt: [at[0] + nx * 17, at[1] + ny * 17] });
      // Of a node's branches, the one that leaves highest keeps its share
      // above it; the others' go below theirs, off their siblings' arrows.
      if (n.routes.length > 1 && routes.filter((q) => q.from === n.index).length === n.routes.length) {
        const mine = routes.filter((q) => q.from === n.index);
        const rise = (q: RouteGeo): number => pointAlong(q.pts, q.cum, 0.25)[1];
        const top = mine.reduce((b, q) => (rise(q) > rise(b) ? q : b));
        for (const q of mine) {
          if (q === top) continue;
          const u = 0.42;
          const p0 = pointAlong(q.pts, q.cum, u);
          const d1 = pointAlong(q.pts, q.cum, 0.55),
            d0 = pointAlong(q.pts, q.cum, 0.3);
          const l = Math.hypot(d1[0] - d0[0], d1[1] - d0[1]) || 1;
          let mx = -(d1[1] - d0[1]) / l,
            my = (d1[0] - d0[0]) / l;
          if (my > 0) {
            mx = -mx;
            my = -my;
          }
          q.labelAt = [p0[0] + mx * 21, p0[1] + my * 21];
        }
      }
    }

  // Charts: one wide, or two side by side, as tall as the flow leaves room
  // for (the clock's row between them).
  let flowBottom = lowest;
  for (const r of routes) for (const p of r.pts) flowBottom = Math.min(flowBottom, p[1] - 14);
  const y1 = Math.max(248, Math.min(340, flowBottom - 100));
  const chartRows = charts.map((c, k) => {
    const plot: PlotArea = charts.length === 1 ? { x0: 130, x1: 900, y0: 110, y1 } : k === 0 ? { x0: 110, x1: 440, y0: 110, y1 } : { x0: 600, x1: 930, y0: 110, y1 };
    return { ...c, plot, suffix: k === 0 ? "" : "_2" };
  });
  const clock: Pt = hasCharts ? [965, y1 + 72] : [965, 70];
  // "new run" just left of the clock, its circle arrow first (the point is the arrow's centre).
  const reroll: Pt = [clock[0] - kit.textWidth(clockText(m.horizon, m), 26) - 36 - kit.textWidth("new run", 19) - 16, clock[1]];
  return { nodes, routes, flow, charts: chartRows, clock, reroll };
}

/** The point at length-fraction u along a polyline. */
export function pointAlong(pts: Pt[], cum: number[], u: number): Pt {
  const v = Math.max(0, Math.min(1, u));
  for (let k = 1; k < pts.length; k++)
    if (cum[k] >= v) {
      const span = cum[k] - cum[k - 1] || 1;
      const w = (v - cum[k - 1]) / span;
      return [pts[k - 1][0] + w * (pts[k][0] - pts[k - 1][0]), pts[k - 1][1] + w * (pts[k][1] - pts[k - 1][1])];
    }
  return pts[pts.length - 1];
}

/** The clock's words. */
export function clockText(t: number, m: Model): string {
  const d = m.horizon >= 100 ? 0 : m.horizon >= 10 ? 1 : 2;
  return `t = ${kit.num(Number(t.toFixed(d)), d)} ${m.unit}`;
}

/** The time on screen: `t`, else the horizon; clamped to the run. */
export function timeOf(P: DesParams, m: Model): number {
  const t = typeof P.t === "number" && Number.isFinite(P.t) ? P.t : m.horizon;
  return Math.max(0, Math.min(m.horizon, t));
}

const r3 = (v: number): number => Number(v.toFixed(3));

/** What each station's readout says: two short lines. */
export function readoutLines(s: StationStats, unit: string): [string, string] {
  const util = Math.round(s.util * 100);
  return [`${s.queue} waiting · ${util}% busy`, Number.isFinite(s.wait) ? `wait ≈${fmt(s.wait)} ${unit}` : "wait –"];
}

// ---- the layout ------------------------------------------------------------------------

export function layoutDes(P: DesParams): SceneLayout {
  const run = runOf(P);
  const m = run.model;
  const t = timeOf(P, m);
  const G = geometry(P, m);
  const drawables: Drawable[] = [];
  const order: string[] = [];
  const anchors: Record<string, Pt> = {};
  const attached: Record<string, string[]> = {};
  const drawnWith: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};
  const values: Record<string, number> = {};
  const push = (d: Drawable, at: Pt): void => {
    drawables.push(d);
    order.push(d.id);
    anchors[d.id] = at;
  };
  const addTo = (group: string, id: string): void => {
    (groups[group] ??= []).push(id);
  };
  const classes = [...new Set(m.nodes.filter((n) => n.kind === "source").map((n) => n.priority))].sort((a, b) => a - b);
  const tokens = tokensAt(run, t);
  const tokenAt = (id: string, c: Pt, p: number): Drawable => {
    const col = tokenColor(p, classes);
    return disc(id, c, TOKEN_R, { color: col, fill: col, strokeWidth: 2, roughness: 0.4, ms: SKETCH_MS.dot });
  };
  const nodeId = (i: number): string => m.nodes[i].id;
  const controls = P.controls !== false;

  // ---- routes first (under the nodes), each with the tokens on it ----------------------
  const rates = trafficRates(m);
  const batched = m.nodes.some((n) => !!n.batch);
  for (const r of G.routes) {
    const id = `route_${nodeId(r.from)}_${nodeId(r.to)}`;
    const kids: Drawable[] = [kit.stroke(`${id}__line`, r.pts, { arrowhead: "end", color: COLORS.ink, strokeWidth: 2.5, roughness: 0.8, ms: SKETCH_MS.arrow })];
    let k = 0;
    // A group that came together travels together: each after the first a token's width behind.
    const len = r.pts.reduce((a, p, i) => (i > 0 ? a + Math.hypot(p[0] - r.pts[i - 1][0], p[1] - r.pts[i - 1][1]) : 0), 0) || 1;
    let prevFrac = NaN,
      behind = 0;
    for (const tk of tokens)
      if (tk.where === "transit" && tk.from === r.from && tk.to === r.to) {
        behind = batched && tk.frac === prevFrac ? behind + 1 : 0;
        prevFrac = tk.frac;
        const u = Math.max(0, Math.min(0.94, tk.frac) - (behind * 2.2 * TOKEN_R) / len);
        kids.push(tokenAt(`${id}__tok${k++}`, pointAlong(r.pts, r.cum, u), tk.priority));
      }
    push({ id, kind: "group", z: 1, style: kids[0].style, drawOpts: kids[0].drawOpts, children: kids }, pointAlong(r.pts, r.cum, 0.5));
    addTo("routes", id);
    if (m.nodes[r.from].routes.length > 1) {
      const pid = `share_${nodeId(r.from)}_${nodeId(r.to)}`;
      push(kit.text(pid, r.labelAt, `${Math.round(r.p * 100)}%`, { fontSize: NUM_FONT, color: COLORS.accent }), r.labelAt);
      attached[id] = [pid];
      drawnWith[id] = [pid];
      addTo("routes", pid);
    }
  }

  // ---- the nodes ----------------------------------------------------------------------
  for (const g of G.nodes) {
    const n = m.nodes[g.index];
    const id = n.id;
    const labelAt: Pt = [g.cx, g.y1 + 22];
    const lab = `label_${id}`;
    const members: string[] = [];
    if (n.kind === "source" || n.kind === "sink") {
      const c: Pt = [g.cx, g.cy];
      const kids: Drawable[] = [disc(`node_${id}__ring`, c, NODE_R, { color: COLORS.ink, fill: COLORS.paper, strokeWidth: 3, roughness: 0.8, ms: SKETCH_MS.node })];
      if (n.kind === "sink") {
        const done = run.sinks.get(g.index);
        const count = done ? countTo(done, t) : 0;
        kids.push(kit.text(`node_${id}__count`, [c[0], c[1] - 1], String(count), { fontSize: count >= 100 ? 19 : 22 }));
        values[`${id}_done`] = count;
      } else {
        // A source: a small door — an arrow out of the ring.
        kids.push(kit.stroke(`node_${id}__mark`, [[c[0] - 11, c[1]], [c[0] + 11, c[1]]], { arrowhead: "end", color: COLORS.ink, strokeWidth: 2.5, roughness: 0.5, ms: SKETCH_MS.arrow }));
      }
      push(kit.group(`node_${id}`, kids), c);
      members.push(`node_${id}`);
      push(kit.text(lab, labelAt, n.label, { fontSize: LABEL_FONT }), labelAt);
      members.push(lab);
      if (n.kind === "source") {
        const s = rateText(n, m.unit);
        if (s) {
          const at: Pt = [g.cx, g.y0 - 20];
          push(kit.text(`rate_${id}`, at, s, { fontSize: NUM_FONT, color: COLORS.supply }), at);
          members.push(`rate_${id}`);
        }
        let y = g.y0 - 50;
        const b = batchText(n);
        if (b) {
          const at: Pt = [g.cx, y];
          push(kit.text(`batch_${id}`, at, b, { fontSize: READ_FONT, color: COLORS.guide }), at);
          members.push(`batch_${id}`);
          y -= 30;
        }
        const v = varText(n);
        if (v) {
          const at: Pt = [g.cx, y];
          push(kit.text(`var_${id}`, at, v, { fontSize: READ_FONT, color: COLORS.supply }), at);
          members.push(`var_${id}`);
        }
      }
    } else if (n.kind === "delay") {
      const kids: Drawable[] = [square(`node_${id}__box`, g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0, { color: COLORS.ink, fill: COLORS.paper, strokeWidth: 3, roughness: 0.8, ms: SKETCH_MS.node })];
      const here = tokens.filter((tk) => tk.where === "delay" && tk.node === g.index) as Extract<TokenAt, { where: "delay" }>[];
      const cols = Math.max(1, Math.floor((g.x1 - g.x0 - 8) / TOKEN_GAP));
      const cap = cols * 2;
      here.slice(0, here.length > cap ? cap - 1 : cap).forEach((tk, k) => {
        const col = k % cols,
          row = Math.floor(k / cols);
        kids.push(tokenAt(`node_${id}__tok${k}`, [g.x0 + 4 + TOKEN_GAP / 2 + col * TOKEN_GAP, g.cy + (row === 0 ? 12 : -12)], tk.priority));
      });
      if (here.length > cap) kids.push(kit.text(`node_${id}__more`, [g.x1 - 4 - TOKEN_GAP / 2, g.cy - 12], `+${here.length - cap + 1}`, { fontSize: 15 }));
      push(kit.group(`node_${id}`, kids), [g.cx, g.cy]);
      members.push(`node_${id}`);
      push(kit.text(lab, labelAt, n.label, { fontSize: LABEL_FONT }), labelAt);
      members.push(lab);
      const s = serviceText(n, m.unit);
      const at: Pt = [g.cx, g.y0 - 20];
      push(kit.text(`service_${id}`, at, s, { fontSize: NUM_FONT, color: COLORS.supply }), at);
      members.push(`service_${id}`);
      const v = varText(n);
      if (v) {
        const vAt: Pt = [g.cx, g.y0 - 50];
        push(kit.text(`var_${id}`, vAt, v, { fontSize: READ_FONT, color: COLORS.supply }), vAt);
        members.push(`var_${id}`);
      }
    } else if (n.kind === "station") {
      // The lane: open where they come in, tokens lined up to the servers.
      const lx0 = g.laneX0!,
        lx1 = g.laneX1!;
      const yT = g.cy + LANE_H / 2,
        yB = g.cy - LANE_H / 2;
      const laneKids: Drawable[] = [
        kit.stroke(`queue_${id}__top`, [[lx0, yT], [lx1, yT]], { color: COLORS.ink, strokeWidth: 2.5, roughness: 0.7, ms: SKETCH_MS.guides }),
        kit.stroke(`queue_${id}__bottom`, [[lx0, yB], [lx1, yB]], { color: COLORS.ink, strokeWidth: 2.5, roughness: 0.7, ms: SKETCH_MS.guides }),
      ];
      const waiting = (tokens.filter((tk) => tk.where === "wait" && tk.node === g.index) as Extract<TokenAt, { where: "wait" }>[]).sort((a, b) => a.rank - b.rank);
      const slots = g.slots!;
      const shown = waiting.length > slots ? slots - 1 : waiting.length;
      for (let k = 0; k < shown; k++) laneKids.push(tokenAt(`queue_${id}__tok${k}`, [lx1 - TOKEN_GAP / 2 - 2 - k * TOKEN_GAP, g.cy], waiting[k].priority));
      if (waiting.length > slots) {
        const more = `+${waiting.length - shown}`;
        laneKids.push(kit.text(`queue_${id}__more`, [lx1 - TOKEN_GAP / 2 - 2 - (slots - 1) * TOKEN_GAP + 2, g.cy], more, { fontSize: more.length > 3 ? 14 : 17, color: COLORS.demand }));
      }
      push(kit.group(`queue_${id}`, laneKids), [(lx0 + lx1) / 2, g.cy]);
      members.push(`queue_${id}`);
      // The servers: a box each, busy (shaded, a token in it) or idle.
      const serving = tokens.filter((tk) => tk.where === "service" && tk.node === g.index) as Extract<TokenAt, { where: "service" }>[];
      const svKids: Drawable[] = [];
      g.serverAt!.forEach((c, k) => {
        const busy = serving.find((s) => s.server === k);
        svKids.push(square(`server_${id}__box${k}`, c[0] - BOX / 2, c[1] - BOX / 2, BOX, BOX, { color: COLORS.ink, fill: busy ? "#f6e3b4" : COLORS.paper, strokeWidth: 3, roughness: 0.8, ms: SKETCH_MS.node }));
        if (busy) svKids.push(tokenAt(`server_${id}__tok${k}`, c, busy.priority));
      });
      const scx = (g.serverAt![0][0] + g.x1) / 2 - BOX / 4;
      push(kit.group(`server_${id}`, svKids), [scx, g.cy]);
      members.push(`server_${id}`);
      push(kit.text(lab, labelAt, n.label, { fontSize: LABEL_FONT }), labelAt);
      members.push(lab);
      // Its numbers: the service time under the lane; the server buttons under the servers.
      let y = g.y0 - 21;
      const s = serviceText(n, m.unit);
      const bx = (g.serverAt![0][0] - BOX / 2 + g.x1) / 2;
      // Centred under the lane, unless that runs into the buttons: then it ends short of them.
      const sw = kit.textWidth(s, NUM_FONT);
      const padsLeft = controls ? bx - 15 - 11 - 8 : Infinity;
      const centred = (lx0 + lx1) / 2 + sw / 2 <= padsLeft;
      const sAt: Pt = centred ? [(lx0 + lx1) / 2, y] : [padsLeft, y];
      push(kit.text(`service_${id}`, sAt, s, { fontSize: NUM_FONT, color: COLORS.supply, anchor: centred ? "middle" : "end" }), centred ? sAt : [padsLeft - sw / 2, y]);
      members.push(`service_${id}`);
      if (controls) {
        const minus: Pt = [bx - 15, y];
        const plus: Pt = [bx + 15, y];
        push(pad(`remove_${id}`, minus, "−", n.servers > 1), minus);
        push(pad(`add_${id}`, plus, "+", n.servers < 12), plus);
        members.push(`remove_${id}`, `add_${id}`);
      }
      y -= 30;
      const v = varText(n);
      if (v) {
        const vAt: Pt = [(lx0 + lx1) / 2, y - 2];
        push(kit.text(`var_${id}`, vAt, v, { fontSize: READ_FONT, color: COLORS.supply }), vAt);
        members.push(`var_${id}`);
        y -= 30;
      }
      const st = stationStats(run, g.index, t)!;
      if (P.readouts !== false) {
        const [l1, l2] = readoutLines(st, m.unit);
        const kids = [
          kit.text(`readout_${id}__q`, [g.cx, y], l1, { fontSize: READ_FONT, color: COLORS.guide }),
          kit.text(`readout_${id}__w`, [g.cx, y - 28], l2, { fontSize: READ_FONT, color: COLORS.guide }),
        ];
        push({ ...kit.group(`readout_${id}`, kids), z: kids[0].z }, [g.cx, y - 14]);
        members.push(`readout_${id}`);
        y -= 56;
      }
      if (Number.isFinite(n.capacity)) {
        const bAt: Pt = [g.cx, y];
        push(kit.text(`balked_${id}`, bAt, `${st.balked} turned away`, { fontSize: READ_FONT, color: COLORS.demand }), bAt);
        members.push(`balked_${id}`);
      }
      // Values.
      const th = stationTheory(m, g.index, rates);
      const put = (k: string, v: number): void => {
        if (Number.isFinite(v)) values[`${id}_${k}`] = r3(v);
      };
      put("queue", st.queue);
      put("busy", st.busy);
      put("servers", n.servers);
      put("util", st.util * 100);
      put("wait", st.wait);
      put("avg_queue", st.avgQueue);
      put("throughput", st.throughput);
      put("arrivals", st.arrivals);
      put("served", st.served);
      put("balked", st.balked);
      put("service", n.service?.mean ?? NaN);
      if (th) {
        put("lambda", th.lambda);
        put("rho", th.rho);
        if (th.exact) {
          put("wq_theory", th.wq);
          put("lq_theory", th.lq);
        }
      }
    }
    // The node's name follows it; the station's parts are one set.
    if (n.kind === "station") groups[`node_${id}`] = members;
    else {
      attached[`node_${id}`] = members.filter((x) => x !== `node_${id}`);
      drawnWith[`node_${id}`] = members.filter((x) => x !== `node_${id}`);
    }
    for (const x of members) addTo("nodes", x);
  }

  // ---- the clock and "new run" ---------------------------------------------------------
  push(kit.text("clock", G.clock, clockText(t, m), { fontSize: 26, anchor: "end" }), G.clock);
  if (controls) {
    const c: Pt = G.reroll;
    const arc = kit.arc(c, 9, 0.5, 5.4, 14);
    // A button: a pill round the circling arrow and its words, so a tap anywhere on it lands.
    const x0 = c[0] - 19;
    const x1 = c[0] + 16 + kit.textWidth("new run", 19) + 10;
    const kids: Drawable[] = [
      square("reroll__pill", x0, c[1] - 16, x1 - x0, 32, { color: COLORS.guide, fill: COLORS.paper, strokeWidth: 1.5, roughness: 0.4, ms: SKETCH_MS.guides }),
      kit.stroke("reroll__arc", arc, { arrowhead: "end", color: COLORS.guide, strokeWidth: 2, roughness: 0.4, ms: SKETCH_MS.arrow }),
      kit.text("reroll__t", [c[0] + 16, c[1]], "new run", { fontSize: 19, color: COLORS.guide, anchor: "start" }),
    ];
    (kids[1] as { headSize?: number }).headSize = 6;
    push(kit.group("reroll", kids), [(x0 + x1) / 2, c[1]]);
  }

  // ---- values ------------------------------------------------------------------------------
  const sys = systemStats(run, t);
  values.t = r3(t);
  values.horizon = m.horizon;
  values.arrivals = sys.arrivals;
  values.departures = sys.departures;
  values.in_system = sys.inSystem;
  if (Number.isFinite(sys.L)) values.L = r3(sys.L);
  if (Number.isFinite(sys.W)) values.W = r3(sys.W);
  values.lambda = r3(sys.lambda);
  const first = m.nodes.find((n) => n.kind === "station");
  if (first) for (const k of ["queue", "busy", "servers", "util", "wait", "avg_queue", "throughput", "served", "balked", "lambda", "rho", "wq_theory", "lq_theory"]) if (`${first.id}_${k}` in values) values[k] = values[`${first.id}_${k}`];

  // ---- charts ----------------------------------------------------------------------------------
  let frame: SceneLayout["frame"];
  let utilFrame: SceneLayout["frame"];
  let drawnStrip = false;
  for (const c of G.charts) {
    const sfx = c.suffix;
    const set = `chart${sfx}`;
    const own = (id: string): string => (sfx ? `${id}${sfx}` : id);
    const plot = c.plot;
    if (c.of === "wait_util") {
      const st = stationStats(run, c.station!, t)!;
      const n = m.nodes[c.station!];
      const th = stationTheory(m, c.station!, rates);
      const s = n.service?.mean ?? 1;
      // The arrivals' and the service's true cv²: burstier arrivals lift the whole curve.
      const ca2 = th?.ca2 ?? 1;
      const cs2 = th?.cs2 ?? n.service?.cv2 ?? 1;
      const curveAt = (rho: number): number => waitApprox(n.servers, rho, s, ca2, cs2);
      const simW = Number.isFinite(st.wait) ? st.wait : 0;
      const yTop = c.y_max ?? niceCeil(Math.max(curveAt(0.9), simW * 1.1, th && Number.isFinite(th.wq) ? th.wq * 1.1 : 0, 1e-9));
      const X: [number, number] = [0, 100];
      const Y: [number, number] = [0, yTop];
      const xt = roundTicks(0, 100, 5);
      const yt = roundTicks(0, yTop, 4);
      const ax = drawAxes({ plot, x: X, y: Y, xTicks: xt.ticks, xDecimals: 0, yTicks: yt.ticks, yDecimals: yt.decimals, xCaption: "busy %", yCaption: `mean wait (${m.unit})` });
      pushAxes(ax, own, set, push, attached, drawnWith, addTo);
      const sx = (v: number): number => plot.x0 + ((v - X[0]) / (X[1] - X[0])) * (plot.x1 - plot.x0);
      const sy = (v: number): number => plot.y0 + ((Math.min(v, yTop * 1.02) - Y[0]) / (Y[1] - Y[0])) * (plot.y1 - plot.y0);
      const curve: Pt[] = [];
      for (let k = 0; k <= 200; k++) {
        const rho = (k / 200) * 0.995;
        const w = curveAt(rho);
        if (!Number.isFinite(w)) break;
        curve.push([sx(rho * 100), sy(w)]);
        if (w > yTop) break;
      }
      push(kit.stroke(own("theory_curve"), curve, { color: COLORS.accent, strokeWidth: 3, roughness: 0.6, ms: SKETCH_MS.curve }), curve[Math.floor(curve.length * 0.7)] ?? [plot.x0, plot.y0]);
      addTo(set, own("theory_curve"));
      if (th && Number.isFinite(th.rho)) {
        const tw = curveAt(th.rho);
        if (Number.isFinite(tw) && tw <= yTop) {
          const at: Pt = [sx(th.rho * 100), sy(tw)];
          push(disc(own("theory_dot"), at, 8, { color: COLORS.accent, fill: COLORS.paper, strokeWidth: 3, ms: SKETCH_MS.dot }), at);
          addTo(set, own("theory_dot"));
        }
      }
      const simAt: Pt = [sx(Math.min(100, st.util * 100)), sy(simW)];
      push(disc(own("sim_dot"), simAt, 9, { color: COLORS.supply, fill: COLORS.supply, strokeWidth: 2, ms: SKETCH_MS.dot }), simAt);
      addTo(set, own("sim_dot"));
      // A two-line key in the plot's empty top-left corner (the curve is low there).
      const kx = plot.x0 + 18;
      const ky = plot.y1 - 8;
      const key: Drawable[] = [
        kit.stroke(`${own("legend")}__curve`, [[kx, ky], [kx + 26, ky]], { color: COLORS.accent, strokeWidth: 3, roughness: 0.4, ms: SKETCH_MS.guides }),
        kit.text(`${own("legend")}__theory`, [kx + 34, ky], th?.scheduled ? "theory, if steady" : th && !th.exact ? "theory (approx.)" : "theory", { fontSize: READ_FONT, color: COLORS.accent, anchor: "start" }),
        disc(`${own("legend")}__dot`, [kx + 13, ky - 30], 7, { color: COLORS.supply, fill: COLORS.supply, strokeWidth: 2, ms: SKETCH_MS.dot }),
        kit.text(`${own("legend")}__run`, [kx + 34, ky - 30], "this run", { fontSize: READ_FONT, color: COLORS.supply, anchor: "start" }),
      ];
      push(kit.group(own("legend"), key), [kx + 50, ky - 15]);
      addTo(set, own("legend"));
      utilFrame ??= { x: X, y: Y, box: { ...plot } };
      continue;
    }
    // A quantity over time, drawn up to t, with the cursor at t.
    const series = c.of === "system" ? run.system : c.of === "queue" ? run.stations.get(c.station!)!.queue : null;
    const log = c.station !== null ? run.stations.get(c.station) : undefined;
    let yMax = 1;
    if (series) for (let k = 0; k < series.values.length; k++) yMax = Math.max(yMax, series.values[k]);
    if (c.of === "wait" && log) for (let k = 0; k < log.waits.length; k++) yMax = Math.max(yMax, log.waits[k]);
    const yTop = c.y_max ?? niceCeil(Math.max(c.of === "wait" ? 1e-9 : 4, yMax));
    const X: [number, number] = [0, m.horizon];
    const Y: [number, number] = [0, yTop];
    const xt = roundTicks(0, m.horizon, 6);
    const yt = roundTicks(0, yTop, 4);
    const yCaption = c.of === "queue" ? `waiting at ${m.nodes[c.station!].label}` : c.of === "system" ? "in the system" : `wait (${m.unit})`;
    const ax = drawAxes({ plot, x: X, y: Y, xTicks: xt.ticks, xDecimals: xt.decimals, yTicks: yt.ticks.filter((v) => c.of === "wait" || Number.isInteger(v)), yDecimals: yt.decimals, xCaption: `time (${m.unit})`, yCaption });
    pushAxes(ax, own, set, push, attached, drawnWith, addTo);
    const sx = (v: number): number => plot.x0 + ((v - X[0]) / (X[1] - X[0])) * (plot.x1 - plot.x0);
    const sy = (v: number): number => plot.y0 + ((Math.min(v, yTop) - Y[0]) / (Y[1] - Y[0])) * (plot.y1 - plot.y0);
    if (m.warmup > 0) {
      const wx = sx(m.warmup);
      push(kit.area(own("warmup"), kit.rect(plot.x0, plot.y0, wx - plot.x0, plot.y1 - plot.y0), COLORS.guide, { opacity: 0.14, precise: true }), [(plot.x0 + wx) / 2, plot.y1 - 12]);
      addTo(set, own("warmup"));
    }
    // The first time chart carries the (first) schedule's strip.
    const scheduled = drawnStrip ? undefined : m.nodes.find((x) => x.schedule);
    if (scheduled) {
      drawnStrip = true;
      pushStrip(scheduled, plot, sx, t, m, push);
      addTo(set, `schedule_${scheduled.id}`);
    }
    if (series) {
      const pts = stepPoints(series, t).map(([x, y]): Pt => [sx(x), sy(y)]);
      push(kit.stroke(own("chart_line"), pts.length > 1 ? pts : [[plot.x0, plot.y0], [plot.x0 + 0.1, plot.y0]], { color: COLORS.supply, strokeWidth: 2.5, roughness: 0.4, ms: SKETCH_MS.curve }), pts[pts.length - 1] ?? [plot.x0, plot.y0]);
      addTo(set, own("chart_line"));
    } else if (log) {
      const k = countTo(log.starts, t);
      const stride = Math.max(1, Math.ceil(k / 300));
      const dots: Drawable[] = [];
      for (let i = 0; i < k; i += stride) dots.push(disc(`${own("chart_dots")}__${dots.length}`, [sx(log.starts[i]), sy(log.waits[i])], 3.2, { color: COLORS.supply, fill: COLORS.supply, strokeWidth: 1, roughness: 0.2, ms: 30 }));
      if (dots.length === 0) dots.push(kit.stroke(`${own("chart_dots")}__0`, [[plot.x0, plot.y0], [plot.x0 + 0.1, plot.y0]], { color: COLORS.paper, strokeWidth: 0.1, instant: true }));
      push(kit.group(own("chart_dots"), dots), [(plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2]);
      addTo(set, own("chart_dots"));
      // The running mean, the thing the dots settle to.
      const mean: Pt[] = [];
      for (let i = 0; i < k; i += stride) mean.push([sx(log.starts[i]), sy(log.waitSum[i] / (i + 1))]);
      if (k > 0) mean.push([sx(log.starts[k - 1]), sy(log.waitSum[k - 1] / k)]);
      push(kit.stroke(own("chart_line"), mean.length > 1 ? mean : [[plot.x0, plot.y0], [plot.x0 + 0.1, plot.y0]], { color: COLORS.demand, strokeWidth: 3, roughness: 0.4, ms: SKETCH_MS.curve }), mean[mean.length - 1] ?? [plot.x0, plot.y0]);
      addTo(set, own("chart_line"));
    }
    const X0 = sx(t);
    const knob: Pt = [X0, plot.y1 + 8];
    const cur: Drawable[] = [
      kit.stroke(own("cursor") + "__line", [[X0, plot.y0], [X0, plot.y1]], { color: COLORS.accent, strokeWidth: 2, dash: true, roughness: 0.3, ms: SKETCH_MS.guides }),
      disc(own("cursor") + "__knob", knob, 7, { color: COLORS.accent, fill: COLORS.accent, strokeWidth: 2, ms: SKETCH_MS.dot }),
    ];
    push(kit.group(own("cursor"), cur), [X0, (plot.y0 + plot.y1) / 2]);
    addTo(set, own("cursor"));
    frame ??= { x: X, y: Y, box: { ...plot } };
  }
  frame ??= utilFrame;
  if (typeof P.title === "string" && P.title.trim()) {
    const at: Pt = [40, plotArea().y1 + 40];
    push(kit.text("title", at, P.title.trim(), { fontSize: 30, anchor: "start" }), at);
  }
  return { drawables, labels: [], anchors, order, attached, drawnWith, groups, values, ...(frame ? { frame } : {}) };
}

/** How many of an ascending array are ≤ t. */
function countTo(a: ArrayLike<number>, t: number): number {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A source's schedule, drawn along the bottom of a time chart: its rate as a
 * pale stepped (or joined) band sharing the chart's time axis — so a peak of
 * arrivals stands under the queue it builds — with a dot on it at t.
 */
function pushStrip(n: ModelNode, plot: PlotArea, sx: (v: number) => number, t: number, m: Model, push: (d: Drawable, at: Pt) => void): void {
  const s = n.schedule!;
  const H = m.horizon;
  const top = Math.max(...s.rates) || 1;
  const band = 0.26 * (plot.y1 - plot.y0);
  const sy = (r: number): number => plot.y0 + (r / top) * band;
  const line: Pt[] = [];
  const knots = s.times.filter((x) => x < H);
  knots.forEach((k, i) => {
    const next = i + 1 < knots.length ? knots[i + 1] : H;
    line.push([sx(k), sy(s.rate(k))]);
    line.push([sx(next), sy(s.smooth ? s.rate(next) : s.rate(k))]);
  });
  const id = `schedule_${n.id}`;
  const dotAt: Pt = [sx(t), sy(s.rate(Math.min(t, H - 1e-9)))];
  // Its key in the plot's top-left corner, where a queue that starts empty seldom reaches.
  const kx = plot.x0 + 18;
  const ky = plot.y1 - 10;
  const kids: Drawable[] = [
    kit.area(`${id}__band`, [[line[0][0], plot.y0], ...line, [line[line.length - 1][0], plot.y0]], COLORS.accent, { opacity: 0.13, precise: true }),
    kit.stroke(`${id}__line`, line, { color: COLORS.accent, strokeWidth: 2, roughness: 0.4, ms: SKETCH_MS.curve }),
    kit.area(`${id}__swatch`, kit.rect(kx, ky - 7, 26, 14), COLORS.accent, { opacity: 0.25, precise: true }),
    kit.text(`${id}__label`, [kx + 34, ky], "arrival rate", { fontSize: READ_FONT, color: COLORS.accent, anchor: "start" }),
    disc(`${id}__now`, dotAt, 6, { color: COLORS.accent, fill: COLORS.accent, strokeWidth: 2, ms: SKETCH_MS.dot }),
  ];
  push(kit.group(id, kids), [(plot.x0 + plot.x1) / 2, plot.y0 + band / 2]);
}

/** A small round button: "−" or "+" (faint when it cannot go further). */
function pad(id: string, at: Pt, sign: string, live: boolean): Drawable {
  const color = live ? COLORS.ink : COLORS.guide;
  return kit.group(id, [
    disc(`${id}__ring`, at, 11, { color, fill: COLORS.paper, strokeWidth: 2, roughness: 0.4, ms: SKETCH_MS.dot }),
    { ...kit.text(`${id}__sign`, [at[0], at[1] + 1], sign, { fontSize: 20, color }), halo: false },
  ]);
}

/** Axes drawn by plot-axes, their ids suffixed for a second chart, into the chart's set. */
function pushAxes(
  ax: ReturnType<typeof drawAxes>,
  own: (id: string) => string,
  set: string,
  push: (d: Drawable, at: Pt) => void,
  attached: Record<string, string[]>,
  drawnWith: Record<string, string[]>,
  addTo: (group: string, id: string) => void,
): void {
  const rename = (d: Drawable): Drawable => {
    const base = d.id.split("__")[0];
    const rest = d.id.slice(base.length);
    const out = { ...d, id: own(base) + rest } as Drawable;
    if (out.kind === "group") (out as { children: Drawable[] }).children = (d as { children: Drawable[] }).children.map(rename);
    return out;
  };
  for (const d of ax.drawables) {
    const r = rename(d);
    push(r, ax.anchors[d.id]);
    addTo(set, r.id);
  }
  for (const [k, v] of Object.entries(ax.attached)) attached[own(k)] = v.map(own);
  for (const [k, v] of Object.entries(ax.drawnWith)) drawnWith[own(k)] = v.map(own);
}

/** A filled circle (a token, a ring, a dot): the fill needs its shape hint to paint. */
function disc(id: string, c: Pt, r: number, o: StrokeOpts): Drawable {
  return { ...kit.stroke(id, kit.circle(c, r, Math.max(12, Math.round(r * 1.6))), { ...o, closed: true }), shapeHint: { type: "circle", c, r } };
}

/** A filled axis-aligned box, lower-left (x, y). */
function square(id: string, x: number, y: number, w: number, h: number, o: StrokeOpts): Drawable {
  return { ...kit.stroke(id, kit.rect(x, y, w, h), { ...o, closed: true }), shapeHint: { type: "rect", x, y, w, h } };
}
