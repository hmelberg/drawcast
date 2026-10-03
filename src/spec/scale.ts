// The `scale` element (spec 2026-10-01-guess-and-reveal §6): a number line
// to guess on — "when was Mozart born?", "what share earns over $100 000?",
// "how much does Norway spend on health per person?" (a log scale). Sugar:
// it expands before layout (spec/expand.ts) into ordinary elements, so the
// player, lint and export see a group and a marker:
//
//   <id>        the line, its ticks and their numbers (and the caption)
//   <id>_answer the TRUE value: a marker over the line and its number
//
// An ask with `on: <id>` lets the viewer place the marker; drawn on its own,
// <id>_answer is simply the answer shown. The group <id> keeps the scale's
// numbers, so the guess reads its truth and geometry back (authoredScales).

import { CAPTION_TOP, contentBox, MARGIN } from "../layout/page";
import type { Spec, SpecElement } from "./types";
import { isSlider, sliderLineElements, sliderValueElements, sliderY } from "./slider";

/** The authored scale element's fields this module reads. */
export interface ScaleElementLike {
  id: string;
  type: "scale";
  min: number;
  max: number;
  /** The true value — what the marker shows (absent: a bare line, for cards to go on). */
  value?: number;
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
  /** Line length (logical; default from the page — see expandScales). */
  width?: number;
  /** How the numbers are written (default auto = "words"): "words" — numerals
   *  up to a million, then "4.3 million" … "1 sextillion", then 10ⁿ;
   *  "numerals" — every digit ("20 000 000"); "power" — 10ⁿ and "4.3 × 10¹⁹". */
  tick_format?: "words" | "numerals" | "power";
  /** Years before year 1: "BC" ("3000 BC", "AD 500") or "BCE" ("3000 BCE",
   *  "500 CE"); "none" keeps the minus sign. Default: BC on a year line that
   *  crosses into negative years. */
  era?: "BC" | "BCE" | "none";
  /** The tick numbers' size — written by the engine (placeScale: larger when the
   *  scale is alone on the page); an authored one is ignored. Default 22; the
   *  marker's number and the caption follow. */
  font_size?: number;
  /** Drawn as an estimate slider (spec/slider.ts, W15). */
  slider?: boolean;
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
  /** A number as the figure writes and the voice says it, unit included ("20 quadrillion", "30 BC", "12%"). */
  format(v: number): string;
  /** A tick's number: format without a written-out unit ("%" stays: it is part of the number). */
  tickText?(v: number): string;
  /** The text sizes: tick numbers, the marker's number, the caption. */
  sizes?: { tick: number; answer: number; caption: number };
  /** How far below the line the tick numbers' centres sit. */
  tickDrop?: number;
}


// A scale with no x/y/width is placed from the page frame (expandScales,
// which knows the page); these are the bare defaults for a scale read on
// its own — the content box's width less room for the end numbers, in its
// lower-middle (layout/page.ts).
const DEFAULT_X = MARGIN + 40;
const DEFAULT_Y = CAPTION_TOP + 150;
const DEFAULT_W = 800;
/** Text sizes at 1× (spec 2026-10-04-page-frame §4): tick numbers, the marker's number, the caption. */
const TICK_SIZE = 22;
const ALONE_TICK_SIZE = 26;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

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
  return `${neg ? "-" : ""}${d.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${frac !== undefined ? `.${frac}` : ""}`;
}

// --- Big and small numbers in words (spec 2026-10-04-page-frame, W3) ---
//
// The rule: numerals below a million ("950 000"; grouped from 10 000), then
// the short-scale names with the number of them ("1 million", "43
// quintillion"), and past the names 10ⁿ ("10²⁴", "3.2 × 10²⁵"). Tiny numbers
// (under 0.0001) are 10⁻ⁿ. "thousand" is never used: "20 000" reads at a
// glance, and one rule for the ticks and the marker keeps them alike.

