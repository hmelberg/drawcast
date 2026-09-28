// The `population` element (2026-09-28): a group of people drawn as small
// person pictograms, each in a STATE — healthy, sick, immune, vaccinated,
// dead, or one the cast names with a colour. Casts about epidemics,
// vaccination, screening, risk and trials used to fall back on dots or
// improvised stick-figure crowds; this is the one structure they share.
//
// Structure-derived and animatable (STYLE 2026-09-23): every person keeps
// the slot it was given, and a state's COUNT decides who is in it through a
// fixed per-state sequence of slots (`order`). Raising a count therefore
// turns the next people in that sequence over, one by one — bind the count
// to a var and `animate` the var, and an infection spreads from its seed
// (cluster), a vaccination campaign reaches evenly across the crowd
// (spread), a screening fills row by row (rows).
//
// Ids: each state is a SET, `<id>_<state>` — a group drawable holding every
// person currently in that state (possibly none), so a cast can highlight
// or focus "the vaccinated"; `<id>_legend` is the legend. The element's own
// id stands for all of them (tier2 registers the sets as its pieces).
// Values: `{<id>.<state>}` and `{<id>.count}` in drawn text.

import { COLORS, INK, Z_AREA, Z_STROKE, Z_TEXT, defaultStyle, type Drawable, type GroupDrawable, type Pt } from "./model";
import type { BBox } from "./geometry";
import type { MeasureFn } from "./measure";
import type { LintIssue } from "../lint/lint";
import type { SpecElement } from "../spec/types";

/** The built-in states, with the look each is drawn in. */
export const POPULATION_STATES = ["healthy", "sick", "immune", "vaccinated", "dead"] as const;
export type PopulationOrder = "spread" | "cluster" | "random" | "rows";
export const POPULATION_ORDERS: readonly PopulationOrder[] = ["spread", "cluster", "random", "rows"];

/** Other names a cast naturally gives the same looks. */
const ALIASES: Record<string, (typeof POPULATION_STATES)[number]> = {
  well: "healthy", susceptible: "healthy", unvaccinated: "healthy", unaffected: "healthy",
  ill: "sick", infected: "sick", infectious: "sick", affected: "sick", cases: "sick",
  recovered: "immune", protected: "immune",
  vaccine: "vaccinated", jabbed: "vaccinated",
  died: "dead", deaths: "dead",
};

/** More people than this is not a picture of people. */
export const POPULATION_MAX = 400;
/**
 * A person shorter than this (logical units; the canvas is 750 tall) stops
 * reading as a person — a head and a smudge. The lint suggests a count or a
 * larger area that keeps every pictogram at least this tall.
 */
export const POPULATION_MIN_HEIGHT = 20;
/** Tallest a pictogram is drawn, however much room it gets. */
const MAX_HEIGHT = 90;
const LEGEND_FONT = 22;
const LEGEND_ICON = 26;
const LEGEND_ROW = 36;
/** Default time for the whole crowd to sketch itself, seconds. */
const DRAW_SECONDS = 2.4;

export interface StateLook {
  /** Outline. */
  color: string;
  /** Body and head fill; absent = paper (an outline person). */
  fill?: string;
  /** A small paper-coloured mark on the body: a check (immune), a plaster (vaccinated). */
  badge?: "check" | "plaster";
  opacity: number;
}

