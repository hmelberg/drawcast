// des_process' params and what they mean: a process or queueing network —
// sources that make entities, stations where they queue for c servers,
// delays (no queue), probabilistic routes between them, and sinks — read
// into one normalised Model the engine simulates. Pure; no drawing here.
//
// The schema is small on purpose (an LLM writes it):
//
//   nodes: [
//     {id: "door",   type: "source",  rate: 0.8},          // per time unit, Poisson
//     {id: "triage", type: "station", servers: 1, service: 1},   // a number = exponential mean
//     {id: "exit",   type: "sink"}
//   ]
//
// `to` on a node names where its entities go next: an id, or {id: share}
// for a branch ({"xray": 0.3, "exit": 0.7}). Left out, it is the next node
// in the list. A distribution is a number (exponential, that mean) or
// {dist: "fixed" | "exponential" | "uniform" | "triangular" | "lognormal" |
// "gamma", value | mean | min, mode, max | mean, sd | mean, cv}.
//
// Burstiness, for the explanation that needs it (all three optional; left
// out, a spec runs exactly as before):
//
//   variability: 1.5            // source: the gaps' coefficient of variation
//                               // (0 regular, 1 Poisson, >1 clumped), the mean
//                               // kept — a gamma renewal process; station or
//                               // delay: the same for its service times
//   schedule: {times: [0, 120], rates: [0.1, 0.3]}   // source: the rate over
//                               // the run, each from its time on ("smooth"
//                               // joins them); gaps drawn in operational time
//                               // (the cumulative rate) and mapped back, so it
//                               // composes with variability
//   batch: 3 | {mean: 2}        // source: groups arriving together — a fixed
//                               // size, or geometric sizes with that mean;
//                               // `rate` (and a schedule) still count entities

export type DistSpec =
  | number
  | {
      dist?: "exponential" | "fixed" | "uniform" | "triangular" | "lognormal" | "gamma";
      mean?: number;
      sd?: number;
      /** gamma: the coefficient of variation (sd / mean). */
      cv?: number;
      value?: number;
      min?: number;
      max?: number;
      mode?: number;
    };

export interface NodeSpec {
  id: string;
  type: "source" | "station" | "delay" | "sink";
  label?: string;
  /** source: arrivals per time unit (exponential gaps). */
  rate?: number;
  /** source: a fixed gap between arrivals. */
  every?: number;
  /** source: the gap between arrivals as any distribution. */
  interarrival?: DistSpec;
  /** source: arrivals at exactly these times. */
  times?: number[];
  /** source: the gaps' coefficient of variation, the mean kept (0 regular, 1 Poisson, >1 bursty); station / delay: its times'. */
  variability?: number;
  /** source: the arrival rate over the run — each rate holds from its time on (shape "smooth": joined by straight lines). */
  schedule?: { times: number[]; rates: number[]; shape?: "step" | "smooth" };
  /** source: entities arriving together — a fixed group size, or {mean} for geometric sizes. */
  batch?: number | { mean: number };
  /** source: the priority class its entities carry (1 = most urgent). */
  priority?: number;
  /** station: how many servers (default 1). */
  servers?: number;
  /** station: the service time; delay: use `time`. */
  service?: DistSpec;
  /** delay: how long an entity stays. */
  time?: DistSpec;
  /** station: the most that may wait; an arrival finding it full leaves (balks). */
  capacity?: number;
  /** station: "fifo" (default) or "priority" (lowest class first, FIFO within). */
  discipline?: "fifo" | "priority";
  /** Where entities go next: an id, or {id: share}. Default: the next node. */
  to?: string | Record<string, number>;
}

export type ChartKind = "queue" | "wait" | "system" | "wait_util";
export interface ChartSpec {
  of: ChartKind;
  /** The station it reads (default the first station). */
  station?: string;
  /** Hold the y axis's top (the figure otherwise fits the run). */
  y_max?: number;
}