const NAMES: [number, string][] = [
  [21, "sextillion"],
  [18, "quintillion"],
  [15, "quadrillion"],
  [12, "trillion"],
  [9, "billion"],
  [6, "million"],
];
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
const sup = (n: number): string => String(n).split("").map((c) => SUP[c] ?? c).join("");

/** |v| as a power of ten: "10¹⁹" when it is one, else "4.3 × 10¹⁹". */
function powerText(a: number): string {
  let e = Math.floor(Math.log10(a) + 1e-9);
  let m = Number((a / Math.pow(10, e)).toPrecision(2));
  if (m >= 10) {
    m /= 10;
    e += 1;
  }
  return Math.abs(m - 1) < 1e-9 ? `10${sup(e)}` : `${m} × 10${sup(e)}`;
}

/** Is a an exact power of ten (within float noise)? */
const isPow10 = (a: number): boolean => a > 0 && Math.abs(Math.log10(a) - Math.round(Math.log10(a))) < 1e-9;

/**
 * |v| (a ≥ 0) in the scale's tick format, or null when the numerals stay.
 * `mant` writes the count of millions/billions … (its decimals are the scale's).
 */
function wordsText(a: number, mode: "words" | "numerals" | "power", mant: (m: number, e: number) => string): string | null {
  if (a === 0 || mode === "numerals") return null;
  if (mode === "power") return isPow10(a) || a >= 1000 || a < 0.001 ? powerText(a) : null;
  if (a < 1e-4 || a >= 1e24 * (1 - 1e-9)) return powerText(a);
  for (let k = 0; k < NAMES.length; k++) {
    const [e, name] = NAMES[k];
    if (a < Math.pow(10, e) * (1 - 1e-9)) continue;
    const m = mant(a / Math.pow(10, e), e);
    // 999.96 million rounds to "1000 million": that is 1 billion.
    if (Number(m) >= 1000) return k === 0 ? powerText(a) : `1 ${NAMES[k - 1][1]}`;
    return `${m} ${name}`;
  }
  return null;
}

/** The era words of a year line ("BC" or "BCE"), or null for plain numbers. */
function eraOf(sc: ScaleElementLike, log: boolean, lo: number, hi: number): "BC" | "BCE" | null {
  if (sc.era === "BC" || sc.era === "BCE") return log ? null : sc.era;
  if (sc.era === "none" || log) return null;
  // Auto: a timeline crossing into negative years — whole numbers, a unit of
  // years or none, reaching back at least a few centuries and ending between
  // year 0 and the near future ("-3000 … 2000", "-500 … 1500").
  const unit = (sc.unit ?? "").trim();
  if (unit !== "" && !/^(years?|yrs?)$/i.test(unit)) return null;
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo >= 0) return null;
  return lo <= -200 && hi <= 3000 && (hi >= 1000 || hi <= 0) ? "BC" : null;
}

