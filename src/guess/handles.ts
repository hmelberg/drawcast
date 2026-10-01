// Guess handles (spec 2026-10-01-guess-and-reveal §3): what on a figure the
// viewer can set by hand before the truth is shown. A handle is one number —
// or, for a sketched line or a whole pie, one row of numbers — with where it
// lives (template param paths, a var, or an element field), its bounds, and
// the pointer gesture that sets it. Pure: built from the spec, the params as
// they stand at the ask and the layout on screen; the gate (ui/guess-gate.ts)
// and the player (render/player.ts) do the DOM and the timing.
//
// The guess is painted as an OVERRIDE of those params or elements through
// the player's preview, and the reveal tweens the override from the guess to
// the truth — the same path the animate verb sweeps — so no template needs
// guess-specific drawing.

import type { LayoutResult } from "../layout/layout";
import { domainMapping, elementBBoxes, inverseDomainMapping } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { MeasureFn } from "../layout/measure";
import { readParam } from "../render/params";
import type { Spec, SpecElement } from "../spec/types";
import { guessParts } from "./parts";
import { authoredScales, scaleGeometry, scaleValueElements, type ScaleElementLike } from "../spec/scale";
import { along, curveOfGaps, gapsOf, marketCurve, marketKind, marketPoint, skOf, type MarketCurve, type MarketKind } from "./market";
import { END_ZONE, nearestAlong } from "../scenes/supply_demand/widget";

export { guessParts };

export type GuessKind = "height" | "curve" | "angle" | "count" | "point" | "market";

export interface GuessHandle {
  /** The drawable id the gesture grabs, the ghost outlines, and the plan reveals. */
  part: string;
  /** Every drawable id that must be on screen while the guess stands. */
  shows: string[];
  kind: GuessKind;
  /** The true numbers: one (height, count, point, one pie slice), the
   *  sketched points of a line, or every slice of a whole pie (percent). */
  truth: number[];
  /** Bounds of each number, in its own units. */
  min: number;
  max: number;
  /** Rounding step the gesture snaps to. */
  step: number;
  /** Human name of the part ("Norway", "sick", "Mozart") — keyboard focus, aria. */
  label: string;
  /** A whole pie: each slice's name, for the entry being set. */
  entryLabels?: string[];
  /** Format a number like the figure would write it. */
  format: (v: number) => string;
  /** Unit after a formatted number ("%", "" …). */
  unit: string;
  // —— where the numbers live (exactly one family is set) ——
  /** Template param / `vars.<name>` paths, one per truth entry (height, curve). */
  paths?: string[];
  /** A population state's count (no var bound): element id + state name. */
  population?: { id: string; state: string };
  /** A scale's marker: the authored scale element. */
  scale?: ScaleElementLike;
  /** A pie: the slice values' paths (all of them), the asked slice (0-based)
   *  or null for the whole pie, and the true total. */
  pie?: { paths: string[]; slice: number | null; total: number; shares: number[] };
  // —— geometry for the gesture ——
  /** Pointer → domain (template frame), and back. */
  toDomain?: (p: Pt) => Pt;
  toLogical?: (p: Pt) => Pt;
  /** height: the bar's centre x and half width (logical), and its domain x. */
  cx?: number;
  halfW?: number;
  dx?: number;
  /** curve: the x of each truth entry (domain), and how many points before
   *  the sketch are given (their values in `given`). */
  xs?: number[];
  given?: { x: number; v: number }[];
  /** curve on an unstaged series: the series' values path ("values",
   *  "series.1.values") — the draw-in paints its prefix through it. */
  rowPath?: string;
  /** count: the crowd's box (logical); angle: the pie's centre and radius. */
  box?: BBox;
  centre?: Pt;
  radius?: number;
  /** market (spec 2026-10-03 §3): the asked curve, the old and the true one;
   *  the two numbers are the gaps v₁, v₂ along its axis. Painted by marks,
   *  never by params (no paths). */
  market?: MarketCurve;
  /** market: what the animate does to the curve, for {t.why}. */
  marketKind?: MarketKind;
  /** market: a price and a quantity level (domain 0–100) in the author's units. */
  marketLevel?: { price: (v: number) => string; quantity: (v: number) => string };
}

/** The animate a predict asks about: its end params (the template's, whole)
 *  and its targets (dot paths). A market handle's truth is read from these. */
export interface GuessEnd {
  params: Record<string, unknown>;
  targets: Record<string, unknown>;
}

export interface GuessSetup {
  handles: GuessHandle[];
  /** Param overrides held for the whole question and reveal (a chart's y range). */
  pin: Record<string, unknown>;
  warnings: string[];
}

/** Templates whose parts can be guessed. */
export const GUESSABLE_TEMPLATES = ["bar_chart", "line_chart", "pie_chart"] as const;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A step for a range: about 1/50 of it, snapped to 1, 2 or 5 × 10^k
 *  (finer gave "100.0" and "37.0" on 0–100 axes: decimals nobody guesses in). */