export interface DesParams {
  nodes?: NodeSpec[];
  /** What flows: "patient", "customer", "car" (default "customer"). */
  entity?: string;
  /** The time unit's word, "min" (default), "h", "s", "days". */
  time_unit?: string;
  /** How long the run lasts (default 120). */
  horizon?: number;
  /** Statistics ignore [0, warmup) (default 0). */
  warmup?: number;
  /** The random stream (default 1): the same seed is the same run. */
  seed?: number;
  /** The time shown (default: the horizon). ANIMATES. */
  t?: number;
  /** The time-series or wait-vs-utilisation chart(s): a kind, a spec, up to two, or false. */
  chart?: ChartKind | ChartSpec | (ChartKind | ChartSpec)[] | false;
  /** Per-station readout under each station (default true). */
  readouts?: boolean;
  /** The ⊖ ⊕ server buttons and "new run" (default true). */
  controls?: boolean;
  /** How long (time units) a token takes to move along an arrow on screen. Default horizon / 100. */
  transit?: number;
  title?: string;
}

export const MAX_NODES = 12;
export const MAX_SERVERS = 12;
/** The run stops making entities past this many (lint warns). */
export const MAX_ENTITIES = 3000;
export const DEFAULT_HORIZON = 120;

/** The most `variability` (a coefficient of variation) the model takes. */
export const MAX_VARIABILITY = 4;
/** The largest group a `batch` makes. */
export const MAX_BATCH = 20;

export interface Dist {
  kind: "exponential" | "fixed" | "uniform" | "triangular" | "lognormal" | "gamma";
  mean: number;
  /** Squared coefficient of variation, Var / mean². */
  cv2: number;
  /** Inverse CDF: u ∈ [0, 1) → a sample. */
  inv(u: number): number;
  /** The numbers the spec gave, so a scrub can scale them all. */
  spec: DistSpec;
}

export interface Route {
  to: number;
  p: number;
}

/** A source's arrival rate over time: rate(t) and its integral Λ(t), and Λ's inverse. */
export interface Schedule {
  times: number[];
  rates: number[];
  smooth: boolean;
  /** The rate at time t. */
  rate(t: number): number;
  /** Λ(t) = ∫₀ᵗ rate. */
  cum(t: number): number;
  /** The t with Λ(t) = s (the first such); Infinity when the rate never gets there. */
  inv(s: number): number;
}

export interface Batch {
  /** A fixed size, else geometric sizes (1, 2, … with P(k) = p(1−p)^(k−1)). */
  fixed: boolean;
  mean: number;
}

export interface ModelNode {
  index: number;
  id: string;
  kind: NodeSpec["type"];
  label: string;
  // source
  /** The gap between arrivals (between groups, with a batch) — in operational time with a schedule. */
  inter?: Dist;
  /** What the spec gave the arrivals as: the text under the source follows it. */
  gapFrom?: "rate" | "every" | "interarrival" | "schedule";
  schedule?: Schedule;
  batch?: Batch;
  /** The `variability` the spec set (its readout is drawn only then). */
  variability?: number;
  times?: number[];
  priority: number;
  // station / delay
  servers: number;
  service?: Dist;
  capacity: number;
  discipline: "fifo" | "priority";
  routes: Route[];
}

export interface Model {
  nodes: ModelNode[];
  byId: Map<string, number>;
  horizon: number;
  warmup: number;
  seed: number;
  transit: number;
  entity: string;
  unit: string;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;

// Acklam's rational approximation to the standard normal's inverse CDF
// (relative error < 1.2e-9) — the lognormal's sampler.
const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
export function normInv(p: number): number {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((C[0] * r + C[1]) * r + C[2]) * r + C[3]) * r + C[4]) * r + C[5]) / ((((D[0] * r + D[1]) * r + D[2]) * r + D[3]) * r + 1);
  }
  if (q > 1 - 0.02425) {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((C[0] * r + C[1]) * r + C[2]) * r + C[3]) * r + C[4]) * r + C[5]) / ((((D[0] * r + D[1]) * r + D[2]) * r + D[3]) * r + 1);
  }
  const s = q - 0.5;
  const r = s * s;
  return ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * s) / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

// ---- the gamma distribution: the burstiness knob ---------------------------------------

