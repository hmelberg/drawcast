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
// {dist: "fixed" | "exponential" | "uniform" | "triangular" | "lognormal",
// value | mean | min, mode, max | mean, sd}.

export type DistSpec =
  | number
  | {
      dist?: "exponential" | "fixed" | "uniform" | "triangular" | "lognormal";
      mean?: number;
      sd?: number;
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

export interface Dist {
  kind: "exponential" | "fixed" | "uniform" | "triangular" | "lognormal";
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

export interface ModelNode {
  index: number;
  id: string;
  kind: NodeSpec["type"];
  label: string;
  // source
  inter?: Dist;
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
    if (n.type === "source") {
      if (pos(n.rate)) inter = readDist(1 / n.rate) ?? undefined;
      else if (pos(n.every)) inter = readDist({ dist: "fixed", value: n.every }) ?? undefined;
      else if (n.interarrival !== undefined) inter = readDist(n.interarrival) ?? undefined;
      if (inter && !(inter.mean > 0)) inter = undefined;
    }
    const times = n.type === "source" && Array.isArray(n.times) ? n.times.filter((x) => num(x) && x >= 0).sort((a, b) => a - b) : undefined;
    const service = n.type === "station" ? (readDist(n.service ?? 1) ?? undefined) : n.type === "delay" ? (readDist(n.time ?? n.service ?? 1) ?? undefined) : undefined;
    return {
      index: i,
      id: n.id,
      kind: n.type,
      label: typeof n.label === "string" && n.label.trim() ? n.label.trim() : defaultLabel(n, entity, specs.filter((x) => x.type === n.type).length > 1),
      ...(inter ? { inter } : {}),
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
  const means = nodes.flatMap((n) => [n.inter?.mean, n.kind === "station" ? n.service?.mean : undefined]).filter((v): v is number => pos(v));
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