export function niceStep(range: number): number {
  if (!(range > 0)) return 1;
  const raw = range / 50;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function snap(v: number, step: number): number {
  if (!(step > 0)) return v;
  const s = Math.round(v / step) * step;
  // Kill float dust (0.30000000000000004).
  const dec = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(s.toFixed(Math.min(10, dec)));
}

/** A formatter for numbers snapped to `step`: no more decimals than it has,
 *  thousands grouped with a thin space like the charts' own labels. */
export function formatterFor(step: number, unit = ""): (v: number) => string {
  const dec = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
  return (v: number) => {
    const s = Math.abs(v) >= 10000 ? groupThousands(v.toFixed(dec)) : v.toFixed(dec);
    return unit ? `${s}${unit === "%" ? "" : " "}${unit}` : s;
  };
}

function groupThousands(s: string): string {
  const [int, frac] = s.split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}

/** values: number[] or number[][] (staged). The row shown at `stage`, and its path prefix. */
function currentRow(values: unknown, stage: number, prefix: string): { row: (number | null)[]; at: string } | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (Array.isArray(values[0])) {
    const k = clamp(Math.round(stage), 0, values.length - 1);
    const row = values[k];
    if (!Array.isArray(row)) return null;
    return { row: row.map((v) => (isNum(v) ? v : null)), at: `${prefix}.${k}` };
  }
  return { row: values.map((v) => (isNum(v) ? v : null)), at: prefix };
}

/**
 * The handles for `parts` on this figure. Unknown or unguessable parts give a
 * warning and no handle; the caller decides what an empty list means.
 */
export function guessSetup(
  spec: Spec,
  params: Record<string, unknown>,
  layout: Pick<LayoutResult, "drawables" | "order" | "frame" | "fit">,
  parts: string[],
  opts: { from?: number; measure?: MeasureFn; end?: GuessEnd } = {},
): GuessSetup {
  const handles: GuessHandle[] = [];
  const warnings: string[] = [];
  let pin: Record<string, unknown> = {};
  const frame = layout.frame;
  const toDomain = frame ? inverseDomainMapping(frame, layout.fit) : undefined;
  const toLogical = frame ? domainMapping(frame, layout.fit).toLogical : undefined;
  const boxes = elementBBoxes(layout, opts.measure);
  const pieParts = parts.filter((p) => p === "pie" || /^slice_\d+$/.test(p));
  for (const part of parts) {
    if (spec.template === "bar_chart" && /^bar_\d+$/.test(part)) {
      const h = barHandle(spec, params, part, frame, toDomain);
      if (typeof h === "string") warnings.push(h);
      else {
        h.toLogical = toLogical;
        if (toLogical) {
          // Bar i sits at domain x = i (the frame runs -0.5 … n-0.5); its
          // width is the slot less the gap (bar_chart's own default 0.35).
          const gap = typeof params["gap"] === "number" ? Math.max(0, Math.min(0.8, params["gap"] as number)) : 0.35;
          const a = toLogical([h.dx!, 0]);
          const b = toLogical([h.dx! + 1, 0]);
          h.cx = a[0];
          h.halfW = (Math.abs(b[0] - a[0]) * (1 - gap)) / 2;
        }
        handles.push(h);
        if (frame) pin = { ...pin, ylim: [frame.y[0], frame.y[1]] };
      }
      continue;
    }
    if (spec.template === "line_chart" && /^line_\d+$/.test(part)) {
      const h = lineHandle(spec, params, part, frame, toDomain, opts.from);
      if (typeof h === "string") warnings.push(h);
      else {
        h.toLogical = toLogical;
        handles.push(h);
        if (frame) pin = { ...pin, ylim: [frame.y[0], frame.y[1]] };
      }
      continue;
    }
    if (spec.template === "pie_chart" && (part === "pie" || /^slice_\d+$/.test(part))) {
      if (pieParts.length > 1 && part !== pieParts[0]) continue; // one pie handle covers them
      const whole = part === "pie" || pieParts.length > 1;
      const h = pieHandle(params, whole ? null : Number(part.slice(6)) - 1, layout.fit);
      if (typeof h === "string") warnings.push(h);
      else handles.push(h);
      continue;
    }
    if (spec.template === "supply_demand" && (part === "supply_curve" || part === "demand_curve")) {
      const h = marketHandle(params, part, opts.end, toDomain, toLogical);
      if (typeof h === "string") warnings.push(h);
      else handles.push(h);
      continue;
    }
    const pop = populationHandle(spec, part, boxes);
    if (pop) {
      if (typeof pop === "string") warnings.push(pop);
      else handles.push(pop);
      continue;
    }
    const sc = scaleHandle(spec, part);
    if (sc) {
      handles.push(sc);
      continue;
    }
    warnings.push(`guess: "${part}" is not a guessable part of this figure (a bar, a line, a pie slice, a population state or a scale)`);
  }
  return { handles, pin, warnings };
}

