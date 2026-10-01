// The `scale` element (spec 2026-10-01-guess-and-reveal §6): a number line
// to guess on — "when was Mozart born?", "what share earns over $100 000?",
// "how much does Norway spend on health per person?" (a log scale). Sugar:
// it expands before layout (spec/expand.ts) into ordinary elements, so the
// player, lint and export see a group and a marker:
//
//   <id>        the line, its ticks and their numbers (and the caption)
//   <id>_value  the TRUE value: a marker over the line and its number
//
// An ask with `on: <id>` lets the viewer place the marker; drawn on its own,
// <id>_value is simply the answer shown. The authored element is kept on the
// expanded spec's `scales` list, so the guess can read its truth and geometry.

import type { Spec, SpecElement } from "./types";

/** The authored scale element's fields this module reads. */
export interface ScaleElementLike {
  id: string;
  type: "scale";
  min: number;
  max: number;
  /** The true value — what the marker shows. */
  value: number;
  /** Logarithmic spacing (min must be > 0). */
  log?: boolean;
  /** "%", "years", "USD" … — written after the marker's number ("%" with no space). */
  unit?: string;
  /** A caption above the line's left end. */
  label?: string;
  /** How many tick intervals (default 5 linear, one per decade log). */
  ticks?: number;
  /** Left end of the line and its height (logical; default 150, 300). */
  x?: number;
  y?: number;
  /** Line length (logical; default 700). */
  width?: number;
  style?: SpecElement["style"];
}

export interface ScaleGeometry {
  kind: "linear" | "log";
  min: number;
  max: number;
  value: number;
  unit: string;
  x0: number;
  x1: number;
  y: number;
  /** Value → logical x. */
  xAt(v: number): number;
  /** Logical x → value, snapped to a readable number. */
  valueAtX(x: number): number;
  /** The value in the middle of the line (where a guess starts). */
  middle: number;
  /** One keyboard step from v (log: about 2 % of a decade per step). */
  stepFrom(v: number, steps: number): number;
  ticks: number[];
  format(v: number): string;
}

const DEFAULT_X = 150;
const DEFAULT_Y = 300;
const DEFAULT_W = 700;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 1, 2 or 5 × 10^k at or under v. */
function niceBelow(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

/** Round v to two significant figures — a log guess reads "4 700", not "4 683.2". */
function twoSig(v: number): number {
  if (v === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / p) * p;
}

function group(s: string): string {
  const [int, frac] = s.split(".");
  const neg = int.startsWith("-");
  const d = neg ? int.slice(1) : int;
  return `${neg ? "-" : ""}${d.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${frac !== undefined ? `.${frac}` : ""}`;
}

export function scaleGeometry(sc: ScaleElementLike): ScaleGeometry {
  const log = sc.log === true && sc.min > 0 && sc.max > 0;
  const lo = Math.min(sc.min, sc.max);
  const hi = Math.max(sc.min, sc.max) > lo ? Math.max(sc.min, sc.max) : lo + 1;
  const x0 = isNum(sc.x) ? sc.x : DEFAULT_X;
  const x1 = x0 + (isNum(sc.width) && sc.width > 50 ? sc.width : DEFAULT_W);
  const y = isNum(sc.y) ? sc.y : DEFAULT_Y;
  const unit = sc.unit ?? "";
  // A year line (whole numbers between 1000 and 3000) is never grouped: "1756", not "1 756".
  const isYear = !log && Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1000 && hi <= 3000;
  const range = hi - lo;
  const linStep = (() => {
    const raw = range / 100;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    const s = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
    return isYear ? Math.max(1, s) : s;
  })();
  const dec = linStep >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(linStep) - 1e-9));
  const t = (v: number): number => (log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / range);
  const inv = (f: number): number => (log ? Math.pow(10, Math.log10(lo) + f * (Math.log10(hi) - Math.log10(lo))) : lo + f * range);
  const clampV = (v: number): number => Math.max(lo, Math.min(hi, v));
  const snapV = (v: number): number => (log ? twoSig(v) : Number((Math.round(v / linStep) * linStep).toFixed(dec)));
  const format = (v: number): string => {
    const d = log ? (v >= 100 ? 0 : v >= 10 ? 1 : 2) : dec;
    const s = v.toFixed(d);
    const body = isYear ? s : Math.abs(v) >= 10000 ? group(s) : s;
    return unit === "" ? body : unit === "%" ? `${body}%` : `${body} ${unit}`;
  };
  const ticks: number[] = [];
  if (log) {
    for (let e = Math.ceil(Math.log10(lo) - 1e-9); Math.pow(10, e) <= hi * (1 + 1e-9); e++) ticks.push(Math.pow(10, e));
    if (ticks.length < 2) ticks.splice(0, ticks.length, lo, hi);
  } else {
    const n = isNum(sc.ticks) && sc.ticks >= 1 ? Math.min(20, Math.round(sc.ticks)) : 5;
    const raw = range / n;
    const p = niceBelow(raw) === raw ? raw : niceBelow(raw);
    const stepT = Math.abs(raw - p) / raw < 0.5 ? p : raw;
    const first = Math.ceil(lo / stepT - 1e-9) * stepT;
    for (let v = first; v <= hi + stepT * 1e-6; v += stepT) ticks.push(Number(v.toFixed(10)));
    if (ticks[0] !== lo) ticks.unshift(lo);
    if (Math.abs(ticks[ticks.length - 1] - hi) > stepT * 1e-6) ticks.push(hi);
  }
  return {
    kind: log ? "log" : "linear",
    min: lo,
    max: hi,
    value: clampV(isNum(sc.value) ? sc.value : (lo + hi) / 2),
    unit,
    x0,
    x1,
    y,
    xAt: (v) => x0 + t(clampV(v)) * (x1 - x0),
    valueAtX: (x) => snapV(clampV(inv(Math.max(0, Math.min(1, (x - x0) / (x1 - x0)))))),
    middle: snapV(inv(0.5)),
    stepFrom: (v, steps) => {
      if (!log) return snapV(clampV(v + steps * linStep * 5));
      const f = Math.max(0, Math.min(1, t(clampV(v)) + steps * 0.01));
      return snapV(inv(f));
    },
    ticks,
    format,
  };
}