/** A label's width at a font size — the handwriting font, narrow letters narrow. */
export function scaleLabelWidth(s: string, font: number): number {
  let em = 0;
  // (Measured on the frames: digits ≈ 0.55 em, lower-case letters ≈ 0.4.)
  for (const c of s) em += c === " " ? 0.3 : /[iljtfr.,:']/.test(c) ? 0.25 : c === "1" ? 0.45 : /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/.test(c) ? 0.36 : /[mwMW%]/.test(c) ? 0.7 : /[0-9]/.test(c) ? 0.58 : /[a-z]/.test(c) ? 0.42 : 0.6;
  return em * font;
}

export function scaleGeometry(sc: ScaleElementLike): ScaleGeometry {
  const log = sc.log === true && sc.min > 0 && sc.max > 0;
  const lo = Math.min(sc.min, sc.max);
  const hi = Math.max(sc.min, sc.max) > lo ? Math.max(sc.min, sc.max) : lo + 1;
  const x0 = isNum(sc.x) ? sc.x : DEFAULT_X;
  const x1 = x0 + (isNum(sc.width) && sc.width > 50 ? sc.width : DEFAULT_W);
  const y = isNum(sc.y) ? sc.y : DEFAULT_Y;
  const unit = sc.unit ?? "";
  const era = eraOf(sc, log, lo, hi);
  const mode = sc.tick_format === "numerals" || sc.tick_format === "power" ? sc.tick_format : "words";
  // A year line (whole numbers between 1000 and 3000) is never grouped: "1756", not "1 756".
  const isYear = era !== null || (!log && Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1000 && hi <= 3000);
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
  /** The count of millions … : two significant figures on a log scale, the snap step's decimals on a linear one. */
  const mant = (m: number, e: number): string => {
    if (log) return String(Number(m.toPrecision(m >= 100 ? 3 : 2)));
    const d = Math.max(0, Math.min(3, Math.ceil(-Math.log10(linStep / Math.pow(10, e)) - 1e-9)));
    return String(Number(m.toFixed(d)));
  };
  /** The number alone: numerals, words or a power of ten. */
  const body = (v: number): string => {
    const w = wordsText(Math.abs(v), mode, mant);
    if (w !== null) return `${v < 0 ? "-" : ""}${w}`;
    // A log scale spans powers of ten: two significant figures at any size
    // ("86", "4.7", "0.003"), never a fixed count of decimals.
    const d = log ? (v >= 10 ? 0 : Math.max(1, Math.ceil(-Math.log10(Math.abs(v) || 1)) + 1)) : dec;
    // A whole number is written whole ("28 ¢", ticks "0 10 20"), even on a
    // scale whose snap step is finer than one.
    const s = log ? String(Number(v.toFixed(d))) : Number.isInteger(Number(v.toFixed(d))) ? String(Number(v.toFixed(d))) : v.toFixed(d);
    return isYear && Math.abs(v) < 10000 ? s : Math.abs(v) >= 10000 ? group(s) : s;
  };
  /** A year: "3000 BC", "AD 500" / "500 CE", "1969". */
  const yearText = (v: number, e: "BC" | "BCE"): string => {
    const r = Math.round(v);
    if (r < 0) return `${body(-r)} ${e}`;
    if (r === 0 || r >= 1000) return body(r);
    return e === "BC" ? `AD ${body(r)}` : `${body(r)} CE`;
  };
  const tickText = (v: number): string => (era ? yearText(v, era) : unit === "%" ? `${body(v)}%` : body(v));
  const format = (v: number): string => {
    if (era) return yearText(v, era);
    const b = body(v);
    return unit === "" ? b : unit === "%" ? `${b}%` : `${b} ${unit}`;
  };
  const ticks: number[] = [];
  if (log) {
    for (let e = Math.ceil(Math.log10(lo) - 1e-9); Math.pow(10, e) <= hi * (1 + 1e-9); e++) ticks.push(Number(Math.pow(10, e).toPrecision(12)));
    if (ticks.length < 2) ticks.splice(0, ticks.length, lo, hi);
  } else {
    const n = isNum(sc.ticks) && sc.ticks >= 1 ? Math.min(20, Math.round(sc.ticks)) : 5;
    // The nice step (1, 2, 2.5 or 5 × 10^k) closest to range / n.
    const raw = range / n;
    const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepT = [1, 2, 2.5, 5, 10].map((m) => m * p10).reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
    const first = Math.ceil(lo / stepT - 1e-9) * stepT;
    for (let v = first; v <= hi + stepT * 1e-6; v += stepT) ticks.push(Number(v.toFixed(10)));
    if (ticks[0] !== lo) ticks.unshift(lo);
    if (Math.abs(ticks[ticks.length - 1] - hi) > stepT * 1e-6) ticks.push(hi);
  }
  const tick = isNum(sc.font_size) && sc.font_size >= 12 ? sc.font_size : TICK_SIZE;
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
    tickText,
    sizes: { tick, answer: Math.round((tick * 28) / 22), caption: Math.round((tick * 26) / 22) },
    tickDrop: Math.round(16 + tick * 0.95),
  };
}