/** Mix `hex` toward `to` by t (0 = hex). */
function mix(hex: string, to: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(to);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Sick is the only dark SOLID figure; immune is a pale sage one with a
// check on its chest — so the two never rest on red against green alone
// (the pair a red-green colour-blind viewer loses): they differ in
// lightness and in shape too.
const BUILTIN: Record<(typeof POPULATION_STATES)[number], StateLook> = {
  healthy: { color: INK, opacity: 1 },
  sick: { color: mix(COLORS.demand, INK, 0.25), fill: COLORS.demand, opacity: 1 },
  immune: { color: mix(COLORS.region2, INK, 0.45), fill: COLORS.region2, badge: "check", opacity: 1 },
  vaccinated: { color: mix(COLORS.supply, INK, 0.3), fill: COLORS.supply, badge: "plaster", opacity: 1 },
  dead: { color: COLORS.guide, opacity: 0.45 },
};
/** Custom states without a colour take these in turn. */
const CUSTOM_CYCLE = [COLORS.accent, COLORS.shifted, COLORS.region1];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A colour as written: a hex, or a palette role name (demand, supply, accent, …). */
function colourOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (HEX.test(v)) return v;
  const named = (COLORS as Record<string, unknown>)[v];
  return typeof named === "string" && HEX.test(named) ? named : null;
}

/** The look a state is drawn in, and whether it is a built-in one. */
export function stateLook(name: string, colors: Record<string, string> | undefined, customIndex: number): { look: StateLook; builtin: boolean } {
  const own = colourOf(colors?.[name]);
  const base = (POPULATION_STATES as readonly string[]).includes(name) ? (name as (typeof POPULATION_STATES)[number]) : ALIASES[name.toLowerCase()];
  if (base && !own) return { look: BUILTIN[base], builtin: true };
  if (base && own) return { look: { ...BUILTIN[base], color: mix(own, INK, 0.3), ...(BUILTIN[base].fill ? { fill: own } : {}) }, builtin: true };
  const c = own ?? CUSTOM_CYCLE[customIndex % CUSTOM_CYCLE.length];
  return { look: { color: mix(c, INK, 0.3), fill: c, opacity: 1 }, builtin: own !== null };
}

export interface PopulationCounts {
  count: number;
  /** Declared order; the first is the remainder. */
  states: { name: string; n: number }[];
  issues: string[];
}

/**
 * How many people, and how many in each state. `count` (default: the states'
 * sum, else 100); every state after the first takes its own number, rounded
 * and cut to what is left; the first state is the remainder.
 */
export function populationCounts(el: SpecElement): PopulationCounts {
  const issues: string[] = [];
  const raw = el.states && typeof el.states === "object" ? Object.entries(el.states) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const sum = raw.reduce((s, [, v]) => s + Math.max(0, num(v)), 0);
  let count = typeof el.count === "number" && Number.isFinite(el.count) ? Math.round(el.count) : sum > 0 ? Math.round(sum) : 100;
  if (count > POPULATION_MAX) {
    issues.push(`count ${count} is more than ${POPULATION_MAX} people — drawn as ${POPULATION_MAX}; a picture of people reads up to about 100`);
    count = POPULATION_MAX;
  }
  count = Math.max(1, count);
  if (raw.length === 0) return { count, states: [{ name: "healthy", n: count }], issues };
  let left = count;
  const rest: { name: string; n: number }[] = [];
  const asked = raw.slice(1).reduce((s, [, v]) => s + Math.max(0, Math.round(num(v))), 0);
  if (asked > count) issues.push(`states after "${raw[0][0]}" add up to ${asked}, more than count ${count} — the later ones are cut`);
  for (const [name, v] of raw.slice(1)) {
    const n = Math.min(left, Math.max(0, Math.round(num(v))));
    left -= n;
    rest.push({ name, n });
  }
  return { count, states: [{ name: raw[0][0], n: left }, ...rest], issues };
}

/** The values a population offers drawn text: `{pop.count}`, `{pop.sick}`, … */
export function populationValues(el: SpecElement): Record<string, number> {
  const c = populationCounts(el);
  const out: Record<string, number> = { [`${el.id}.count`]: c.count };
  for (const s of c.states) out[`${el.id}.${s.name}`] = s.n;
  return out;
}

// ---- deterministic randomness ------------------------------------------------