function barHandle(
  _spec: Spec,
  params: Record<string, unknown>,
  part: string,
  frame: LayoutResult["frame"],
  toDomain: ((p: Pt) => Pt) | undefined,
): GuessHandle | string {
  if (Array.isArray(params["series"])) return `guess: "${part}" — grouped or stacked bars cannot be guessed yet; use one series (values)`;
  const i = Number(part.slice(4)) - 1;
  const cur = currentRow(params["values"], isNum(params["stage"]) ? params["stage"] : 0, "values");
  if (!cur) return `guess: "${part}" — the chart has no numbers yet`;
  const v = cur.row[i];
  if (v === null || v === undefined) return `guess: "${part}" — no such bar`;
  if (!frame || !toDomain) return `guess: "${part}" — the chart has no axes to guess against`;
  const [min, max] = frame.y;
  const step = niceStep(max - min);
  const labels = Array.isArray(params["labels"]) ? (params["labels"] as unknown[]) : [];
  return {
    part,
    shows: [part],
    kind: "height",
    truth: [v],
    min,
    max,
    step,
    label: String(labels[i] ?? part),
    format: formatterFor(step),
    unit: "",
    paths: [`${cur.at}.${i}`],
    toDomain,
    dx: i,
  };
}

function lineHandle(
  _spec: Spec,
  params: Record<string, unknown>,
  part: string,
  frame: LayoutResult["frame"],
  toDomain: ((p: Pt) => Pt) | undefined,
  from: number | undefined,
): GuessHandle | string {
  if (params["slope"] === true) return `guess: "${part}" — a slope chart cannot be guessed; use an ordinary line chart`;
  const k = Number(part.slice(5)) - 1;
  const series = Array.isArray(params["series"]) ? (params["series"] as Record<string, unknown>[]) : null;
  const stage = isNum(params["stage"]) ? params["stage"] : 0;
  const src = series ? series[k] : k === 0 ? { values: params["values"], name: "" } : undefined;
  if (!src) return `guess: "${part}" — no such line`;
  const cur = currentRow(src["values"], stage, series ? `series.${k}.values` : "values");
  if (!cur) return `guess: "${part}" — the line has no numbers yet`;
  if (!frame || !toDomain) return `guess: "${part}" — the chart has no axes to guess against`;
  const n = cur.row.length;
  const xsAll: number[] = Array.isArray(params["x"]) && (params["x"] as unknown[]).every(isNum) ? (params["x"] as number[]).slice(0, n) : Array.from({ length: n }, (_, j) => (Array.isArray(params["x"]) ? j : j + 1));
  let fromIndex = from !== undefined ? xsAll.findIndex((x) => x >= from) : Math.ceil(n / 2);
  if (fromIndex < 1) fromIndex = Math.max(1, Math.ceil(n / 2));
  const idx: number[] = [];
  for (let j = fromIndex; j < n; j++) if (cur.row[j] !== null) idx.push(j);
  if (idx.length === 0) return `guess: "${part}" — nothing left to draw after from`;
  const given: { x: number; v: number }[] = [];
  for (let j = 0; j < fromIndex; j++) if (cur.row[j] !== null) given.push({ x: xsAll[j], v: cur.row[j]! });
  if (given.length === 0) return `guess: "${part}" — the line needs at least one given point before from`;
  const [min, max] = frame.y;
  const step = niceStep(max - min);
  return {
    part,
    shows: [part],
    kind: "curve",
    truth: idx.map((j) => cur.row[j]!),
    min,
    max,
    step,
    label: String(src["name"] ?? "") || part,
    format: formatterFor(step),
    unit: "",
    paths: idx.map((j) => `${cur.at}.${j}`),
    toDomain,
    xs: idx.map((j) => xsAll[j]),
    given,
    // A staged series' prefix is the author's to draw; an unstaged one the guess draws in.
    ...(Array.isArray(src["values"]) && !Array.isArray((src["values"] as unknown[])[0]) ? { rowPath: cur.at } : {}),
  };
}

/** Where pie_chart (scenes/packs/data.yaml) draws its circle — the same
 *  arithmetic as the template, then the page's fit. Keep the two in step. */
export function pieGeometry(params: Record<string, unknown>, fit?: LayoutResult["fit"]): { centre: Pt; radius: number } {
  const b = params["box"] as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
  const boxed = b && [b.x, b.y, b.w, b.h].every(isNum) && (b.w as number) > 0 && (b.h as number) > 0;
  const area = boxed
    ? { x0: b!.x as number, y0: b!.y as number, x1: (b!.x as number) + (b!.w as number), y1: (b!.y as number) + (b!.h as number) }
    : { x0: 150, y0: 60, x1: 850, y1: 640 };
  if (typeof params["title"] === "string" && params["title"].trim() !== "") area.y1 = Math.min(area.y1, 650);
  const r = Math.max(40, Math.min((area.x1 - area.x0) / 2 - 150, (area.y1 - area.y0) / 2 - 40));
  const s = fit?.s ?? 1, dx = fit?.dx ?? 0, dy = fit?.dy ?? 0;
  return { centre: [((area.x0 + area.x1) / 2) * s + dx, ((area.y0 + area.y1) / 2) * s + dy], radius: r * s };
}