/** How far under the line the reveal's guess → truth bracket goes: below the tick numbers. */
export function scaleBracketDrop(g: ScaleGeometry): number {
  return (g.tickDrop ?? 37) + Math.round((g.sizes?.tick ?? TICK_SIZE) * 0.65) + 12;
}

const TICK = 10;
/** An unlabelled tick (thinned out of a crowded line) is shorter. */
const MINOR_TICK = 6;
const ACCENT = "#b5482e";
const TICK_INK = "#7a7468";
/** Room kept between two neighbouring tick numbers. */
const LABEL_GAP = 16;

/** The marker and its number at value v: `<id>_answer` (a group) and its two members. */
export function scaleValueElements(sc: ScaleElementLike, v: number): SpecElement[] {
  if (isSlider(sc)) return sliderValueElements(sc, v);
  const g = scaleGeometry(sc);
  const x = g.xAt(v);
  const color = sc.style?.color ?? ACCENT;
  const size = g.sizes?.answer ?? 28;
  return [
    {
      id: `${sc.id}_answer_pin`,
      type: "path",
      points: [
        [x - 10, g.y + 30],
        [x + 10, g.y + 30],
        [x, g.y + 6],
      ],
      closed: true,
      style: { color, fill: color, fill_style: "wash" },
    },
    { id: `${sc.id}_answer_num`, type: "text", text: g.format(v), x, y: g.y + 36 + Math.round(size * 0.6), font_size: size, style: { color } },
    { id: `${sc.id}_answer`, type: "group", members: [`${sc.id}_answer_pin`, `${sc.id}_answer_num`] },
  ];
}

/**
 * Which ticks carry their number, and at what size: every tick when the
 * numbers fit side by side; else first a size step down (to 18 at the least),
 * then every 2nd, 3rd, 6th … decade (a log scale labels the decades that are
 * whole multiples of the stride — 1, 1000, 1 million, 1 billion at 3) or
 * every k-th tick. `textScale` is the cast's text scale: what is drawn.
 */
export function scaleTickLabels(g: ScaleGeometry, textScale = 1): { labelled: Set<number>; size: number; text: (v: number) => string } {
  const tick = g.sizes?.tick ?? TICK_SIZE;
  const full = g.tickText ?? g.format;
  // Every 3rd decade of a long log line in words: the names alone read as a
  // ruler ("1000, million, billion, trillion …") where "1 quadrillion" crowds.
  const bare = (v: number): string => {
    const t = full(v);
    return /^1 [a-z]+$/.test(t) ? t.slice(2) : t;
  };
  const xs = g.ticks.map((v) => g.xAt(v));
  const n = g.ticks.length;
  const exps = g.ticks.map((v) => Math.round(Math.log10(v)));
  const pick = (k: number): number[] => {
    if (k === 1) return g.ticks.map((_, i) => i);
    const byExp = g.kind === "log" ? g.ticks.map((_, i) => i).filter((i) => ((exps[i] % k) + k) % k === 0) : [];
    return byExp.length >= 2 ? byExp : g.ticks.map((_, i) => i).filter((i) => i % k === 0);
  };
  const fits = (idx: number[], size: number, text: (v: number) => string): boolean => {
    const f = size * textScale;
    for (let j = 1; j < idx.length; j++) {
      const a = idx[j - 1], b = idx[j];
      if (xs[b] - xs[a] < (scaleLabelWidth(text(g.ticks[a]), f) + scaleLabelWidth(text(g.ticks[b]), f)) / 2 + LABEL_GAP) return false;
    }
    return true;
  };
  const strides = g.kind === "log" ? [1, 2, 3, 6, 9, 12, 15, 18, 21, 24, 30] : [1, 2, 3, 4, 5, 6, 8, 10, 20];
  const sizes = [...new Set([tick, Math.max(18, Math.round(tick * 0.85)), 18])].filter((f) => f <= tick);
  for (const k of strides) {
    if (k > 1 && k >= n) break;
    const texts = g.kind === "log" && k === 3 ? [full, bare] : [full];
    for (const text of texts) {
      for (const size of sizes) {
        const idx = pick(k);
        if (fits(idx, size, text)) return { labelled: new Set(idx), size, text };
      }
    }
  }
  return { labelled: new Set([0, n - 1]), size: sizes[sizes.length - 1], text: full };
}