/** ln Γ(x), x > 0 (Lanczos, g = 7, n = 9; ~15 digits). */
export function lnGamma(x: number): number {
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = g[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += g[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularised lower incomplete gamma P(a, x): the gamma(a, 1) CDF at x. */
export function gammaP(a: number, x: number): number {
  if (!(x > 0)) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    // The series.
    let ap = a,
      del = 1 / a,
      sum = del;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - gln));
  }
  // The continued fraction for Q = 1 − P (modified Lentz).
  const tiny = 1e-300;
  let b = x + 1 - a,
    c = 1 / tiny,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - gln) * h);
}

/** The gamma(a, 1) inverse CDF: the x with P(a, x) = p (Halley's method from a close first guess). */
export function gammaInv(a: number, p: number): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return Infinity;
  const gln = lnGamma(a);
  const a1 = a - 1;
  const lna1 = a > 1 ? Math.log(a1) : 0;
  const afac = a > 1 ? Math.exp(a1 * (lna1 - 1) - gln) : 0;
  let x: number;
  if (a > 1) {
    const pp = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(pp));
    let z = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) z = -z;
    x = Math.max(1e-3, a * Math.pow(1 - 1 / (9 * a) - z / (3 * Math.sqrt(a)), 3));
  } else {
    const t = 1 - a * (0.253 + a * 0.12);
    x = p < t ? Math.pow(p / t, 1 / a) : 1 - Math.log(1 - (p - t) / (1 - t));
  }
  for (let j = 0; j < 100; j++) {
    if (x <= 0) return 0;
    const err = gammaP(a, x) - p;
    const t = a > 1 ? afac * Math.exp(-(x - a1) + a1 * (Math.log(x) - lna1)) : Math.exp(-x + a1 * Math.log(x) - gln);
    if (!(t > 0) || !Number.isFinite(t)) break;
    const u = err / t;
    const step = u / (1 - 0.5 * Math.min(1, u * (a1 / x - 1)));
    x -= step;
    if (x <= 0) x = 0.5 * (x + step);
    if (Math.abs(step) < 1e-11 * x) break;
  }
  return x;
}

/**
 * A gamma distribution by its mean and coefficient of variation; cv 0 is
 * fixed, cv 1 exponential (the very draws `mean` alone makes). Sampled by
 * its inverse CDF like every other distribution here, so one uniform is
 * one gap at every cv: a run animated from regular to bursty keeps its
 * random numbers and changes only their spread (common random numbers).
 */
export function gammaDist(mean: number, cv: number, spec: DistSpec = { dist: "gamma", mean, cv }): Dist {
  const c = Math.max(0, Math.min(MAX_VARIABILITY, cv));
  if (c === 0) return { kind: "fixed", mean, cv2: 0, inv: () => mean, spec };
  if (c === 1) return { kind: "exponential", mean, cv2: 1, inv: (u) => -mean * Math.log(1 - u), spec };
  const k = 1 / (c * c);
  const theta = mean * c * c;
  return { kind: "gamma", mean, cv2: c * c, inv: (u) => theta * gammaInv(k, u), spec };
}

