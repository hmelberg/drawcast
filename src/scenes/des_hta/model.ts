// des_hta's model: the params an author writes (small on purpose — an LLM
// authors them) and their reading into a resolved model the engine runs.
//
//   states      [{name, utility, cost}] — the first is where every patient
//               starts; the death state is the one background mortality goes
//               to, else the state named like "Dead", else the last state
//               with no way out
//   events      [{from, to, dist, …}] — a transition out of `from` after a
//               sampled time; `to` equal to `from` is a RECURRENT event (an
//               adverse event: the patient stays, pays its one-off cost and
//               QALY loss, and the next one is sampled from then)
//   strategies  [comparator, intervention] — a hazard ratio on events, a
//               treatment cost a year, optionally stopped on entering a state
//
// A time-to-event distribution is its cumulative hazard H and the inverse:
// a time is drawn by inverse CDF, H(t) = −ln U (competing risks: every event
// out of the state draws its time; the earliest happens). A hazard ratio
// multiplies the hazard, so it divides −ln U before the inversion — with the
// SAME U under both strategies (common random numbers, engine.ts).
export type DistName = "exponential" | "weibull" | "gompertz" | "piecewise";

export interface HtaState {
  name: string;
  /** QALY weight of a year in the state (default 0). */
  utility?: number;
  /** Cost of a year in the state (default 0). */
  cost?: number;
}

export interface HtaEvent {
  from: string;
  /** Equal to `from`: a recurrent event that leaves the patient where they are. */
  to: string;
  /** Short name ("progression"): the event's id slug, and the key a strategy's `hr` map uses. */
  name?: string;
  /** Default "exponential". */
  dist?: DistName;
  /** exponential: events per year; gompertz: the hazard at the clock's 0. */
  rate?: number;
  /** exponential / weibull: the median time in years (instead of rate / scale). */
  median?: number;
  /** weibull: shape k (> 1 rising hazard, < 1 falling); gompertz: the hazard's growth per year. */
  shape?: number;
  /** weibull: scale in years (instead of median). */
  scale?: number;
  /** piecewise: the rate in each period (one more than `times`). */
  rates?: number[];
  /** piecewise: the years the rate changes at, rising. */
  times?: number[];
  /** "state" (default): time since entering `from` — the memory a Markov model lacks; "model": time since the start. */
  clock?: "state" | "model";
  /** One-off cost each time it happens. */
  cost?: number;
  /** One-off QALY loss each time it happens. */
  qaly_loss?: number;
}

export interface HtaStrategy {
  name: string;
  /** A hazard ratio on every state-changing event, or {eventName: hr}. */
  hr?: number | Record<string, number>;
  /** Treatment cost a year while on treatment. */
  cost?: number;
  /** Treatment (its cost and its hazard ratio) stops on entering this state. */
  until?: string;
}

export interface HtaParams {
  states: HtaState[];
  events: HtaEvent[];
  strategies: HtaStrategy[];
  /** Age at the start (default 60). */
  age?: number;
  /** Background mortality by age (Gompertz), to the death state: true, or {b, g}. */
  background?: boolean | { b?: number; g?: number };
  /** One binary risk factor: a share of patients has it, and it scales these events' hazards. */
  risk?: { share: number; hr: number; events?: string[]; label?: string };
  patients?: number;
  horizon?: number;
  discount?: number | { costs?: number; qalys?: number };
  currency?: string;
  seed?: number;
  /** false: independent random numbers for each strategy (to show why common ones matter). */
  crn?: boolean;
  /** The time cursor, years. */
  t?: number;
  view?: View;
  /** Patients drawn as timelines (default 12). */
  show?: number;
  /** Willingness to pay per QALY, drawn on the CE plane. */
  wtp?: number;
  title?: string;
}

export type View = "timelines" | "curves" | "results" | "diagram" | "overview";
export const VIEWS: View[] = ["timelines", "curves", "results", "diagram", "overview"];

export const MAX_PATIENTS = 5000;
export const DEFAULT_PATIENTS = 1000;
export const MAX_STATES = 5;
export const MAX_EVENTS = 8;
export const MAX_SHOW = 16;
/** Background mortality: h(age) = b·e^(g·age) — roughly a high-income country's all-cause mortality (illustrative). */
export const GOMPERTZ_B = 4e-5;
export const GOMPERTZ_G = 0.09;

/** A time-to-event law as its cumulative hazard and the inverse. */
export interface Law {
  /** Cumulative hazard at clock time t (≥ 0). */
  H(t: number): number;
  /** The clock time where H reaches h; Infinity when it never does. */
  Hinv(h: number): number;
  /** The hazard at t (for drawing). */
  h(t: number): number;
}

export interface ResolvedEvent {
  index: number;
  from: number;
  to: number;
  name: string;
  slug: string;
  recurrent: boolean;
  law: Law;
  clock: "state" | "model";
  cost: number;
  qalyLoss: number;
  dist: DistName;
  /** The event as written (with defaults filled). */
  spec: HtaEvent;
}