/** Does the line write its unit once, at its right end? (Not "%": every number carries it; not a year line.) */
function unitOnLine(g: ScaleGeometry): string | null {
  const u = g.unit.trim();
  if (u === "" || u === "%") return null;
  return g.format(g.ticks[0]).endsWith(` ${g.unit}`) ? u : null;
}

/** The line, ticks, numbers and caption: `<id>` (a group) and its members. */
export function scaleLineElements(sc: ScaleElementLike, textScale = 1): SpecElement[] {
  if (isSlider(sc)) return sliderLineElements(sc, scaleKeep(sc), textScale);
  const g = scaleGeometry(sc);
  const sizes = g.sizes ?? { tick: TICK_SIZE, answer: 28, caption: 26 };
  const drop = g.tickDrop ?? 37;
  const out: SpecElement[] = [{ id: `${sc.id}_line`, type: "path", points: [[g.x0, g.y], [g.x1, g.y]], ...(sc.style ? { style: { ...sc.style, fill: undefined } } : {}) }];
  const { labelled, size, text: tickLabel } = scaleTickLabels(g, textScale);
  g.ticks.forEach((v, k) => {
    const x = g.xAt(v);
    const len = labelled.has(k) ? TICK : MINOR_TICK;
    out.push({ id: `${sc.id}_tick_${k + 1}`, type: "path", points: [[x, g.y - len], [x, g.y + len]] });
    // Ticks carry the number only (short canvas text); the unit is written
    // once at the line's end — "%" excepted, being part of the number.
    // A thinned-out tick keeps its number's id with no words (an empty text
    // has no ink): casts that hide or highlight <id>_tick_N_num keep working.
    out.push({ id: `${sc.id}_tick_${k + 1}_num`, type: "text", text: labelled.has(k) ? tickLabel(v) : "", x, y: g.y - drop, font_size: size, style: { color: TICK_INK } });
  });
  const u = unitOnLine(g);
  if (u !== null) {
    // Past the line's right end, raised a little so it clears the last
    // tick's number under the line, when the page has room; else after the
    // last number ("10 000 kg") when that fits beside its neighbour; else
    // under the last number, flush right.
    const f = size * textScale;
    const w = scaleLabelWidth(u, f);
    const last = g.ticks.length - 1;
    const left = g.x1 + 14;
    const prev = [...labelled].filter((i) => i < last).pop();
    const joined = labelled.has(last) ? `${tickLabel(g.ticks[last])} ${u}` : null;
    const joinedW = joined ? scaleLabelWidth(joined, f) : 0;
    if (left + w <= 1000 - 8) {
      out.push({ id: `${sc.id}_unit`, type: "text", text: u, x: left + w / 2, y: g.y + Math.round(f * 0.35), font_size: size, style: { color: TICK_INK } });
    } else if (
      joined &&
      g.x1 + joinedW / 2 <= 1000 - 8 &&
      (prev === undefined || g.xAt(g.ticks[last]) - g.xAt(g.ticks[prev]) >= (joinedW + scaleLabelWidth(tickLabel(g.ticks[prev]), f)) / 2 + LABEL_GAP)
    ) {
      const el = out.find((e) => e.id === `${sc.id}_tick_${last + 1}_num`);
      if (el) el.text = joined;
    } else {
      out.push({ id: `${sc.id}_unit`, type: "text", text: u, x: g.x1 - w / 2, y: g.y - drop - Math.round(f * 1.45), font_size: size, style: { color: TICK_INK } });
    }
  }
  if (sc.label) out.push({ id: `${sc.id}_caption`, type: "text", text: sc.label, x: (g.x0 + g.x1) / 2, y: g.y + 44 + Math.round(sizes.answer * 1.2 + sizes.caption * 0.5), font_size: sizes.caption });
  out.push({ id: sc.id, type: "group", members: out.map((e) => e.id), ...scaleKeep(sc) });
  return out;
}