/** A distribution spec read, or null when it says nothing usable. */
export function readDist(s: DistSpec | undefined): Dist | null {
  if (num(s)) {
    if (!(s > 0)) return s === 0 ? { kind: "fixed", mean: 0, cv2: 0, inv: () => 0, spec: s } : null;
    return { kind: "exponential", mean: s, cv2: 1, inv: (u) => -s * Math.log(1 - u), spec: s };
  }
  if (!s || typeof s !== "object") return null;
  const kind = s.dist ?? (num(s.value) ? "fixed" : num(s.sd) ? "lognormal" : num(s.mode) ? "triangular" : num(s.min) && num(s.max) ? "uniform" : "exponential");
  if (kind === "fixed") {
    const v = num(s.value) ? s.value : num(s.mean) ? s.mean : NaN;
    if (!(v >= 0)) return null;
    return { kind, mean: v, cv2: 0, inv: () => v, spec: s };
  }
  if (kind === "exponential") {
    if (!pos(s.mean)) return null;
    const m = s.mean;
    return { kind, mean: m, cv2: 1, inv: (u) => -m * Math.log(1 - u), spec: s };
  }
  if (kind === "uniform") {
    if (!num(s.min) || !num(s.max) || s.min < 0 || s.max < s.min) return null;
    const a = s.min,
      b = s.max;
    const m = (a + b) / 2;
    return { kind, mean: m, cv2: m > 0 ? (b - a) ** 2 / 12 / (m * m) : 0, inv: (u) => a + u * (b - a), spec: s };
  }
  if (kind === "triangular") {
    if (!num(s.min) || !num(s.max) || !num(s.mode) || s.min < 0 || !(s.min <= s.mode && s.mode <= s.max) || !(s.max > s.min)) return null;
    const a = s.min,
      b = s.max,
      c = s.mode;
    const m = (a + b + c) / 3;
    const v = (a * a + b * b + c * c - a * b - a * c - b * c) / 18;
    const fc = (c - a) / (b - a);
    return {
      kind,
      mean: m,
      cv2: v / (m * m),
      inv: (u) => (u < fc ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c))),
      spec: s,
    };
  }
  if (kind === "lognormal") {
    if (!pos(s.mean) || !num(s.sd) || s.sd < 0) return null;
    const m = s.mean,
      sd = s.sd;
    const s2 = Math.log(1 + (sd * sd) / (m * m));
    const mu = Math.log(m) - s2 / 2;
    const sg = Math.sqrt(s2);
    return { kind, mean: m, cv2: (sd * sd) / (m * m), inv: (u) => Math.exp(mu + sg * normInv(u)), spec: s };
  }
  if (kind === "gamma") {
    if (!pos(s.mean) || !num(s.cv) || s.cv < 0) return null;
    return gammaDist(s.mean, s.cv, s);
  }
  return null;
}

/** A distribution spec with every number scaled by k — its shape (cv) kept, its mean times k. */
export function scaleDist(s: DistSpec | undefined, k: number, places = 3): DistSpec | undefined {
  const r = (v: number): number => Number((v * k).toFixed(places));
  if (num(s)) return r(s);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = { ...s };
  for (const key of ["mean", "sd", "value", "min", "max", "mode"] as const) if (num(s[key])) out[key] = r(s[key]!);
  return out as DistSpec;
}

/** A node's `variability`, read (clamped to 0–MAX_VARIABILITY), or undefined. */
export function readVariability(v: unknown): number | undefined {
  return num(v) && v >= 0 ? Math.min(MAX_VARIABILITY, v) : undefined;
}

/** A distribution with its coefficient of variation set to cv, its mean kept. */
export function withVariability(d: Dist, cv: number): Dist {
  return gammaDist(d.mean, cv);
}

/** A source's `schedule`, read: times ascending, rates ≥ 0; null when unusable. */
export function readSchedule(s: NodeSpec["schedule"]): Schedule | null {
  if (!s || typeof s !== "object" || !Array.isArray(s.times) || !Array.isArray(s.rates)) return null;
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(s.times.length, s.rates.length); i++) if (num(s.times[i]) && s.times[i] >= 0 && num(s.rates[i]) && s.rates[i] >= 0) pairs.push([s.times[i], s.rates[i]]);
  if (pairs.length === 0 || !pairs.some(([, r]) => r > 0)) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  // The knots from 0: the first rate holds before the first time.
  const T = pairs.map((p) => p[0]);
  const R = pairs.map((p) => p[1]);
  if (T[0] > 0) {
    T.unshift(0);
    R.unshift(R[0]);
  }
  const smooth = s.shape === "smooth";
  const C = [0];
  for (let i = 1; i < T.length; i++) C.push(C[i - 1] + (T[i] - T[i - 1]) * (smooth ? (R[i - 1] + R[i]) / 2 : R[i - 1]));
  const seg = (t: number): number => {
    let i = 0;
    while (i + 1 < T.length && T[i + 1] <= t) i++;
    return i;
  };
  const rate = (t: number): number => {
    const i = seg(Math.max(0, t));
    if (!smooth || i + 1 >= T.length) return R[i];
    return R[i] + ((R[i + 1] - R[i]) * (t - T[i])) / (T[i + 1] - T[i]);
  };
  const cum = (t: number): number => {
    const x = Math.max(0, t);
    const i = seg(x);
    const end = smooth ? rate(x) : R[i];
    return C[i] + ((x - T[i]) * (R[i] + end)) / 2;
  };
  const inv = (target: number): number => {
    if (!(target > 0)) return 0;
    let i = 0;
    while (i + 1 < T.length && C[i + 1] < target) i++;
    const d = target - C[i];
    if (i + 1 >= T.length || !smooth) return R[i] > 0 ? T[i] + d / R[i] : Infinity;
    // rate(τ) = R[i] + gτ, so R[i]τ + gτ²/2 = d — solved in the form that keeps its digits.
    const g = (R[i + 1] - R[i]) / (T[i + 1] - T[i]);
    const den = R[i] + Math.sqrt(Math.max(0, R[i] * R[i] + 2 * g * d));
    return den > 0 ? T[i] + (2 * d) / den : T[i];
  };
  return { times: T, rates: R, smooth, rate, cum, inv };
}