export interface ResolvedStrategy {
  name: string;
  /** Per event index: the hazard ratio while on treatment. */
  hr: number[];
  cost: number;
  /** State index treatment stops at; -1 never. */
  until: number;
}

export interface Model {
  states: { name: string; slug: string; utility: number; cost: number }[];
  events: ResolvedEvent[];
  /** Events out of each state, by state index. */
  out: number[][];
  dead: number;
  strategies: [ResolvedStrategy, ResolvedStrategy];
  age: number;
  background: { b: number; g: number } | null;
  risk: { share: number; hr: number; on: boolean[] } | null;
  patients: number;
  horizon: number;
  rCost: number;
  rQaly: number;
  seed: number;
  crn: boolean;
}

export function slugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;

export function exponential(rate: number): Law {
  return { H: (t) => rate * t, Hinv: (h) => (rate > 0 ? h / rate : Infinity), h: () => rate };
}

export function weibull(shape: number, scale: number): Law {
  return {
    H: (t) => (t <= 0 ? 0 : (t / scale) ** shape),
    Hinv: (h) => scale * h ** (1 / shape),
    h: (t) => (t <= 0 ? (shape < 1 ? Infinity : shape === 1 ? 1 / scale : 0) : (shape / scale) * (t / scale) ** (shape - 1)),
  };
}

export function gompertz(rate: number, shape: number): Law {
  if (Math.abs(shape) < 1e-12) return exponential(rate);
  return {
    H: (t) => (rate / shape) * Math.expm1(shape * t),
    // A falling hazard (shape < 0) reaches at most −rate/shape: past that, never.
    Hinv: (h) => {
      const x = 1 + (h * shape) / rate;
      return x > 0 ? Math.log(x) / shape : Infinity;
    },
    h: (t) => rate * Math.exp(shape * t),
  };
}

export function piecewise(rates: number[], times: number[]): Law {
  const cum: number[] = [0];
  for (let k = 0; k < times.length; k++) cum.push(cum[k] + rates[k] * (times[k] - (k ? times[k - 1] : 0)));
  const piece = (t: number): number => {
    let k = 0;
    while (k < times.length && t >= times[k]) k++;
    return k;
  };
  return {
    H: (t) => {
      const k = piece(t);
      return cum[k] + rates[k] * (t - (k ? times[k - 1] : 0));
    },
    Hinv: (h) => {
      let k = 0;
      while (k < times.length && cum[k + 1] < h) k++;
      const r = rates[k];
      if (!(r > 0)) {
        // A zero rate: wait for the next period that has one.
        for (let j = k + 1; j < rates.length; j++) if (rates[j] > 0 && cum[j] >= h - 1e-15) return times[j - 1] + (h - cum[j]) / rates[j];
        return Infinity;
      }
      return (k ? times[k - 1] : 0) + (h - cum[k]) / r;
    },
    h: (t) => rates[piece(t)],
  };
}

/** Weibull's scale from its median. */
export const weibullScale = (median: number, shape: number): number => median / Math.log(2) ** (1 / shape);

/** The law an event describes, or an error message. */
export function lawOf(e: HtaEvent): Law | string {
  const dist = e.dist ?? "exponential";
  if (dist === "exponential") {
    if (pos(e.rate)) return exponential(e.rate);
    if (pos(e.median)) return exponential(Math.LN2 / e.median);
    return "exponential needs rate (per year) or median (years) > 0";
  }
  if (dist === "weibull") {
    if (!pos(e.shape)) return "weibull needs shape > 0";
    if (pos(e.scale)) return weibull(e.shape, e.scale);
    if (pos(e.median)) return weibull(e.shape, weibullScale(e.median, e.shape));
    return "weibull needs scale or median (years) > 0";
  }
  if (dist === "gompertz") {
    if (!pos(e.rate)) return "gompertz needs rate (the hazard at 0) > 0";
    if (!num(e.shape)) return "gompertz needs shape (the hazard's growth per year)";
    return gompertz(e.rate, e.shape);
  }
  if (dist === "piecewise") {
    const r = e.rates, t = e.times ?? [];
    if (!Array.isArray(r) || r.length === 0 || !r.every((v) => num(v) && v >= 0)) return "piecewise needs rates: numbers ≥ 0, one per period";
    if (!Array.isArray(t) || t.length !== r.length - 1) return `piecewise needs ${r.length - 1} times (one fewer than rates)`;
    if (!t.every((v, i) => pos(v) && (i === 0 || v > t[i - 1]))) return "piecewise times must be > 0 and rising";
    if (!r.some((v) => v > 0)) return "piecewise needs at least one rate > 0";
    return piecewise(r, t);
  }
  return `unknown dist "${String(dist)}" (exponential, weibull, gompertz, piecewise)`;
}