const TICK = 10;
const ACCENT = "#b5482e";

/** The marker and its number at value v: `<id>_value` (a group) and its two members. */
export function scaleValueElements(sc: ScaleElementLike, v: number): SpecElement[] {
  const g = scaleGeometry(sc);
  const x = g.xAt(v);
  const color = sc.style?.color ?? ACCENT;
  return [
    {
      id: `${sc.id}_value_mark`,
      type: "path",
      points: [
        [x - 10, g.y + 30],
        [x + 10, g.y + 30],
        [x, g.y + 6],
      ],
      closed: true,
      style: { color, fill: color, fill_style: "wash" },
    },
    { id: `${sc.id}_value_text`, type: "text", text: g.format(v), x, y: g.y + 52, font_size: 24, style: { color } },
    { id: `${sc.id}_value`, type: "group", members: [`${sc.id}_value_mark`, `${sc.id}_value_text`] },
  ];
}

/** The line, ticks, numbers and caption: `<id>` (a group) and its members. */
export function scaleLineElements(sc: ScaleElementLike): SpecElement[] {
  const g = scaleGeometry(sc);
  const out: SpecElement[] = [{ id: `${sc.id}_line`, type: "path", points: [[g.x0, g.y], [g.x1, g.y]], ...(sc.style ? { style: { ...sc.style, fill: undefined } } : {}) }];
  g.ticks.forEach((v, k) => {
    const x = g.xAt(v);
    out.push({ id: `${sc.id}_tick_${k + 1}`, type: "path", points: [[x, g.y - TICK], [x, g.y + TICK]] });
    out.push({ id: `${sc.id}_tick_${k + 1}_text`, type: "text", text: g.format(v), x, y: g.y - 34, font_size: 18, style: { color: "#7a7468" } });
  });
  if (sc.label) out.push({ id: `${sc.id}_caption`, type: "text", text: sc.label, x: (g.x0 + g.x1) / 2, y: g.y + 100, font_size: 24 });
  out.push({ id: sc.id, type: "group", members: out.map((e) => e.id) });
  return out;
}

/** The expanded spec also carries the authored scales (read by the guess). */
export type SpecWithScales = Spec & { scales?: ScaleElementLike[] };

function isScale(el: SpecElement): boolean {
  return (el as { type: string }).type === "scale";
}

export function expandScales(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some(isScale)) return spec;
  const scales: ScaleElementLike[] = [];
  const out: SpecElement[] = [];
  for (const el of els) {
    if (!isScale(el)) {
      out.push(el);
      continue;
    }
    const sc = el as unknown as ScaleElementLike;
    scales.push(sc);
    out.push(...scaleLineElements(sc), ...scaleValueElements(sc, scaleGeometry(sc).value));
  }
  return { ...spec, elements: out, scales } as SpecWithScales;
}