/** A source's `batch`, read; undefined for single arrivals. */
export function readBatch(b: NodeSpec["batch"]): Batch | undefined {
  if (num(b)) {
    const k = Math.min(MAX_BATCH, Math.round(b));
    return k > 1 ? { fixed: true, mean: k } : undefined;
  }
  if (b && typeof b === "object" && num(b.mean) && b.mean > 1) return { fixed: false, mean: Math.min(MAX_BATCH, b.mean) };
  return undefined;
}

/** The words for a node type's default label. */
function defaultLabel(n: NodeSpec, entity: string, many = false): string {
  if (n.type === "source") return many ? String(n.id).replace(/_/g, " ") : plural(entity);
  if (n.type === "sink") return many ? String(n.id).replace(/_/g, " ") : "done";
  const id = String(n.id ?? "");
  return id.replace(/_/g, " ");
}

export function plural(w: string): string {
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + "es";
  return w + "s";
}

/** The nodes as the author listed them, those with an id and a known type only. */
export function nodeSpecs(P: DesParams): NodeSpec[] {
  const list = Array.isArray(P.nodes) ? P.nodes : [];
  return list.filter((n) => n && typeof n === "object" && typeof n.id === "string" && n.id.trim() !== "" && ["source", "station", "delay", "sink"].includes(n.type)).slice(0, MAX_NODES);
}

/** The shares a node's `to` gives, as [id, share] — the default is the next node in the list. */
export function routeEntries(specs: NodeSpec[], i: number): [string, number][] {
  const n = specs[i];
  if (n.type === "sink") return [];
  if (typeof n.to === "string") return [[n.to, 1]];
  if (n.to && typeof n.to === "object") return Object.entries(n.to).filter(([, p]) => num(p) && p >= 0);
  const next = specs[i + 1];
  return next ? [[next.id, 1]] : [];
}