/** Discount rates for costs and QALYs. */
export function discountOf(P: HtaParams): { costs: number; qalys: number } {
  const d = P.discount;
  if (num(d)) return { costs: d, qalys: d };
  if (d && typeof d === "object") return { costs: num(d.costs) ? d.costs : 0.035, qalys: num(d.qalys) ? d.qalys : 0.035 };
  return { costs: 0.035, qalys: 0.035 };
}

/** The death state's index, or -1. */
export function deadIndex(P: HtaParams): number {
  const names = (P.states ?? []).map((s) => s?.name);
  const exits = new Set((P.events ?? []).filter((e) => e && e.from !== e.to).map((e) => e.from));
  const byName = names.findIndex((n) => typeof n === "string" && /\b(dead|death|died|død|dod)\b/i.test(n));
  if (byName >= 0) return byName;
  for (let i = names.length - 1; i >= 0; i--) if (!exits.has(names[i])) return i;
  return -1;
}

export const eventName = (e: HtaEvent): string => (typeof e.name === "string" && e.name.trim() ? e.name.trim() : `${e.from} → ${e.to}`);

/** The params read into a model the engine runs; null when they cannot be (the lint says why). */
export function readModel(P: HtaParams): Model | null {
  if (!P || !Array.isArray(P.states) || !Array.isArray(P.events) || P.states.length < 2) return null;
  const states = P.states.slice(0, MAX_STATES).map((s) => ({
    name: String(s?.name ?? ""),
    slug: slugify(String(s?.name ?? "")),
    utility: num(s?.utility) ? s.utility : 0,
    cost: num(s?.cost) ? s.cost : 0,
  }));
  const idx = (n: string): number => states.findIndex((s) => s.name === n);
  const events: ResolvedEvent[] = [];
  P.events.slice(0, MAX_EVENTS).forEach((e, i) => {
    if (!e) return;
    const from = idx(e.from), to = idx(e.to);
    const law = lawOf(e);
    if (from < 0 || to < 0 || typeof law === "string") return;
    const name = eventName(e);
    events.push({
      index: i,
      from,
      to,
      name,
      slug: slugify(name),
      recurrent: from === to,
      law,
      clock: e.clock === "model" ? "model" : "state",
      cost: num(e.cost) ? e.cost : 0,
      qalyLoss: num(e.qaly_loss) ? e.qaly_loss : 0,
      dist: e.dist ?? "exponential",
      spec: e,
    });
  });
  if (events.length === 0) return null;
  const dead = deadIndex({ ...P, states: P.states.slice(0, MAX_STATES) });
  // Nothing leaves the dead state.
  const live = events.filter((e) => e.from !== dead);
  const out = states.map((_, s) => live.filter((e) => e.from === s).map((e) => events.indexOf(e)));
  const strat = (S: HtaStrategy | undefined, fallback: string): ResolvedStrategy => {
    const hr = events.map((e) => {
      const h = S?.hr;
      if (num(h)) return e.recurrent ? 1 : h;
      if (h && typeof h === "object") {
        const v = (h as Record<string, number>)[e.name] ?? (h as Record<string, number>)[e.slug];
        return num(v) && v >= 0 ? v : 1;
      }
      return 1;
    });
    return { name: typeof S?.name === "string" && S.name ? S.name : fallback, hr, cost: num(S?.cost) ? S!.cost : 0, until: typeof S?.until === "string" ? idx(S.until) : -1 };
  };
  const strategies: [ResolvedStrategy, ResolvedStrategy] = [strat(P.strategies?.[0], "Comparator"), strat(P.strategies?.[1], "Intervention")];
  const bg = P.background;
  const background = bg && dead >= 0 ? { b: typeof bg === "object" && pos(bg.b) ? bg.b : GOMPERTZ_B, g: typeof bg === "object" && num(bg.g) ? bg.g : GOMPERTZ_G } : null;
  const R = P.risk;
  const risk =
    R && num(R.share) && num(R.hr) && R.share > 0
      ? { share: Math.min(1, R.share), hr: Math.max(0, R.hr), on: events.map((e) => (Array.isArray(R.events) && R.events.length ? R.events.includes(e.name) || R.events.includes(e.slug) : !e.recurrent)) }
      : null;
  const d = discountOf(P);
  return {
    states,
    events,
    out,
    dead,
    strategies,
    age: num(P.age) ? P.age : 60,
    background,
    risk,
    patients: Math.max(1, Math.min(MAX_PATIENTS, Math.round(num(P.patients) ? P.patients : DEFAULT_PATIENTS))),
    horizon: pos(P.horizon) ? Math.min(100, P.horizon) : 20,
    rCost: Math.max(0, d.costs),
    rQaly: Math.max(0, d.qalys),
    seed: num(P.seed) ? Math.round(P.seed) : 1,
    crn: P.crn !== false,
  };
}

/** The median of a law: where H reaches ln 2 (Infinity when it never does). */
export function medianOf(law: Law): number {
  return law.Hinv(Math.LN2);
}