function rng(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- slots ---------------------------------------------------------------------

export interface PopulationSlots {
  /** Slot centres (the person's middle), row-major from the top left. */
  centres: Pt[];
  /** Pictogram height per slot (a crowd varies it a little). */
  heights: number[];
  /** The nominal person height. */
  h: number;
  cols: number;
  rows: number;
}

/** Columns × rows that draw `n` people largest in a w × h box. */
function bestGrid(n: number, w: number, h: number): { cols: number; rows: number; ph: number } {
  let best = { cols: 1, rows: n, ph: 0 };
  // A person is 0.6 of its height wide; the cell leaves room around it.
  const size = (cols: number, rows: number) => Math.min((h / rows) * 0.86, (w / cols) * 1.2);
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const ph = size(cols, rows);
    // Prefer the grid with fewer empty cells when two draw the same size.
    if (ph > best.ph + 1e-6 || (Math.abs(ph - best.ph) < 1e-6 && cols * rows < best.cols * best.rows)) best = { cols, rows, ph };
  }
  // Tens are counted at a glance ("8 in 100"): rows of ten win when they cost
  // little size.
  if (n >= 30 && n % 10 === 0 && best.cols !== 10) {
    const ph = size(10, n / 10);
    if (ph >= best.ph * 0.85) best = { cols: 10, rows: n / 10, ph };
  }
  return best;
}

export function populationSlots(n: number, box: BBox, layout: "grid" | "crowd", seed: number): PopulationSlots {
  const { cols, rows, ph } = bestGrid(n, box.w, box.h);
  const h = Math.min(MAX_HEIGHT, ph);
  const cw = box.w / cols, ch = box.h / rows;
  // The block is centred: a short last row sits in the middle.
  const usedW = Math.min(box.w, cw * cols);
  const x0 = box.x + (box.w - usedW) / 2;
  const top = box.y + box.h;
  const centres: Pt[] = [];
  const heights: number[] = [];
  const r = rng(seed * 31 + 7);
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / cols), col = k % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const shift = ((cols - inRow) * cw) / 2;
    let cx = x0 + shift + cw * (col + 0.5);
    let cy = top - ch * (row + 0.5);
    let hk = h;
    if (layout === "crowd") {
      // Every other row half a step over, and each person nudged and a
      // little taller or shorter: people standing about, not a table.
      if (row % 2 === 1 && inRow === cols) cx += cw * 0.25;
      else if (row % 2 === 0 && inRow === cols) cx -= cw * 0.12;
      cx += (r() - 0.5) * cw * 0.3;
      cy += (r() - 0.5) * ch * 0.22;
      hk = h * (0.9 + r() * 0.16);
    }
    centres.push([cx, cy]);
    heights.push(hk);
  }
  return { centres, heights, h, cols, rows };
}

// ---- who is in which state -------------------------------------------------------