export function readModel(P: DesParams): Model {
  const specs = nodeSpecs(P);
  const entity = typeof P.entity === "string" && P.entity.trim() ? P.entity.trim() : "customer";
  const byId = new Map<string, number>();
  specs.forEach((n, i) => {
    if (!byId.has(n.id)) byId.set(n.id, i);
  });
  const horizon = pos(P.horizon) ? P.horizon : DEFAULT_HORIZON;
  const warmup = num(P.warmup) && P.warmup > 0 ? Math.min(P.warmup, horizon * 0.9) : 0;
  const nodes: ModelNode[] = specs.map((n, i) => {
    const routesRaw = routeEntries(specs, i).filter(([id]) => byId.has(id) && byId.get(id) !== i);
    const total = routesRaw.reduce((a, [, p]) => a + p, 0);
    const routes = total > 0 ? routesRaw.map(([id, p]) => ({ to: byId.get(id)!, p: p / total })) : [];
    let inter: Dist | undefined;
    let gapFrom: ModelNode["gapFrom"];
    const variability = n.type === "sink" ? undefined : readVariability(n.variability);
    const schedule = n.type === "source" ? readSchedule(n.schedule) : null;
    const batch = n.type === "source" ? readBatch(n.batch) : undefined;
    if (n.type === "source") {
      // With a batch, `rate` and a schedule still count entities: the groups come 1/mean as often.
      const b = batch?.mean ?? 1;
      if (schedule) [inter, gapFrom] = [readDist(b) ?? undefined, "schedule"];
      else if (pos(n.rate)) [inter, gapFrom] = [readDist(b / n.rate) ?? undefined, "rate"];
      else if (pos(n.every)) [inter, gapFrom] = [readDist({ dist: "fixed", value: n.every }) ?? undefined, "every"];
      else if (n.interarrival !== undefined) [inter, gapFrom] = [readDist(n.interarrival) ?? undefined, "interarrival"];
      if (inter && !(inter.mean > 0)) inter = undefined;
      if (inter && variability !== undefined) inter = withVariability(inter, variability);
    }
    const times = n.type === "source" && Array.isArray(n.times) ? n.times.filter((x) => num(x) && x >= 0).sort((a, b) => a - b) : undefined;
    let service = n.type === "station" ? (readDist(n.service ?? 1) ?? undefined) : n.type === "delay" ? (readDist(n.time ?? n.service ?? 1) ?? undefined) : undefined;
    if (service && variability !== undefined && service.mean > 0) service = withVariability(service, variability);
    return {
      index: i,
      id: n.id,
      kind: n.type,
      label: typeof n.label === "string" && n.label.trim() ? n.label.trim() : defaultLabel(n, entity, specs.filter((x) => x.type === n.type).length > 1),
      ...(inter ? { inter, gapFrom } : {}),
      ...(inter && schedule ? { schedule } : {}),
      ...(inter && batch ? { batch } : {}),
      ...(variability !== undefined && (inter || service) ? { variability } : {}),
      ...(times && times.length > 0 && !inter ? { times } : {}),
      priority: num(n.priority) ? Math.max(1, Math.round(n.priority)) : 1,
      servers: n.type === "station" ? Math.max(1, Math.min(MAX_SERVERS, num(n.servers) ? Math.round(n.servers) : 1)) : n.type === "delay" ? Infinity : 0,
      ...(service ? { service } : {}),
      capacity: n.type === "station" && num(n.capacity) && n.capacity >= 0 ? Math.floor(n.capacity) : Infinity,
      discipline: n.discipline === "priority" ? "priority" : "fifo",
      routes,
    };
  });
  // On screen a token spends its first `transit` at a node on the arrow into
  // it; short against the gaps between events, so the picture's lanes and
  // the readouts' counts rarely disagree by more than a token.
  // (A schedule's gaps are in operational time: its real mean gap is the groups' over the horizon.)
  const gap = (n: ModelNode): number | undefined => (n.schedule ? (n.batch?.mean ?? 1) / (n.schedule.cum(horizon) / horizon) : n.inter?.mean);
  const means = nodes.flatMap((n) => [gap(n), n.kind === "station" ? n.service?.mean : undefined]).filter((v): v is number => pos(v));
  const transit = pos(P.transit) ? P.transit : Math.min(horizon / 120, means.length > 0 ? 0.4 * Math.min(...means) : horizon / 120);
  return {
    nodes,
    byId,
    horizon,
    warmup,
    seed: num(P.seed) ? Math.round(P.seed) : 1,
    transit,
    entity,
    unit: typeof P.time_unit === "string" && P.time_unit.trim() ? P.time_unit.trim() : "min",
  };
}

/** The charts asked for, at most two, each with its station resolved (null: no station to read). */
export function readCharts(P: DesParams, m: Model): { of: ChartKind; station: number | null; y_max?: number }[] {
  if (P.chart === false) return [];
  const raw = P.chart === undefined ? ["queue" as ChartKind] : Array.isArray(P.chart) ? P.chart : [P.chart];
  const first = m.nodes.find((n) => n.kind === "station")?.index ?? null;
  const out: { of: ChartKind; station: number | null; y_max?: number }[] = [];
  for (const c of raw.slice(0, 2)) {
    const spec: ChartSpec = typeof c === "string" ? { of: c } : c && typeof c === "object" ? c : { of: "queue" };
    const of: ChartKind = ["queue", "wait", "system", "wait_util"].includes(spec.of) ? spec.of : "queue";
    const st = typeof spec.station === "string" && m.byId.has(spec.station) && m.nodes[m.byId.get(spec.station)!].kind === "station" ? m.byId.get(spec.station)! : first;
    if (of !== "system" && st === null) continue;
    out.push({ of, station: of === "system" ? null : st, ...(pos(spec.y_max) ? { y_max: spec.y_max } : {}) });
  }
  return out;
}