/** The scale's numbers its group keeps (not its caption: a group's label
 *  means nothing) — the guess reads its truth and geometry back from them. */
function scaleKeep(sc: ScaleElementLike): Partial<SpecElement> {
  const keep: Partial<SpecElement> = { min: sc.min, max: sc.max, ...(isNum(sc.value) ? { value: sc.value } : {}) };
  if (sc.log !== undefined) keep.log = sc.log;
  if (sc.unit !== undefined) keep.unit = sc.unit;
  if (sc.ticks !== undefined) keep.ticks = sc.ticks;
  if (sc.x !== undefined) keep.x = sc.x;
  if (sc.y !== undefined) keep.y = sc.y;
  if (sc.width !== undefined) keep.width = sc.width;
  if (sc.tick_format !== undefined) keep.tick_format = sc.tick_format;
  if (sc.era !== undefined) keep.era = sc.era;
  if (sc.font_size !== undefined) keep.font_size = sc.font_size;
  if (sc.slider === true) keep.slider = true;
  if (sc.style !== undefined) keep.style = sc.style;
  return keep;
}

/** The scales of an expanded spec: the groups expandScales left, read back. */
export function authoredScales(spec: Pick<Spec, "elements">): ScaleElementLike[] {
  const out: ScaleElementLike[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "group" || typeof el.min !== "number" || typeof el.max !== "number") continue;
    if (!(el.members ?? []).includes(`${el.id}_line`)) continue;
    out.push({
      id: el.id,
      type: "scale",
      min: el.min,
      max: el.max,
      ...(typeof el.value === "number" ? { value: el.value } : {}),
      ...(el.log !== undefined ? { log: el.log } : {}),
      ...(el.unit !== undefined ? { unit: el.unit } : {}),
      ...(el.ticks !== undefined ? { ticks: el.ticks } : {}),
      ...(el.x !== undefined ? { x: el.x } : {}),
      ...(el.y !== undefined ? { y: el.y } : {}),
      ...(el.width !== undefined ? { width: el.width } : {}),
      ...(el.tick_format !== undefined ? { tick_format: el.tick_format } : {}),
      ...(el.era !== undefined ? { era: el.era } : {}),
      ...(el.font_size !== undefined ? { font_size: el.font_size } : {}),
      ...(el.slider === true ? { slider: true } : {}),
      ...(el.style !== undefined ? { style: el.style } : {}),
    });
  }
  return out;
}

function isScale(el: SpecElement): boolean {
  return (el as { type: string }).type === "scale";
}

/**
 * Where a scale goes when the author did not say (spec 2026-10-04-page-frame
 * §3): centred in the content box, about 800 wide less room for its end
 * numbers and its unit. Alone on the page (nothing else but words, and cards
 * placed along it) it is the figure: larger numbers, a little more width,
 * the middle of the content area. With company it takes the lower-middle,
 * leaving the upper part to the rest. Cards `along` it need their tray under
 * the line (spec/cards.ts place mode) and their levels over it. Any of x, y,
 * width, font_size the author gave wins.
 */
