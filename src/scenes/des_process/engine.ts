// des_process' engine: a discrete event simulation of the model — an event
// calendar (a binary heap keyed by time, ties in the order they were
// scheduled), seeded PRNG streams (mulberry32, one per node and purpose, so
// a change at one node leaves the others' draws alone), inverse-CDF
// sampling — run ONCE per params into an event log (every entity's visits)
// plus sorted indexes, so that reading the state at any time t is a lookup:
// the layout re-runs on every animate frame of `t` and reads, never re-runs.
//
// Queueing theory beside it: the traffic equations (λ at every node), M/M/c
// by Erlang C, M/G/1 by Pollaczek–Khinchine, Allen–Cunneen otherwise.
import type { Dist, Model, ModelNode } from "./model";
import { MAX_BATCH, MAX_ENTITIES } from "./model";

// ---- random streams ------------------------------------------------------------

/** mulberry32: a 32-bit state, full period 2³², fast and good enough for a picture. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stream's seed from the run's seed, a node and a purpose (splitmix-style hash). */
export function streamSeed(seed: number, node: number, purpose: number): number {
  let h = (seed * 0x9e3779b1 + node * 0x85ebca6b + purpose * 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// ---- the event calendar ------------------------------------------------------------

const ARRIVE_SOURCE = 0;
const ARRIVE_NODE = 1;
const END = 2;

/** A binary min-heap of events in parallel arrays: time, then schedule order. */
export class Calendar {
  private time: number[] = [];
  private seq: number[] = [];
  private kind: number[] = [];
  private node: number[] = [];
  private ent: number[] = [];
  private n = 0;
  private counter = 0;
  get size(): number {
    return this.n;
  }
  private less(i: number, j: number): boolean {
    return this.time[i] < this.time[j] || (this.time[i] === this.time[j] && this.seq[i] < this.seq[j]);
  }
  private swap(i: number, j: number): void {
    for (const a of [this.time, this.seq, this.kind, this.node, this.ent]) {
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }
  push(time: number, kind: number, node: number, ent: number): void {
    let i = this.n++;
    this.time[i] = time;
    this.seq[i] = this.counter++;
    this.kind[i] = kind;
    this.node[i] = node;
    this.ent[i] = ent;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  /** The earliest event, removed: [time, kind, node, entity]. */
  pop(): [number, number, number, number] {
    const out: [number, number, number, number] = [this.time[0], this.kind[0], this.node[0], this.ent[0]];
    const last = --this.n;
    if (last > 0) {
      this.time[0] = this.time[last];
      this.seq[0] = this.seq[last];
      this.kind[0] = this.kind[last];
      this.node[0] = this.node[last];
      this.ent[0] = this.ent[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return out;
  }
  peekTime(): number {
    return this.n > 0 ? this.time[0] : Infinity;
  }
}

// ---- the run --------------------------------------------------------------------------

export interface Visit {
  node: number;
  /** Came to the node. */
  arrive: number;
  /** Service began (a station), = arrive at a delay or sink; Infinity while still waiting at the horizon. */
  start: number;
  /** Left the node; Infinity while still there at the horizon (or at a sink). */
  end: number;
  /** Which server (a station), else -1. */
  server: number;
  /** Came from (−1 for the first visit, from its source). */
  from: number;
  /** Turned away: the queue was full. */
  balked?: true;
}

export interface Entity {
  id: number;
  source: number;
  priority: number;
  born: number;
  /** Left the system (a sink, or balked); Infinity if still in at the horizon. */
  exit: number;
  visits: Visit[];
}

/** A piecewise-constant count over time with its running integral: times ascending, value from each time on. */
export interface StepSeries {
  times: Float64Array;
  values: Float64Array;
  /** ∫₀^{times[i]} value dt. */
  area: Float64Array;
}

export interface StationLog {
  node: number;
  queue: StepSeries;
  busy: StepSeries;
  /** Arrivals' times (balkers included), ascending. */
  arrivals: Float64Array;
  /** Balkers' times, ascending. */
  balks: Float64Array;
  /** Service starts, ascending, of entities that came at or after warmup; and the running sum of their waits. */
  starts: Float64Array;
  waitSum: Float64Array;
  /** Each such entity's wait, in start order. */
  waits: Float64Array;
  /** Service ends (departures), ascending. */
  ends: Float64Array;
}

export interface Run {
  model: Model;
  entities: Entity[];
  stations: Map<number, StationLog>;
  /** Entities in the system over time. */
  system: StepSeries;
  /** Birth and exit times, ascending. */
  births: Float64Array;
  exits: Float64Array;
  /** Of entities born at or after warmup that left: exit times ascending, running sum of their time in system. */
  sojournEnds: Float64Array;
  sojournSum: Float64Array;
  /** Departures per sink, times ascending. */
  sinks: Map<number, Float64Array>;
  /** The run stopped making entities at MAX_ENTITIES. */
  truncated: boolean;
  /** Milliseconds the simulation took. */
  ms: number;
}

function stepSeries(changes: [number, number][]): StepSeries {
  changes.sort((a, b) => a[0] - b[0]);
  const times: number[] = [0];
  const values: number[] = [0];
  let v = 0;
  for (const [t, d] of changes) {
    v += d;
    if (times[times.length - 1] === t) values[values.length - 1] = v;
    else {
      times.push(t);
      values.push(v);
    }
  }
  const area = new Float64Array(times.length);
  for (let i = 1; i < times.length; i++) area[i] = area[i - 1] + values[i - 1] * (times[i] - times[i - 1]);
  return { times: Float64Array.from(times), values: Float64Array.from(values), area };
}

/** Index of the last element ≤ x in an ascending array, −1 if none. */
export function lastAtOrBefore(a: ArrayLike<number>, x: number): number {
  let lo = 0,
    hi = a.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** How many elements of an ascending array are ≤ x. */
export const countUpTo = (a: ArrayLike<number>, x: number): number => lastAtOrBefore(a, x) + 1;

/** The step series' value at t. */
export function valueAt(s: StepSeries, t: number): number {
  const i = lastAtOrBefore(s.times, t);
  return i < 0 ? 0 : s.values[i];
}

/** ∫₀ᵗ of the step series. */
export function areaTo(s: StepSeries, t: number): number {
  const i = lastAtOrBefore(s.times, t);
  if (i < 0) return 0;
  return s.area[i] + s.values[i] * (t - s.times[i]);
}

/** Simulate the model to its horizon. Pure and deterministic per seed. */
export function simulate(m: Model, o: { maxEntities?: number } = {}): Run {
  const cap = o.maxEntities ?? MAX_ENTITIES;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const N = m.nodes.length;
  const H = m.horizon;
  const arrivalRng = m.nodes.map((n) => mulberry32(streamSeed(m.seed, n.index, 1)));
  const serviceRng = m.nodes.map((n) => mulberry32(streamSeed(m.seed, n.index, 2)));
  const routeRng = m.nodes.map((n) => mulberry32(streamSeed(m.seed, n.index, 3)));
  // Group sizes draw from their own stream, so a batch leaves the gaps' draws alone.
  const batchRng = m.nodes.map((n) => mulberry32(streamSeed(m.seed, n.index, 4)));
  const cal = new Calendar();
  const entities: Entity[] = [];
  let truncated = false;
  const sample = (d: Dist | undefined, rng: () => number): number => (d ? Math.max(0, d.inv(rng())) : 0);

  // Station state: who each server holds (−1 idle), and the waiting line.
  const serverOf: number[][] = m.nodes.map((n) => (n.kind === "station" ? new Array(n.servers).fill(-1) : []));
  const waiting: number[][] = m.nodes.map(() => []);
  const waitHead: number[] = new Array(N).fill(0);
  const current: Visit[] = [];

  // A source with a schedule keeps an operational clock (the cumulative
  // rate): its gaps are drawn there and mapped back to real time.
  const opClock: number[] = new Array(N).fill(0);
  const nextArrival = (n: ModelNode, t: number): number => {
    const gap = sample(n.inter, arrivalRng[n.index]);
    if (!n.schedule) return t + gap;
    opClock[n.index] += gap;
    return n.schedule.inv(opClock[n.index]);
  };
  const groupSize = (n: ModelNode): number => {
    if (!n.batch) return 1;
    if (n.batch.fixed) return n.batch.mean;
    // Geometric on 1, 2, … with mean b: P(k) = p(1 − p)^(k − 1), p = 1/b.
    const p = 1 / n.batch.mean;
    const u = batchRng[n.index]();
    return Math.min(MAX_BATCH, 1 + Math.floor(Math.log(1 - u) / Math.log(1 - p)));
  };

  for (const n of m.nodes) {
    if (n.kind !== "source") continue;
    if (n.inter) {
      const first = nextArrival(n, 0);
      if (Number.isFinite(first)) cal.push(first, ARRIVE_SOURCE, n.index, -1);
    } else if (n.times) for (const t of n.times) if (t <= H) cal.push(t, ARRIVE_SOURCE, n.index, -1);
  }

  const route = (n: ModelNode): number => {
    if (n.routes.length === 0) return -1;
    if (n.routes.length === 1) return n.routes[0].to;
    const u = routeRng[n.index]();
    let acc = 0;
    for (const r of n.routes) {
      acc += r.p;
      if (u < acc) return r.to;
    }
    return n.routes[n.routes.length - 1].to;
  };

  const leave = (e: Entity, t: number): void => {
    e.exit = t;
  };

  /** The entity e goes on from node `from` at time t (to its next node, or out). */
  const moveOn = (e: Entity, from: number, t: number): void => {
    const next = route(m.nodes[from]);
    if (next < 0) {
      leave(e, t);
      return;
    }
    cal.push(t, ARRIVE_NODE, next, e.id);
    current[e.id] = { node: next, arrive: t, start: Infinity, end: Infinity, server: -1, from };
  };

  const startService = (n: ModelNode, e: Entity, v: Visit, server: number, t: number): void => {
    v.start = t;
    v.server = server;
    serverOf[n.index][server] = e.id;
    const end = t + sample(n.service, serviceRng[n.index]);
    v.end = end;
    cal.push(end, END, n.index, e.id);
  };

  /** Next to serve at a station: FIFO, or lowest class first (FIFO within). */
  const takeNext = (n: ModelNode): number => {
    const q = waiting[n.index];
    if (n.discipline === "fifo") {
      if (waitHead[n.index] >= q.length) return -1;
      return q[waitHead[n.index]++];
    }
    let best = -1;
    for (let i = waitHead[n.index]; i < q.length; i++) {
      const e = entities[q[i]];
      if (best < 0 || e.priority < entities[q[best]].priority) best = i;
    }
    if (best < 0) return -1;
    const id = q[best];
    q.splice(best, 1);
    return id;
  };

  while (cal.size > 0 && cal.peekTime() <= H) {
    const [t, kind, ni, ei] = cal.pop();
    const n = m.nodes[ni];
    if (kind === ARRIVE_SOURCE) {
      if (entities.length >= cap) {
        truncated = true;
        continue;
      }
      for (let k = groupSize(n); k > 0; k--) {
        if (entities.length >= cap) {
          truncated = true;
          break;
        }
        const e: Entity = { id: entities.length, source: ni, priority: n.priority, born: t, exit: Infinity, visits: [] };
        entities.push(e);
        moveOn(e, ni, t);
      }
      if (n.inter) {
        const next = nextArrival(n, t);
        if (Number.isFinite(next)) cal.push(next, ARRIVE_SOURCE, ni, -1);
      }
      continue;
    }
    const e = entities[ei];
    if (kind === ARRIVE_NODE) {
      const v = current[ei];
      e.visits.push(v);
      if (n.kind === "sink") {
        v.start = t;
        leave(e, t);
      } else if (n.kind === "delay") {
        v.start = t;
        v.end = t + sample(n.service, serviceRng[ni]);
        cal.push(v.end, END, ni, ei);
      } else if (n.kind === "station") {
        const free = serverOf[ni].indexOf(-1);
        if (free >= 0) startService(n, e, v, free, t);
        else if (waiting[ni].length - waitHead[ni] >= n.capacity) {
          v.start = t;
          v.end = t;
          v.balked = true;
          leave(e, t);
        } else waiting[ni].push(ei);
      } else {
        // A route into a source: it passes straight through.
        v.start = t;
        v.end = t;
        moveOn(e, ni, t);
      }
      continue;
    }
    // END of a service or a delay.
    if (n.kind === "station") {
      const v = e.visits[e.visits.length - 1];
      serverOf[ni][v.server] = -1;
      const nextId = takeNext(n);
      if (nextId >= 0) {
        const ne = entities[nextId];
        startService(n, ne, ne.visits[ne.visits.length - 1], v.server, t);
      }
    }
    moveOn(e, ni, t);
  }

  // ---- the indexes ----------------------------------------------------------------
  const stations = new Map<number, StationLog>();
  for (const n of m.nodes) {
    if (n.kind !== "station") continue;
    const qc: [number, number][] = [];
    const bc: [number, number][] = [];
    const arr: number[] = [];
    const balks: number[] = [];
    const served: [number, number][] = [];
    const ends: number[] = [];
    for (const e of entities)
      for (const v of e.visits) {
        if (v.node !== n.index) continue;
        arr.push(v.arrive);
        if (v.balked) {
          balks.push(v.arrive);
          continue;
        }
        if (v.start > v.arrive) {
          qc.push([v.arrive, 1]);
          if (v.start <= H) qc.push([v.start, -1]);
        }
        if (v.start <= H) {
          bc.push([v.start, 1]);
          if (v.end <= H) {
            bc.push([v.end, -1]);
            ends.push(v.end);
          }
          if (v.arrive >= m.warmup) served.push([v.start, v.start - v.arrive]);
        }
      }
    arr.sort((a, b) => a - b);
    balks.sort((a, b) => a - b);
    ends.sort((a, b) => a - b);
    served.sort((a, b) => a[0] - b[0]);
    const waitSum = new Float64Array(served.length);
    let acc = 0;
    served.forEach(([, w], i) => {
      acc += w;
      waitSum[i] = acc;
    });
    stations.set(n.index, {
      node: n.index,
      queue: stepSeries(qc),
      busy: stepSeries(bc),
      arrivals: Float64Array.from(arr),
      balks: Float64Array.from(balks),
      starts: Float64Array.from(served.map((s) => s[0])),
      waitSum,
      waits: Float64Array.from(served.map((s) => s[1])),
      ends: Float64Array.from(ends),
    });
  }
  const sc: [number, number][] = [];
  const births: number[] = [];
  const exits: number[] = [];
  const soj: [number, number][] = [];
  const sinks = new Map<number, number[]>();
  for (const n of m.nodes) if (n.kind === "sink") sinks.set(n.index, []);
  for (const e of entities) {
    births.push(e.born);
    sc.push([e.born, 1]);
    if (e.exit <= H) {
      exits.push(e.exit);
      sc.push([e.exit, -1]);
      if (e.born >= m.warmup) soj.push([e.exit, e.exit - e.born]);
      const last = e.visits[e.visits.length - 1];
      if (last && m.nodes[last.node].kind === "sink") sinks.get(last.node)!.push(e.exit);
    }
  }
  exits.sort((a, b) => a - b);
  soj.sort((a, b) => a[0] - b[0]);
  const sojournSum = new Float64Array(soj.length);
  let s = 0;
  soj.forEach(([, w], i) => {
    s += w;
    sojournSum[i] = s;
  });
  const t1 = typeof performance !== "undefined" ? performance.now() : 0;
  return {
    model: m,
    entities,
    stations,
    system: stepSeries(sc),
    births: Float64Array.from(births),
    exits: Float64Array.from(exits),
    sojournEnds: Float64Array.from(soj.map((x) => x[0])),
    sojournSum,
    sinks: new Map([...sinks].map(([k, v]) => [k, Float64Array.from(v.sort((a, b) => a - b))])),
    truncated,
    ms: t1 - t0,
  };
}

// ---- reading the run at time t ---------------------------------------------------------

export interface StationStats {
  queue: number;
  busy: number;
  servers: number;
  /** Time-average share of servers busy over [warmup, t] (0–1). */
  util: number;
  /** Mean wait before service of those served by t (came after warmup); NaN if none. */
  wait: number;
  /** Time-average queue length over [warmup, t]. */
  avgQueue: number;
  /** Departures per time unit over [warmup, t]. */
  throughput: number;
  arrivals: number;
  served: number;
  departures: number;
  balked: number;
}

export function stationStats(run: Run, node: number, t: number): StationStats | null {
  const log = run.stations.get(node);
  if (!log) return null;
  const n = run.model.nodes[node];
  const w0 = run.model.warmup;
  const span = t - w0;
  const k = countUpTo(log.starts, t);
  const served = k;
  const wait = k > 0 ? log.waitSum[k - 1] / k : NaN;
  const busyArea = areaTo(log.busy, t) - areaTo(log.busy, w0);
  const qArea = areaTo(log.queue, t) - areaTo(log.queue, w0);
  const endsIn = countUpTo(log.ends, t) - countUpTo(log.ends, w0 - 1e-12);
  return {
    queue: valueAt(log.queue, t),
    busy: valueAt(log.busy, t),
    servers: n.servers,
    util: span > 0 ? busyArea / (span * n.servers) : 0,
    wait,
    avgQueue: span > 0 ? qArea / span : 0,
    throughput: span > 0 ? endsIn / span : 0,
    arrivals: countUpTo(log.arrivals, t),
    served,
    departures: countUpTo(log.ends, t),
    balked: countUpTo(log.balks, t),
  };
}

export interface SystemStats {
  arrivals: number;
  departures: number;
  inSystem: number;
  /** Time-average number in the system over [warmup, t]. */
  L: number;
  /** Mean time in system of those who left by t (born after warmup); NaN if none. */
  W: number;
  /** Arrivals per time unit over [warmup, t]. */
  lambda: number;
}

export function systemStats(run: Run, t: number): SystemStats {
  const w0 = run.model.warmup;
  const span = t - w0;
  const arrivals = countUpTo(run.births, t);
  const departures = countUpTo(run.exits, t);
  const k = countUpTo(run.sojournEnds, t);
  const bornIn = arrivals - countUpTo(run.births, w0 - 1e-12);
  return {
    arrivals,
    departures,
    inSystem: arrivals - departures,
    L: span > 0 ? (areaTo(run.system, t) - areaTo(run.system, w0)) / span : 0,
    W: k > 0 ? run.sojournSum[k - 1] / k : NaN,
    lambda: span > 0 ? bornIn / span : 0,
  };
}

/** Where a token is at time t, for the picture. */
export type TokenAt =
  | { entity: number; priority: number; where: "transit"; from: number; to: number; frac: number }
  | { entity: number; priority: number; where: "wait"; node: number; rank: number }
  | { entity: number; priority: number; where: "service"; node: number; server: number }
  | { entity: number; priority: number; where: "delay"; node: number; rank: number };

/**
 * Every token at time t. On screen an entity spends its first `transit`
 * time units at a node travelling the arrow into it (the model counts it
 * there already); a stay shorter than that is seen as the journey only.
 */
export function tokensAt(run: Run, t: number): TokenAt[] {
  const d = run.model.transit;
  const out: TokenAt[] = [];
  const waitAt = new Map<number, { e: Entity; arrive: number }[]>();
  const delayAt = new Map<number, number>();
  const last = countUpTo(run.births, t);
  for (let i = 0; i < last; i++) {
    const e = run.entities[i];
    if (e.exit + d < t) continue;
    // The visit it is on (or travelling to) at t.
    let v: Visit | undefined;
    for (let j = e.visits.length - 1; j >= 0; j--)
      if (e.visits[j].arrive <= t) {
        v = e.visits[j];
        break;
      }
    if (!v) continue;
    const from = v.from < 0 ? e.source : v.from;
    if (t < v.arrive + d) {
      out.push({ entity: e.id, priority: e.priority, where: "transit", from, to: v.node, frac: d > 0 ? (t - v.arrive) / d : 1 });
      continue;
    }
    if (v.end <= t || v.balked || run.model.nodes[v.node].kind === "sink") continue;
    const kind = run.model.nodes[v.node].kind;
    if (kind === "delay") {
      const r = delayAt.get(v.node) ?? 0;
      delayAt.set(v.node, r + 1);
      out.push({ entity: e.id, priority: e.priority, where: "delay", node: v.node, rank: r });
    } else if (v.start <= t) out.push({ entity: e.id, priority: e.priority, where: "service", node: v.node, server: v.server });
    else {
      const l = waitAt.get(v.node) ?? [];
      l.push({ e, arrive: v.arrive });
      waitAt.set(v.node, l);
    }
  }
  for (const [node, l] of waitAt) {
    const prio = run.model.nodes[node].discipline === "priority";
    l.sort((a, b) => (prio ? a.e.priority - b.e.priority : 0) || a.arrive - b.arrive || a.e.id - b.e.id);
    l.forEach((w, rank) => out.push({ entity: w.e.id, priority: w.e.priority, where: "wait", node, rank }));
  }
  return out;
}

/** The step series a chart draws, clipped to [0, t], as points (x, y) — steps kept square, at most `max` changes. */
export function stepPoints(s: StepSeries, t: number, max = 800): [number, number][] {
  const out: [number, number][] = [];
  const n = lastAtOrBefore(s.times, t) + 1;
  if (n <= 0) return [[0, 0], [t, 0]];
  const stride = Math.max(1, Math.ceil(n / max));
  let prev = s.values[0];
  out.push([0, prev]);
  for (let i = 1; i < n; i += stride) {
    // A thinned series keeps the bin's highest value, so a peak is never lost.
    let v = s.values[i];
    for (let k = i + 1; k < Math.min(n, i + stride); k++) v = Math.max(v, s.values[k]);
    out.push([s.times[i], prev]);
    out.push([s.times[i], v]);
    prev = v;
  }
  out.push([t, prev]);
  return out;
}

// ---- queueing theory --------------------------------------------------------------------

/** Mean external arrival rate of a source (per time unit; entities, groups counted whole), or null. */
export function sourceRate(n: ModelNode, horizon: number): number | null {
  if (n.inter && n.schedule) return n.schedule.cum(horizon) / horizon;
  if (n.inter && n.inter.mean > 0) return (n.batch?.mean ?? 1) / n.inter.mean;
  if (n.times && n.times.length > 0) return n.times.filter((x) => x <= horizon).length / horizon;
  return null;
}

/** A source's arrivals are a Poisson process: exponential gaps, one at a time, a steady rate. */
export const isPoisson = (n: ModelNode): boolean => !!n.inter && n.inter.kind === "exponential" && !n.batch && !n.schedule;

/**
 * The squared coefficient of variation a source's arrivals bring to a queue
 * (its index of dispersion): groups arriving with gap cv² c² and sizes of
 * mean b and variance σ² count as b·c² + σ²/b entities — b·c² for a fixed
 * size, b·c² + b − 1 for geometric sizes. One at a time it is the gaps' cv².
 * With a schedule it is the burstiness about the average rate; the swings of
 * the rate itself are not in it.
 */
export function arrivalCv2(n: ModelNode): number {
  const c2 = n.inter?.cv2 ?? 1;
  if (!n.batch) return c2;
  const b = n.batch.mean;
  return b * c2 + (n.batch.fixed ? 0 : b - 1);
}

/** λ at every node from the traffic equations λ = λ₀ + λP (balking ignored). */
export function trafficRates(m: Model): number[] {
  const N = m.nodes.length;
  const ext = m.nodes.map((n) => (n.kind === "source" ? (sourceRate(n, m.horizon) ?? 0) : 0));
  let lam = ext.slice();
  for (let it = 0; it < 500; it++) {
    const next = ext.slice();
    for (const n of m.nodes) {
      // What leaves a node is what came in (a source's own arrivals included).
      const out = lam[n.index];
      if (n.kind === "sink") continue;
      for (const r of n.routes) next[r.to] += out * r.p;
    }
    let diff = 0;
    for (let i = 0; i < N; i++) diff = Math.max(diff, Math.abs(next[i] - lam[i]));
    lam = next;
    if (diff < 1e-12) break;
  }
  return lam;
}

/** Erlang C: the chance an arrival waits in M/M/c with offered load a = λ/μ. NaN when unstable. */
export function erlangC(c: number, a: number): number {
  const rho = a / c;
  if (!(rho < 1)) return NaN;
  // a^k/k! summed stably.
  let term = 1,
    sum = 1;
  for (let k = 1; k < c; k++) {
    term *= a / k;
    sum += term;
  }
  const last = (term * a) / c; // a^c / c!
  const top = last / (1 - rho);
  return top / (sum + top);
}

export interface Theory {
  lambda: number;
  /** Utilisation ρ = λ E[S] / c. */
  rho: number;
  /** Mean wait in queue: exact for M/M/c (Jackson) and M/G/1; Allen–Cunneen otherwise. NaN when ρ ≥ 1. */
  wq: number;
  lq: number;
  /** wq is exact queueing theory (else an approximation). */
  exact: boolean;
  /** The arrivals' and the service's squared coefficients of variation the approximation used. */
  ca2: number;
  cs2: number;
  /** An arrival rate that changes over the run feeds it: the theory is for steady arrivals at the average rate. */
  scheduled: boolean;
}

/** Mean wait in queue for c servers at utilisation rho with mean service s, arrival and service cv²: M/M/c times (ca² + cs²) / 2. */
export function waitApprox(c: number, rho: number, s: number, ca2 = 1, cs2 = 1): number {
  if (!(rho < 1) || !(rho >= 0)) return NaN;
  if (rho === 0) return 0;
  const a = rho * c;
  const mu = 1 / s;
  const lam = a * mu;
  const wq = erlangC(c, a) / (c * mu - lam);
  return (wq * (ca2 + cs2)) / 2;
}

/** Theory for a station, or null (no service, no arrivals). */
export function stationTheory(m: Model, node: number, rates = trafficRates(m)): Theory | null {
  const n = m.nodes[node];
  if (n.kind !== "station" || !n.service) return null;
  const lambda = rates[node];
  if (!(lambda > 0)) return null;
  const s = n.service.mean;
  const rho = (lambda * s) / n.servers;
  // Arrivals: Poisson when every source is, and the network is Jackson-like
  // (exponential stations) or this station is fed straight from sources.
  const sources = m.nodes.filter((x) => x.kind === "source");
  const poissonSources = sources.every(isPoisson);
  const feeders = m.nodes.filter((x) => x.kind !== "sink" && x.routes.some((r) => r.to === node));
  const direct = feeders.every((x) => x.kind === "source");
  const upstreamExp = feeders.every((x) => x.kind === "source" || (x.kind === "station" && x.service?.kind === "exponential") || (x.kind === "delay"));
  const poissonIn = poissonSources && (direct || upstreamExp);
  const ca2 = poissonIn ? 1 : direct && feeders.length === 1 && feeders[0].inter ? arrivalCv2(feeders[0]) : 1;
  const cs2 = n.service.cv2;
  const finite = Number.isFinite(n.capacity);
  const wq = waitApprox(n.servers, rho, s, ca2, cs2);
  const exact = !finite && poissonIn && (n.service.kind === "exponential" || n.servers === 1);
  return { lambda, rho, wq, lq: lambda * wq, exact, ca2, cs2, scheduled: sources.some((x) => !!x.schedule) };
}