/** The order in which a state takes the slots. Pure and deterministic per seed. */
export function slotSequence(centres: Pt[], order: PopulationOrder, seed: number): number[] {
  const n = centres.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n === 0) return idx;
  const r = rng(seed);
  if (order === "rows") return idx;
  if (order === "random") {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }
  const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  // The typical neighbour distance, for the cluster's roughness.
  const xs = centres.map((c) => c[0]), ys = centres.map((c) => c[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const step = span / Math.max(1, Math.sqrt(n));
  if (order === "cluster") {
    // A seed person near the middle, then outward — by distance with a
    // little noise, so the patch grows ragged, as an outbreak does.
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const near = idx.filter((i) => Math.sqrt(d2(centres[i], [mx, my])) <= span * 0.3);
    const start = (near.length > 0 ? near : idx)[Math.floor(r() * (near.length > 0 ? near.length : n))];
    const noise = idx.map(() => r() * step * 1.6);
    return idx
      .map((i) => ({ i, d: Math.sqrt(d2(centres[i], centres[start])) + (i === start ? -1e9 : noise[i]) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .map((x) => x.i);
  }
  // spread: farthest-point order — every prefix is as even as it can be, so
  // 10, 30 or 60 of 100 each look evenly mixed through the crowd, and
  // raising the count only adds people (none trade places).
  const out: number[] = [];
  const best = new Array<number>(n).fill(Infinity);
  const jitter = idx.map(() => r() * step * step * 0.05);
  let cur = Math.floor(r() * n);
  const taken = new Array<boolean>(n).fill(false);
  for (let t = 0; t < n; t++) {
    out.push(cur);
    taken[cur] = true;
    let next = -1, far = -1;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      best[i] = Math.min(best[i], d2(centres[i], centres[cur]));
      const score = best[i] + jitter[i];
      if (score > far) { far = score; next = i; }
    }
    if (next < 0) break;
    cur = next;
  }
  return out;
}

/** The order each state uses: one for all, or per state (default spread). */
export function orderOf(el: SpecElement, state: string): PopulationOrder {
  const o = el.order;
  if (typeof o === "string") return (POPULATION_ORDERS as readonly string[]).includes(o) ? (o as PopulationOrder) : "spread";
  if (o && typeof o === "object") {
    const v = (o as Record<string, unknown>)[state];
    if (typeof v === "string" && (POPULATION_ORDERS as readonly string[]).includes(v)) return v as PopulationOrder;
  }
  return "spread";
}

/**
 * State index per slot. The states after the first take their slots in the
 * order they are written: each its own `n` from its own sequence, skipping
 * slots an earlier state holds; the rest are the first state. So growing the
 * LAST state never moves anyone else — write the state that grows last
 * (vaccinated before sick: the infection then only reaches the unvaccinated).
 */
export function assignStates(centres: Pt[], counts: { name: string; n: number }[], el: SpecElement): number[] {
  const n = centres.length;
  const owner = new Array<number>(n).fill(0);
  const seed = typeof el.seed === "number" && Number.isFinite(el.seed) ? Math.round(el.seed) : 1;
  counts.forEach((s, si) => {
    if (si === 0 || s.n <= 0) return;
    const seq = slotSequence(centres, orderOf(el, s.name), seed * 1009 + si * 7919);
    let need = s.n;
    for (const k of seq) {
      if (need <= 0) break;
      if (owner[k] !== 0) continue;
      owner[k] = si;
      need--;
    }
  });
  return owner;
}

// ---- drawing ------------------------------------------------------------------------

function circle(c: Pt, r: number, m = 14): Pt[] {
  return Array.from({ length: m }, (_, i): Pt => [c[0] + r * Math.cos((2 * Math.PI * i) / m), c[1] + r * Math.sin((2 * Math.PI * i) / m)]);
}

/** The body outline of a person of height h centred on c: rounded shoulders, a slight waist, two legs. */
function bodyPts(c: Pt, h: number): Pt[] {
  const u: Pt[] = [
    [0.07, 0.115], [0.19, 0.1], [0.26, 0.055], [0.29, -0.03], [0.28, -0.2], [0.24, -0.27],
    [0.21, -0.5], [0.04, -0.5], [0, -0.33], [-0.04, -0.5], [-0.21, -0.5], [-0.24, -0.27],
    [-0.28, -0.2], [-0.29, -0.03], [-0.26, 0.055], [-0.19, 0.1], [-0.07, 0.115],
  ];
  return u.map(([x, y]): Pt => [c[0] + x * h, c[1] + y * h]);
}

/** One person: an outline head and body, filled when the state has a fill, and its badge. */
export function personDrawables(pid: string, c: Pt, h: number, look: StateLook, ms: number): Drawable[] {
  const head: Pt = [c[0], c[1] + 0.31 * h];
  const headR = 0.155 * h;
  const body = bodyPts(c, h);
  const sw = Math.max(1.2, Math.min(3, h * 0.05));
  const stroke = (id: string, pts: Pt[]): Drawable => ({
    id,
    kind: "stroke",
    pts,
    closed: true,
    z: Z_STROKE,
    style: defaultStyle({ color: look.color, strokeWidth: sw, roughness: 0.6, opacity: look.opacity }),
    drawOpts: { mode: "sketch", duration: ms },
  });
  const area = (id: string, pts: Pt[], fill: string): Drawable => ({
    id,
    kind: "area",
    pts,
    precise: true,
    z: Z_AREA,
    style: defaultStyle({ color: fill, fill, opacity: look.opacity * 0.92 }),
    drawOpts: { mode: "sketch", duration: ms },
  });
  const out: Drawable[] = [];
  const headPts = circle(head, headR);
  // Paper under an outline person: a figure over a line or a region stays one figure.
  out.push(area(`${pid}_bf`, body, look.fill ?? COLORS.paper));
  out.push(area(`${pid}_hf`, headPts, look.fill ?? COLORS.paper));
  out.push(stroke(`${pid}_b`, body));
  out.push(stroke(`${pid}_h`, headPts));
  if (look.badge && h >= 16) {
    const bw = Math.max(1.4, h * 0.06);
    const pts: Pt[] = look.badge === "check"
      ? [[c[0] - 0.1 * h, c[1] - 0.06 * h], [c[0] - 0.02 * h, c[1] - 0.15 * h], [c[0] + 0.13 * h, c[1] + 0.03 * h]]
      : [[c[0] + 0.12 * h, c[1] + 0.02 * h], [c[0] + 0.24 * h, c[1] - 0.06 * h]];
    out.push({
      id: `${pid}_m`,
      kind: "stroke",
      pts,
      z: Z_STROKE,
      precise: true,
      style: defaultStyle({ color: COLORS.paper, strokeWidth: look.badge === "plaster" ? bw * 1.5 : bw, roughness: 0, opacity: look.opacity }),
      drawOpts: { mode: "sketch", duration: ms },
    });
  }
  return out;
}

function group(id: string, children: Drawable[], z = Z_STROKE): GroupDrawable {
  return { id, kind: "group", z, style: defaultStyle(), drawOpts: { mode: "sketch", duration: 0 }, children };
}

export interface PopulationLaid {
  /** One group per state (`<id>_<state>`, in declared order), then `<id>_legend` when drawn. */
  drawables: GroupDrawable[];
  /** The set ids, in order (the legend last when drawn). */
  ids: string[];
  /** Each set's anchor (the middle of its people; the box centre when empty). */
  anchors: Record<string, Pt>;
  /** Each non-empty set's box (its people), and the legend's. */
  boxes: Record<string, BBox>;
  /** The people's block and the whole element (people + legend). */
  block: BBox;
  box: BBox;
  /** Nominal pictogram height. */
  personHeight: number;
  values: Record<string, number>;
  issues: LintIssue[];
}

/** The rectangle a population is drawn in: `fit` (a region or a box), else centred on `c`. */
export function populationBox(el: SpecElement, c: Pt, region: BBox | null, slotWidth?: number): BBox {
  if (region) return region;
  const w = typeof el.width === "number" && el.width > 0 ? el.width : Math.min(440, slotWidth ?? 440);
  const h = typeof el.height === "number" && el.height > 0 ? el.height : 440;
  return { x: c[0] - w / 2, y: c[1] - h / 2, w, h };
}

/** Lay a population out in `box` (which holds the legend too). */
export function layoutPopulation(el: SpecElement, box: BBox, measure: MeasureFn): PopulationLaid {
  const issues: LintIssue[] = [];
  const warn = (message: string) => issues.push({ rule: "population", ids: [el.id], severity: "warn", message: `population "${el.id}": ${message}` });
  const counts = populationCounts(el);
  counts.issues.forEach(warn);
  const colors = el.colors;
  let custom = 0;
  const looks = counts.states.map((s) => {
    const r = stateLook(s.name, colors, custom);
    if (!r.builtin) {
      custom++;
      warn(`state "${s.name}" has no built-in look (${POPULATION_STATES.join(", ")}) — give it a colour in colors`);
    }
    return r.look;
  });
  const names = new Set(counts.states.map((s) => s.name));
  for (const k of Object.keys(el.labels ?? {})) if (!names.has(k)) warn(`labels names "${k}", which is not one of its states`);
  for (const k of Object.keys(colors ?? {})) if (!names.has(k)) warn(`colors names "${k}", which is not one of its states`);
  for (const s of counts.states) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.name)) warn(`state "${s.name}" is not a name (letters, digits, _): its set id <id>_${s.name} cannot be named`);
  }
  if (el.order && typeof el.order === "object") {
    for (const [k, v] of Object.entries(el.order)) {
      if (!names.has(k)) warn(`order names "${k}", which is not one of its states`);
      else if (!(POPULATION_ORDERS as readonly string[]).includes(v as string)) warn(`order "${v}" for "${k}" is not one of ${POPULATION_ORDERS.join(", ")}`);
    }
  } else if (typeof el.order === "string" && !(POPULATION_ORDERS as readonly string[]).includes(el.order)) {
    warn(`order "${el.order}" is not one of ${POPULATION_ORDERS.join(", ")}`);
  }

  const legendOn = el.legend !== false;
  const layoutKind = el.layout === "crowd" ? "crowd" : "grid";
  // The legend: one entry per state, "70 healthy", in rows under the people.
  const labelOf = (name: string) => (typeof el.labels?.[name] === "string" ? el.labels[name] : name);
  const entryW = counts.states.map((s) => LEGEND_ICON * 0.7 + 8 + measure(`${s.n} ${labelOf(s.name)}`, LEGEND_FONT).w);
  const gapX = 26;
  const legendRows: number[][] = [];
  if (legendOn) {
    let row: number[] = [], w = 0;
    entryW.forEach((ew, i) => {
      if (row.length > 0 && w + gapX + ew > box.w) {
        legendRows.push(row);
        row = [];
        w = 0;
      }
      w += (row.length > 0 ? gapX : 0) + ew;
      row.push(i);
    });
    if (row.length > 0) legendRows.push(row);
  }
  const legendH = legendRows.length * LEGEND_ROW + (legendOn ? 12 : 0);
  const block: BBox = { x: box.x, y: box.y + legendH, w: box.w, h: Math.max(10, box.h - legendH) };

  const seed = typeof el.seed === "number" && Number.isFinite(el.seed) ? Math.round(el.seed) : 1;
  const slots = populationSlots(counts.count, block, layoutKind, seed);
  if (slots.h < POPULATION_MIN_HEIGHT) {
    // How many fit at the readable height in this block, and how big a block
    // this many need.
    let fits = counts.count;
    while (fits > 1 && bestGrid(fits, block.w, block.h).ph < POPULATION_MIN_HEIGHT) fits--;
    const grow = POPULATION_MIN_HEIGHT / Math.max(1, slots.h);
    warn(
      `${counts.count} people in ${Math.round(block.w)} × ${Math.round(block.h)} are drawn ${Math.round(slots.h)} units tall (under ${POPULATION_MIN_HEIGHT}, too small to read) — ` +
        `show at most ${fits}, or give it about ${Math.round(box.w * grow)} × ${Math.round(box.h * grow)}`,
    );
  }
  const owner = assignStates(slots.centres, counts.states, el);
  // The whole crowd sketches in DRAW_SECONDS (or draw.duration), however many people.
  const perPersonLeaves = 4;
  const total = (typeof el.draw?.duration === "number" ? el.draw.duration : DRAW_SECONDS) * 1000;
  const ms = el.draw?.mode === "instant" ? 0 : Math.max(2, total / (counts.count * perPersonLeaves));
  const children: Drawable[][] = counts.states.map(() => []);
  const members: Pt[][] = counts.states.map(() => []);
  slots.centres.forEach((c, k) => {
    const si = owner[k];
    children[si].push(...personDrawables(`${el.id}__p${k + 1}`, c, slots.heights[k], looks[si], ms));
    members[si].push(c);
  });
  const drawables: GroupDrawable[] = [];
  const ids: string[] = [];
  const anchors: Record<string, Pt> = {};
  const boxes: Record<string, BBox> = {};
  const mid: Pt = [block.x + block.w / 2, block.y + block.h / 2];
  counts.states.forEach((s, si) => {
    const id = `${el.id}_${s.name}`;
    drawables.push(group(id, children[si]));
    ids.push(id);
    const m = members[si];
    anchors[id] = m.length > 0 ? [m.reduce((a, p) => a + p[0], 0) / m.length, m.reduce((a, p) => a + p[1], 0) / m.length] : mid;
    if (m.length > 0) {
      const hw = slots.h * 0.3, hh = slots.h * 0.5;
      const x0 = Math.min(...m.map((p) => p[0])) - hw, x1 = Math.max(...m.map((p) => p[0])) + hw;
      const y0 = Math.min(...m.map((p) => p[1])) - hh, y1 = Math.max(...m.map((p) => p[1])) + hh;
      boxes[id] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  });

  if (legendOn) {
    const kids: Drawable[] = [];
    const lms = el.draw?.mode === "instant" ? 0 : 60;
    legendRows.forEach((row, r) => {
      const rowW = row.reduce((a, i) => a + entryW[i], 0) + gapX * (row.length - 1);
      let x = box.x + (box.w - rowW) / 2;
      const y = box.y + legendH - 12 - LEGEND_ROW * (r + 0.5);
      for (const i of row) {
        const s = counts.states[i];
        kids.push(...personDrawables(`${el.id}_legend__i${i}`, [x + LEGEND_ICON * 0.35, y], LEGEND_ICON, looks[i], lms));
        kids.push({
          id: `${el.id}_legend__t${i}`,
          kind: "text",
          pos: [x + LEGEND_ICON * 0.7 + 8, y - 1],
          text: `${s.n} ${labelOf(s.name)}`,
          fontSize: LEGEND_FONT,
          anchor: "start",
          z: Z_TEXT,
          style: defaultStyle({ color: INK }),
          drawOpts: { mode: lms === 0 ? "instant" : "sketch", duration: lms === 0 ? 0 : 300 },
        });
        x += entryW[i] + gapX;
      }
    });
    const id = `${el.id}_legend`;
    drawables.push(group(id, kids, Z_TEXT));
    ids.push(id);
    anchors[id] = [box.x + box.w / 2, box.y + legendH / 2];
    const widest = Math.max(...legendRows.map((row) => row.reduce((a, i) => a + entryW[i], 0) + gapX * (row.length - 1)));
    boxes[id] = { x: box.x + (box.w - widest) / 2, y: box.y, w: widest, h: legendH - 12 };
  }

  // The element's own box: the people as drawn, and the legend.
  const xs = slots.centres.map((c, k) => [c[0] - slots.heights[k] * 0.3, c[0] + slots.heights[k] * 0.3]).flat();
  const ys = slots.centres.map((c, k) => [c[1] - slots.heights[k] * 0.5, c[1] + slots.heights[k] * 0.47]).flat();
  const people: BBox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const bottom = legendOn ? box.y : people.y;
  const whole: BBox = { x: Math.min(people.x, legendOn ? box.x : people.x), y: bottom, w: 0, h: 0 };
  whole.w = Math.max(people.x + people.w, legendOn ? box.x + box.w : 0) - whole.x;
  whole.h = people.y + people.h - bottom;

  return { drawables, ids, anchors, boxes, block: people, box: whole, personHeight: slots.h, values: populationValues(el), issues };
}