function pieHandle(params: Record<string, unknown>, slice: number | null, fit: LayoutResult["fit"]): GuessHandle | string {
  const cur = currentRow(params["values"], isNum(params["stage"]) ? params["stage"] : 0, "values");
  if (!cur || cur.row.some((v) => v === null || v < 0)) return "guess: the pie has no numbers yet";
  const row = cur.row as number[];
  const total = row.reduce((a, b) => a + b, 0);
  if (!(total > 0) || row.length < 2) return "guess: a pie needs two slices or more";
  if (slice !== null && (slice < 0 || slice >= row.length)) return `guess: "slice_${slice + 1}" — no such slice`;
  const ids = row.map((_, i) => `slice_${i + 1}`);
  const { centre, radius: r } = pieGeometry(params, fit);
  const pct = row.map((v) => (v / total) * 100);
  const labels = Array.isArray(params["labels"]) ? (params["labels"] as unknown[]) : [];
  return {
    part: slice === null ? "slice_1" : ids[slice],
    shows: ids,
    kind: "angle",
    truth: slice === null ? pct : [pct[slice]],
    min: 0,
    max: 100,
    step: 1,
    label: slice === null ? "pie" : String(labels[slice] ?? ids[slice]),
    ...(slice === null ? { entryLabels: row.map((_, i) => String(labels[i] ?? ids[i])) } : {}),
    format: formatterFor(1, "%"),
    unit: "%",
    pie: { paths: row.map((_, i) => `${cur.at}.${i}`), slice, total, shares: row.map((v) => v / total) },
    centre,
    radius: r,
  };
}

/** A unit range from the market's `units` (the 0–100 axis maps onto it). */
function unitRange(r: unknown): [number, number] {
  return Array.isArray(r) && r.length === 2 && r.every(isNum) && r[1] !== r[0] ? [r[0], r[1]] : [0, 100];
}

/** Domain numbers (0–100) written in the author's units: a gap (`delta`) or a level. */
function unitFormat(range: unknown, unit: unknown, delta: boolean): (v: number) => string {
  const [a, b] = unitRange(range);
  const f = formatterFor(niceStep(Math.abs(b - a)));
  const u = typeof unit === "string" ? unit.trim() : "";
  return (v) => {
    const n = delta ? (v * (b - a)) / 100 : a + ((b - a) * v) / 100;
    const s = f(n);
    if (!u) return s;
    // Currency signs go in front ($12), like the template's readout; every other unit after.
    if (/^[$€£¥]$/.test(u)) return s.startsWith("-") ? `-${u}${s.slice(1)}` : `${u}${s}`;
    return `${s} ${u}`;
  };
}

/** A curve's copy to move or turn (spec 2026-10-03 §3): predict only — the
 *  truth is the curve the template draws at the next animate's end. */
function marketHandle(
  params: Record<string, unknown>,
  part: "supply_curve" | "demand_curve",
  end: GuessEnd | undefined,
  toDomain: ((p: Pt) => Pt) | undefined,
  toLogical: ((p: Pt) => Pt) | undefined,
): GuessHandle | string {
  if (!end) return `guess: "${part}" — a market guess is a prediction: ask it with predict: true right before the animate that moves the curve`;
  const m = marketCurve(params, end.params, part, end.targets);
  if (typeof m === "string") return `guess: "${part}" — ${m}`;
  if (!toDomain || !toLogical) return `guess: "${part}" — the market has no axes to guess against`;
  const units = (params["units"] ?? {}) as Record<string, unknown>;
  const price = m.axis === "price";
  return {
    part,
    shows: [part],
    kind: "market",
    truth: [m.truth[0], m.truth[1]],
    min: -100,
    max: 100,
    step: niceStep(100),
    label: part === "supply_curve" ? "supply" : "demand",
    format: unitFormat(price ? units["price"] : units["quantity"], price ? units["price_unit"] : units["quantity_unit"], true),
    unit: String((price ? units["price_unit"] : units["quantity_unit"]) ?? ""),
    market: m,
    marketKind: marketKind(part, params, end.targets),
    marketLevel: {
      price: unitFormat(units["price"], units["price_unit"], false),
      quantity: unitFormat(units["quantity"], units["quantity_unit"], false),
    },
    toDomain,
    toLogical,
  };
}

const gapsOfValues = (v: number[]): [number, number] => [v[0] ?? 0, v[1] ?? 0];