export function placeScale(sc: ScaleElementLike, spec: Pick<Spec, "elements"> & { text?: { font_size?: number }; heading?: unknown }): ScaleElementLike {
  // font_size is the engine's (an authored one was never read: the cast's text.font_size sizes a scale's words).
  const { font_size: _authored, ...own } = sc;
  void _authored;
  sc = own as ScaleElementLike;
  const els = spec.elements ?? [];
  const along = els.filter((e) => (e as { type: string }).type === "cards" && (e as { along?: unknown }).along === sc.id);
  const alone = els.every((e) => e.id === sc.id || e.type === "text" || e.type === "label" || along.includes(e));
  const box = contentBox({ heading: spec.heading !== false });
  const textScale = isNum(spec.text?.font_size) ? spec.text!.font_size! / 26 : 1;
  const out: ScaleElementLike = { ...sc };
  // Alone, the numbers are a step larger — within reason at the cast's text scale.
  if (alone) {
    const tick = Math.max(TICK_SIZE, Math.min(ALONE_TICK_SIZE, Math.round(30 / textScale)));
    if (tick !== TICK_SIZE) out.font_size = tick;
  }
  if (isNum(sc.x) && isNum(sc.y) && isNum(sc.width)) return out;
  if (!isNum(sc.width) || !isNum(sc.x)) {
    const g = scaleGeometry({ ...out, x: 0, width: 800 });
    const f = (g.sizes?.tick ?? TICK_SIZE) * textScale;
    const text = g.tickText ?? g.format;
    const endL = scaleLabelWidth(text(g.ticks[0]), f) / 2 + 8;
    const endR = scaleLabelWidth(text(g.ticks[g.ticks.length - 1]), f) / 2 + 8;
    const u = unitOnLine(g);
    // The unit goes past the line's end (scaleLineElements).
    const right = u !== null ? Math.max(endR, 14 + scaleLabelWidth(u, f)) : endR;
    const room = box.w - endL - right;
    const width = isNum(sc.width) ? sc.width : Math.round(Math.min(alone ? 840 : 800, room));
    out.width = width;
    if (!isNum(sc.x)) out.x = Math.round(box.x + endL + Math.max(0, room - width) / 2);
  }
  if (!isNum(sc.y)) {
    let y: number;
    if (along.length > 0) {
      // The tray under the line: one row of cards, two from six cards on.
      const items = along.flatMap((c) => ((c as { items?: unknown }).items as unknown[] | undefined) ?? []);
      const icons = items.some((it) => typeof it === "object" && it !== null && (it as { icon?: unknown }).icon !== undefined);
      // An authored cards `size` (spec/cards.ts) scales the rows; "auto" grows them only into room left over.
      const size = along.map((c) => (c as { size?: unknown }).size).find(isNum) ?? 1;
      const h = (icons ? 96 : 48) * size;
      const rows = items.length > 5 ? 2 : 1;
      // Under it the tray; over it the placed cards, in up to two levels.
      const lowest = box.y + 10 + 86 + rows * h + (rows - 1) * 14;
      const highest = box.y + box.h - 10 - 40 - 2 * (h + 8);
      y = highest > lowest ? (lowest + highest) / 2 : lowest;
    } else if (isSlider(sc)) {
      y = sliderY(box);
    } else {
      y = box.y + box.h * (alone ? 0.45 : 0.3);
    }
    out.y = Math.round(Math.max(box.y + 60, Math.min(y, box.y + box.h - 140)));
  }
  return out;
}

export function expandScales(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some(isScale)) return spec;
  const textScale = isNum(spec.text?.font_size) ? spec.text!.font_size! / 26 : 1;
  const out: SpecElement[] = [];
  for (const el of els) {
    if (!isScale(el)) {
      out.push(el);
      continue;
    }
    const sc = placeScale(el as unknown as ScaleElementLike, spec as Spec & { heading?: unknown });
    out.push(...scaleLineElements(sc, textScale), ...(isNum(sc.value) ? scaleValueElements(sc, sc.value) : []));
  }
  return { ...spec, elements: out };
}