/** The viewer's curve (gaps `values`) on screen, logical. */
export function marketLine(h: GuessHandle, values: number[]): Pt[] {
  if (!h.market || !h.toLogical) return [];
  return curveOfGaps(h.market, gapsOfValues(values)).map(h.toLogical);
}

/** What a press at `p` takes: 0 the middle (move it), 1 an end (turn it) —
 *  the free-play widget's END_ZONE along the copy's length. */
export function marketGrab(h: GuessHandle, values: number[], p: Pt): 0 | 1 {
  const line = marketLine(h, values);
  if (line.length < 2) return 0;
  const { t } = nearestAlong(line, p);
  return t < END_ZONE || t > 1 - END_ZONE ? 1 : 0;
}

/** Gaps kept within the handle's bounds. */
function boundGaps(h: GuessHandle, v: [number, number]): number[] {
  return [clamp(v[0], h.min, h.max), clamp(v[1], h.min, h.max)];
}

function unionBox(a: BBox, b: BBox): BBox {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function populationHandle(spec: Spec, part: string, boxes: Map<string, BBox>): GuessHandle | string | null {
  for (const el of spec.elements ?? []) {
    if (el.type !== "population" || !part.startsWith(`${el.id}_`)) continue;
    const want = part.slice(el.id.length + 1).toLowerCase();
    const states = el.states ?? {};
    const keys = Object.keys(states);
    const state = keys.find((k) => k.toLowerCase() === want);
    if (!state) return `guess: "${part}" — ${el.id} has no state "${want}"`;
    if (keys[0] === state) return `guess: "${part}" — the first state is the remainder; guess another state`;
    const total = isNum(el.count) ? el.count : Object.values(states).reduce((a, b) => a + (isNum(b) ? b : 0), 0) || 100;
    const bound = el.bind?.[`states.${state}`];
    const varName = bound && /^[a-z_][a-z0-9_]*$/i.test(bound.trim()) ? bound.trim() : null;
    const truth = varName ? (spec.vars?.[varName] && isNum((spec.vars[varName] as { value?: unknown }).value) ? ((spec.vars[varName] as { value: number }).value) : states[state]) : states[state];
    // The people: the element's own box, else the union of its state sets'
    // (the element id is a parent of the sets, not always a drawable itself).
    let box = boxes.get(el.id) ?? null;
    if (!box) for (const k of keys) {
      const b = boxes.get(`${el.id}_${k}`);
      if (b) box = box ? unionBox(box, b) : b;
    }
    const ids = [el.id, ...keys.map((k) => `${el.id}_${k}`)];
    return {
      part,
      shows: ids.filter((id) => boxes.has(id) || id === el.id),
      kind: "count",
      truth: [isNum(truth) ? truth : 0],
      min: 0,
      max: total,
      step: 1,
      label: (el.labels?.[state] ?? state).toString(),
      format: formatterFor(1),
      unit: "",
      ...(varName ? { paths: [`vars.${varName}`] } : { population: { id: el.id, state } }),
      ...(box ? { box } : {}),
    };
  }
  return null;
}

function scaleHandle(spec: Spec, part: string): GuessHandle | null {
  // A scale is sugar (spec/scale.ts): its group keeps the numbers.
  const sc = authoredScales(spec).find((s) => s.id === part);
  if (!sc || typeof sc.value !== "number") return null;
  const g = scaleGeometry(sc);
  const step = g.kind === "log" ? 0 : niceStep(g.max - g.min);
  return {
    part: `${sc.id}_answer`,
    shows: [`${sc.id}_answer`],
    kind: "point",
    truth: [g.value],
    min: g.min,
    max: g.max,
    step,
    label: sc.label ?? sc.id,
    format: g.format,
    unit: g.unit,
    scale: sc,
  };
}

/** Where the guess starts before the viewer touches it (spec §5). */
export function startValues(h: GuessHandle): number[] {
  switch (h.kind) {
    case "height": {
      const floor = clamp(0, h.min, h.max);
      return [snap(floor + (h.max - h.min) * 0.04, h.step)];
    }
    case "curve": {
      const last = h.given && h.given.length > 0 ? h.given[h.given.length - 1].v : (h.min + h.max) / 2;
      return h.truth.map(() => last);
    }
    case "angle":
      return h.truth.length === 1 ? [50] : h.truth.map(() => 100 / h.truth.length);
    case "count":
      return [0];
    case "point":
      return [h.scale ? scaleGeometry(h.scale).middle : (h.min + h.max) / 2];
    case "market":
      // The copy lies on the curve.
      return [0, 0];
  }
}

/**
 * The handle's numbers after the pointer went to `p` (logical, y-up).
 * `current` is what they were — a sketch keeps the points the pointer has not
 * crossed, a pie keeps the dividers it did not grab. `prev` is the previous
 * pointer sample of the same stroke (a sketch fills the indices between).
 */
export function valueAt(h: GuessHandle, p: Pt, current: number[], prev?: Pt | null, grab?: number): number[] {
  switch (h.kind) {
    case "height": {
      if (!h.toDomain) return current;
      return [snap(clamp(h.toDomain(p)[1], h.min, h.max), h.step)];
    }
    case "curve": {
      if (!h.toDomain || !h.xs) return current;
      const out = current.slice();
      const a = h.toDomain(p);
      const b = prev ? h.toDomain(prev) : a;
      const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
      const set = (j: number, y: number): void => {
        out[j] = snap(clamp(y, h.min, h.max), h.step);
      };
      // Every point whose x the stroke crossed since the last sample, at the
      // stroke's height there; and the nearest point to where it is now.
      for (let j = 0; j < h.xs.length; j++) {
        const x = h.xs[j];
        if (x >= lo && x <= hi && hi > lo) set(j, b[1] + ((x - b[0]) / (a[0] - b[0])) * (a[1] - b[1]));
      }
      set(nearestIndex(h.xs, a[0]), a[1]);
      return out;
    }
    case "angle": {
      if (!h.centre) return current;
      const f = clockFraction(h.centre, p) * 100;
      if (h.truth.length === 1 && h.pie) {
        // One slice: it starts where the slices before it end. They keep
        // their proportions among the rest, so their share P scales with
        // (1 − s): pointer f = P0·(1 − s)/(1 − t0) + s ⇒ solve for s.
        const slice = h.pie.slice ?? 0;
        const t0 = h.truth[0] / 100;
        const before = h.pie.shares.slice(0, slice).reduce((a, b) => a + b, 0);
        const c = 1 - t0 > 1e-9 ? before / (1 - t0) : 0;
        const s = c < 1 ? (f / 100 - c) / (1 - c) : 0;
        return [snap(clamp(s * 100, 0, 100), h.step)];
      }
      // Whole pie: move the divider `grab` (the boundary after slice grab).
      const i = grab ?? nearestDivider(current, f);
      const cum: number[] = [];
      let acc = 0;
      for (const v of current) cum.push((acc += v));
      const lo = i > 0 ? cum[i - 1] : 0;
      const hi = cum[i + 1] ?? 100;
      const at = snap(clamp(f, lo, hi), h.step);
      const out = current.slice();
      out[i] = snap(at - lo, h.step);
      out[i + 1] = snap(hi - at, h.step);
      return out;
    }
    case "count": {
      if (!h.box) return current;
      const f = clamp((p[0] - h.box.x) / (h.box.w || 1), 0, 1);
      return [Math.round(f * h.max)];
    }
    case "point": {
      if (!h.scale) return current;
      return [scaleGeometry(h.scale).valueAtX(p[0])];
    }
    case "market": {
      // grab 0: the pointer's move along the axis moves every point by it (s);
      // grab 1: s kept, k solved so the copy passes the pointer (a turn about
      // the pivot: price 0, or the equilibrium quantity).
      const m = h.market;
      if (!m || !h.toDomain) return current;
      const i = m.axis === "price" ? 1 : 0;
      const { s, k } = skOf(m, gapsOfValues(current));
      const d = h.toDomain(p);
      if (grab === 1) {
        const x0 = along(m.axis, m.base, d[1 - i]);
        if (x0 === null || Math.abs(x0 - m.pivot) < 1e-6) return current;
        return boundGaps(h, gapsOf(m, s, clamp((d[i] - m.pivot - s) / (x0 - m.pivot), 0.1, 10)));
      }
      if (!prev) return current;
      return boundGaps(h, gapsOf(m, s + (d[i] - h.toDomain(prev)[i]), k));
    }
  }
}

/** Which divider of a whole pie a press at `f` percent grabs. */
export function nearestDivider(values: number[], f: number): number {
  let acc = 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < values.length - 1; i++) {
    acc += values[i];
    const d = Math.min(Math.abs(acc - f), 100 - Math.abs(acc - f));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  for (let j = 1; j < xs.length; j++) if (Math.abs(xs[j] - x) < Math.abs(xs[best] - x)) best = j;
  return best;
}

/** Clockwise from 12 o'clock, 0..1. */
export function clockFraction(c: Pt, p: Pt): number {
  const a = Math.atan2(p[0] - c[0], p[1] - c[1]); // y-up: 0 at the top, clockwise positive
  return (a < 0 ? a + 2 * Math.PI : a) / (2 * Math.PI);
}

/** One keyboard step for this handle (shift: ten). */
export function nudge(h: GuessHandle, values: number[], index: number, dir: 1 | -1, big = false): number[] {
  if (h.kind === "market" && h.market) {
    // ↑/↓ move it a step; Shift+↑/↓ turn it (k by 5 %).
    const { s, k } = skOf(h.market, gapsOfValues(values));
    return boundGaps(h, big ? gapsOf(h.market, s, Math.max(0.1, k + 0.05 * dir)) : gapsOf(h.market, s + h.step * dir, k));
  }
  const out = values.slice();
  const step = h.kind === "point" && h.scale && scaleGeometry(h.scale).kind === "log" ? 0 : h.step;
  if (h.kind === "point" && step === 0 && h.scale) {
    out[index] = scaleGeometry(h.scale).stepFrom(values[index], dir * (big ? 10 : 1));
    return out;
  }
  const d = (big ? 10 : 1) * (h.kind === "height" || h.kind === "curve" ? h.step * 5 : step) * dir;
  if (h.kind === "angle" && h.truth.length > 1) {
    const j = Math.min(index + 1, out.length - 1);
    if (j === index) return out;
    const moved = clamp(out[index] + d, 0, out[index] + out[j]);
    out[j] = snap(out[index] + out[j] - moved, h.step);
    out[index] = snap(moved, h.step);
    return out;
  }
  out[index] = snap(clamp(out[index] + d, h.min, h.max), step || 1);
  return out;
}

/**
 * The preview patch that paints these handles at `values`: template param
 * overrides (and the pin), and the element list when an element is patched.
 */
export function patchFor(
  spec: Spec,
  setup: Pick<GuessSetup, "handles" | "pin">,
  values: number[][],
): { params: Record<string, unknown>; elements?: SpecElement[] } {
  const params: Record<string, unknown> = { ...setup.pin };
  let elements: SpecElement[] | undefined;
  const els = (): SpecElement[] => (elements ??= (spec.elements ?? []).slice());
  setup.handles.forEach((h, k) => {
    const v = values[k] ?? h.truth;
    if (h.paths) h.paths.forEach((path, j) => (params[path] = v[j]));
    if (h.pie) {
      const total = h.pie.total;
      if (h.pie.slice === null) {
        h.pie.paths.forEach((path, j) => (params[path] = ((v[j] ?? 0) / 100) * total));
      } else {
        // One slice at s; the others keep their proportions in the rest.
        const s = clamp(v[0] / 100, 0, 1);
        const t = h.truth[0] / 100;
        const restScale = 1 - t > 1e-9 ? (1 - s) / (1 - t) : 0;
        const shares = h.pie.shares;
        h.pie.paths.forEach((path, j) => {
          params[path] = (j === h.pie!.slice ? s : shares[j] * restScale) * total;
        });
      }
    }
    if (h.population) {
      const list = els();
      const i = list.findIndex((e) => e.id === h.population!.id);
      if (i >= 0) list[i] = { ...list[i], states: { ...(list[i].states ?? {}), [h.population.state]: Math.round(v[0]) } };
    }
    if (h.scale) {
      const list = els();
      const fresh = scaleValueElements(h.scale, v[0]);
      const ids = new Set(fresh.map((e) => e.id));
      const at = list.findIndex((e) => ids.has(e.id));
      const kept = list.filter((e) => !ids.has(e.id));
      kept.splice(at < 0 ? kept.length : at, 0, ...fresh);
      elements = kept;
    }
  });
  return elements ? { params, elements } : { params };
}

/** The value a param path holds in params (for tests and the movie path). */
export function paramValue(params: Record<string, unknown>, path: string): number | null {
  return readParam(params, path);
}

/** "12,40;7" — handles split by ";", their numbers by ",". */
export function encodeGuess(values: number[][]): string {
  return values.map((row) => row.map((v) => String(v)).join(",")).join(";");
}

export function decodeGuess(s: string, handles: GuessHandle[]): number[][] | null {
  const rows = s.split(";");
  if (rows.length !== handles.length) return null;
  const out: number[][] = [];
  for (let k = 0; k < rows.length; k++) {
    const nums = rows[k].split(",").map((t) => Number(t.trim()));
    if (nums.length !== handles[k].truth.length || nums.some((n) => !Number.isFinite(n))) return null;
    out.push(nums);
  }
  return out;
}

/** An ask's `default` as a guess: one number per handle entry, or one number
 *  for every entry; null when it does not fit. */
export function defaultGuess(def: string | undefined, handles: GuessHandle[]): number[][] | null {
  if (def === undefined || def.trim() === "") return null;
  if (def.includes(";")) return decodeGuess(def, handles);
  const nums = def.split(",").map((t) => Number(t.trim()));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const width = handles.reduce((a, h) => a + h.truth.length, 0);
  if (nums.length === 1) return handles.map((h) => h.truth.map(() => nums[0]));
  if (nums.length !== width) return null;
  let i = 0;
  return handles.map((h) => h.truth.map(() => nums[i++]));
}

/** Where entry `j` of the handle stands at `values` (logical, y-up) — the
 *  movie's laser and the ghost marks; null when the handle has no geometry. */
export function pointFor(h: GuessHandle, values: number[], j = 0): Pt | null {
  switch (h.kind) {
    case "height":
      return h.toLogical && h.cx !== undefined ? [h.cx, h.toLogical([0, values[0]])[1]] : null;
    case "curve":
      return h.toLogical && h.xs ? h.toLogical([h.xs[j] ?? h.xs[h.xs.length - 1], values[j] ?? values[values.length - 1]]) : null;
    case "angle": {
      if (!h.centre || h.radius === undefined) return null;
      const f = angleOf(h, values, j);
      const a = f * 2 * Math.PI;
      return [h.centre[0] + h.radius * Math.sin(a), h.centre[1] + h.radius * Math.cos(a)];
    }
    case "count":
      // Under the people (and their legend): over them it hides the faces it counts.
      return h.box ? [h.box.x + (values[0] / (h.max || 1)) * h.box.w, h.box.y - 125] : null;
    case "point":
      return h.scale ? [scaleGeometry(h.scale).xAt(values[0]), scaleGeometry(h.scale).y + 18] : null;
    case "market": {
      // 0: the middle of the copy (the laser takes it there); 1: its far end.
      if (!h.market || !h.toLogical) return null;
      if (j === 1) {
        const line = marketLine(h, values);
        return line.length > 0 ? line[line.length - 1] : null;
      }
      const at = marketPoint(h.market, gapsOfValues(values), (h.market.at[0] + h.market.at[1]) / 2);
      return at ? h.toLogical(at) : null;
    }
  }
}

/** A pie handle's divider `j` at `values`, as a clockwise fraction from 12 o'clock. */
export function angleOf(h: GuessHandle, values: number[], j = 0): number {
  if (h.truth.length === 1 && h.pie) {
    const slice = h.pie.slice ?? 0;
    const t0 = h.truth[0] / 100;
    const s = values[0] / 100;
    const before = h.pie.shares.slice(0, slice).reduce((a, b) => a + b, 0);
    const scaledBefore = 1 - t0 > 1e-9 ? (before * (1 - s)) / (1 - t0) : 0;
    return scaledBefore + s; // the slice's far edge — the one the viewer drags
  }
  let acc = 0;
  for (let i = 0; i <= j && i < values.length; i++) acc += values[i];
  return acc / 100;
}

/** How far `p` is from where this handle is worked (logical units);
 *  Infinity when the press is not on it at all. Picks the handle a press grabs. */
export function hitDistance(h: GuessHandle, p: Pt, values: number[]): number {
  switch (h.kind) {
    case "height": {
      if (h.cx === undefined || h.halfW === undefined) return Infinity;
      const dx = Math.abs(p[0] - h.cx);
      return dx <= h.halfW * 1.25 + 8 ? dx : Infinity;
    }
    case "curve": {
      if (!h.toLogical || !h.xs || h.xs.length === 0) return Infinity;
      const x0 = h.toLogical([h.given && h.given.length > 0 ? h.given[h.given.length - 1].x : h.xs[0], 0])[0];
      const x1 = h.toLogical([h.xs[h.xs.length - 1], 0])[0];
      return p[0] >= Math.min(x0, x1) - 30 && p[0] <= Math.max(x0, x1) + 40 ? 1 : Infinity;
    }
    case "angle": {
      if (!h.centre || h.radius === undefined) return Infinity;
      const d = Math.hypot(p[0] - h.centre[0], p[1] - h.centre[1]);
      if (d > h.radius * 1.4) return Infinity;
      const at = pointFor(h, values);
      return at ? Math.hypot(p[0] - at[0], p[1] - at[1]) : d;
    }
    case "count": {
      if (!h.box) return Infinity;
      const b = h.box;
      return p[0] >= b.x - 30 && p[0] <= b.x + b.w + 30 && p[1] >= b.y - 30 && p[1] <= b.y + b.h + 30 ? 1 : Infinity;
    }
    case "point": {
      if (!h.scale) return Infinity;
      const g = scaleGeometry(h.scale);
      return p[0] >= g.x0 - 30 && p[0] <= g.x1 + 30 && Math.abs(p[1] - g.y) <= 90 ? Math.abs(p[1] - g.y) : Infinity;
    }
    case "market": {
      const line = marketLine(h, values);
      if (line.length < 2) return Infinity;
      const { at } = nearestAlong(line, p);
      const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      return d <= 60 ? d : Infinity;
    }
  }
}

/**
 * A budget (spec 2026-10-02 §7): handle `k` was just set; the others take up
 * the rest in proportion to what they had, so the numbers always add up to
 * `budget`. Single-value handles only (bars); a whole pie is already a split.
 */
export function withBudget(values: number[][], k: number, budget: number): number[][] {
  const vk = Math.max(0, Math.min(budget, values[k][0]));
  const rest = budget - vk;
  const others = values.map((row, i) => (i === k ? 0 : Math.max(0, row[0])));
  const sum = others.reduce((a, b) => a + b, 0);
  const n = values.length - 1;
  return values.map((_, i) => {
    if (i === k) return [vk];
    const share = sum > 1e-9 ? (others[i] / sum) * rest : n > 0 ? rest / n : 0;
    return [Math.round(share * 100) / 100];
  });
}
