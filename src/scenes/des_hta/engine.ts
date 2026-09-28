// des_hta's engine: an individual patient-level discrete event simulation,
// the kind an HTA submission's DES is. Each simulated patient starts in the
// first state; on entering a state every event out of it draws its time by
// inverse CDF (competing risks: the earliest happens), background mortality
// by age competes with them, and the patient moves on until death or the
// horizon. Between events the patient accrues the state's QALY weight and
// cost (plus the treatment's cost while on it), discounted continuously and
// EXACTLY: ∫ e^(−δt) dt over each sojourn, δ = ln(1 + r). An event's one-off
// cost and QALY loss are discounted at its time.
//
// Random numbers are COMMON across the two strategies: patient i's k-th draw
// of event e is the same uniform under both (a counter-based hash of seed,
// patient, event, k — no sequential stream to fall out of step), so the
// intervention's patients are the comparator's own patients, and the
// difference between the strategies carries no noise from who was drawn.
// `crn: false` salts the intervention's draws instead — independent streams.
//
// Pure and deterministic. A small cache keyed on the model's own params
// makes a re-layout that only moves the time cursor (an animate of `t`)
// free: the simulation does not depend on t.
import { MAX_SHOW, readModel, type HtaParams, type Model, type ResolvedStrategy } from "./model";

/** Grid points the occupancy curves are read at (0 … horizon). */
export const GRID = 121;

const SLOT_RISK = 100;
const SLOT_BG = 101;

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A uniform in (0, 1) for (seed, patient, slot, k): the same inputs, the same number, in any order. */
export function uniform(seed: number, patient: number, slot: number, k: number): number {
  let h = fmix((seed | 0) ^ 0x2545f491);
  h = fmix((h + Math.imul(patient + 1, 0x9e3779b1)) | 0);
  h = fmix((h + Math.imul(slot + 1, 0x7feb352d)) | 0);
  h = fmix((h + Math.imul(k + 1, 0x846ca68b)) | 0);
  return (h + 0.5) / 4294967296;
}

/** ∫ₐᵇ e^(−δt) dt with δ = ln(1 + r) — the exact discounted length of a sojourn. */
export function discounted(a: number, b: number, r: number): number {
  if (b <= a) return 0;
  if (!(r > 0)) return b - a;
  const d = Math.log1p(r);
  return (Math.exp(-d * a) - Math.exp(-d * b)) / d;
}

/** The discount factor at time t. */
export const factor = (t: number, r: number): number => (r > 0 ? Math.exp(-Math.log1p(r) * t) : 1);

export interface PathEvent {
  t: number;
  /** Event index, or -1 for background death. */
  e: number;
  kind: "ae" | "move" | "death";
}
export interface Path {
  /** Sojourns in order: state index, from, to (the last ends at death or the horizon). */
  stays: { s: number; t0: number; t1: number }[];
  events: PathEvent[];
  /** Died before the horizon. */
  died: boolean;
  risk: boolean;
}

export interface ArmResult {
  name: string;
  /** Mean discounted cost and QALYs per patient. */
  cost: number;
  qalys: number;
  /** Mean undiscounted life years within the horizon (restricted mean OS). */
  ly: number;
  /** Mean undiscounted years in each state within the horizon (the first is PFS's restricted mean). */
  timeIn: number[];
  /** Mean number of times each event happens. */
  counts: number[];
  /** occ[s][k]: share of patients in state s at grid time k. */
  occ: Float64Array[];
  /** Per patient, discounted. */
  perCost: Float64Array;
  perQaly: Float64Array;
  /** The first `show` patients' histories. */
  paths: Path[];
}

export interface SimResult {
  model: Model;
  arms: [ArmResult, ArmResult];
  grid: number[];
  /** ms the simulation took. */
  ms: number;
}

function simulateArm(m: Model, S: ResolvedStrategy, salt: number, show: number): ArmResult {
  const nS = m.states.length;
  const nE = m.events.length;
  const N = m.patients;
  const H = m.horizon;
  const seed = m.seed ^ salt;
  const perCost = new Float64Array(N);
  const perQaly = new Float64Array(N);
  const timeIn = new Float64Array(nS);
  const counts = new Float64Array(nE);
  const diff = Array.from({ length: nS }, () => new Float64Array(GRID + 1));
  const step = H / (GRID - 1);
  const gridAt = (t: number): number => Math.min(GRID, Math.max(0, Math.ceil(t / step - 1e-9)));
  const paths: Path[] = [];
  const occK = new Int32Array(nE);
  const next = new Float64Array(nE);
  let lySum = 0;
  const bg = m.background;
  const bgH0 = bg ? (bg.b / bg.g) * Math.expm1(bg.g * m.age) : 0;

  for (let p = 0; p < N; p++) {
    occK.fill(0);
    next.fill(Infinity);
    const risk = m.risk ? uniform(seed, p, SLOT_RISK, 0) < m.risk.share : false;
    let onTx = true;
    let s = 0;
    let t = 0;
    let cost = 0;
    let qaly = 0;
    let died = false;
    const keep = p < show;
    const path: Path | null = keep ? { stays: [], events: [], died: false, risk } : null;
    // Background death: one draw from the age-based Gompertz, conditional on the start age.
    let bgT = Infinity;
    if (bg) {
      const E = -Math.log(uniform(seed, p, SLOT_BG, 0));
      const x = 1 + ((bgH0 + E) * bg.g) / bg.b;
      bgT = x > 0 ? Math.log(x) / bg.g - m.age : Infinity;
    }
    const draw = (ei: number, origin: number, now: number): number => {
      const ev = m.events[ei];
      let mult = onTx ? S.hr[ei] : 1;
      if (risk && m.risk!.on[ei]) mult *= m.risk!.hr;
      const E = -Math.log(uniform(seed, p, ei, occK[ei]++));
      if (!(mult > 0)) return Infinity;
      const c = now - origin;
      const tau = ev.law.Hinv(ev.law.H(c) + E / mult);
      return origin + tau;
    };
    const enter = (st: number, now: number): void => {
      next.fill(Infinity);
      for (const ei of m.out[st]) next[ei] = draw(ei, m.events[ei].clock === "model" ? 0 : now, now);
    };
    if (s === m.dead) {
      died = true;
    } else {
      enter(s, 0);
    }
    let stayStart = 0;
    while (!died) {
      let best = -1;
      let tn = bgT;
      for (let ei = 0; ei < nE; ei++) if (next[ei] < tn) (tn = next[ei]), (best = ei);
      const end = Math.min(tn, H);
      const st = m.states[s];
      qaly += st.utility * discounted(t, end, m.rQaly);
      cost += (st.cost + (onTx ? S.cost : 0)) * discounted(t, end, m.rCost);
      timeIn[s] += end - t;
      if (tn >= H) {
        t = H;
        break;
      }
      t = tn;
      if (best < 0) {
        // Background death.
        if (path) path.stays.push({ s, t0: stayStart, t1: t }), path.events.push({ t, e: -1, kind: "death" });
        diffAdd(diff, s, gridAt(stayStart), gridAt(t));
        s = m.dead;
        died = true;
        break;
      }
      const ev = m.events[best];
      counts[best]++;
      if (ev.cost) cost += ev.cost * factor(t, m.rCost);
      if (ev.qalyLoss) qaly -= ev.qalyLoss * factor(t, m.rQaly);
      if (ev.recurrent) {
        if (path) path.events.push({ t, e: best, kind: "ae" });
        next[best] = draw(best, ev.clock === "model" ? 0 : t, t);
        continue;
      }
      if (path) path.stays.push({ s, t0: stayStart, t1: t }), path.events.push({ t, e: best, kind: ev.to === m.dead ? "death" : "move" });
      diffAdd(diff, s, gridAt(stayStart), gridAt(t));
      s = ev.to;
      stayStart = t;
      if (s === m.dead) {
        died = true;
        break;
      }
      if (s === S.until) onTx = false;
      enter(s, t);
    }
    if (!died) {
      // Alive at the horizon: the last stay runs to it (and counts at the horizon's grid point).
      if (path) path.stays.push({ s, t0: stayStart, t1: H });
      diffAdd(diff, s, gridAt(stayStart), GRID);
    } else if (m.dead >= 0) {
      diffAdd(diff, m.dead, gridAt(t), GRID);
    }
    if (path) {
      path.died = died;
      paths.push(path);
    }
    lySum += Math.min(t, H);
    perCost[p] = cost;
    perQaly[p] = qaly;
  }
  const occ = diff.map((d) => {
    const o = new Float64Array(GRID);
    let run = 0;
    for (let k = 0; k < GRID; k++) {
      run += d[k];
      o[k] = run / N;
    }
    return o;
  });
  let cSum = 0, qSum = 0;
  for (let p = 0; p < N; p++) (cSum += perCost[p]), (qSum += perQaly[p]);
  return {
    name: S.name,
    cost: cSum / N,
    qalys: qSum / N,
    ly: lySum / N,
    timeIn: Array.from(timeIn, (v) => v / N),
    counts: Array.from(counts, (v) => v / N),
    occ,
    perCost,
    perQaly,
    paths,
  };
}

function diffAdd(diff: Float64Array[], s: number, k0: number, k1: number): void {
  if (s < 0 || k1 <= k0) return;
  diff[s][k0] += 1;
  diff[s][k1] -= 1;
}

/** Run both strategies on the same patients. */
export function simulate(m: Model, show = 12): SimResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const n = Math.max(0, Math.min(MAX_SHOW, show, m.patients));
  const a = simulateArm(m, m.strategies[0], 0, n);
  const b = simulateArm(m, m.strategies[1], m.crn ? 0 : 0x5bd1e995, n);
  const grid = Array.from({ length: GRID }, (_, k) => (k * m.horizon) / (GRID - 1));
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { model: m, arms: [a, b], grid, ms: t1 - t0 };
}

/** The params the simulation depends on (not the cursor, the view, the words). */
const SIM_KEYS: (keyof HtaParams)[] = ["states", "events", "strategies", "age", "background", "risk", "patients", "horizon", "discount", "seed", "crn", "show"];

const cache = new Map<string, SimResult | null>();
const CACHE_MAX = 6;

/** Simulate the params (cached on what the result depends on); null when they do not make a model. */
export function simulateParams(P: HtaParams): SimResult | null {
  const key = JSON.stringify(SIM_KEYS.map((k) => P[k] ?? null));
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const m = readModel(P);
  const r = m ? simulate(m, typeof P.show === "number" ? P.show : 12) : null;
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return r;
}

/** Share in state s at time t, read off the grid (linear between points). */
export function occAt(arm: ArmResult, s: number, t: number, horizon: number): number {
  const x = (Math.max(0, Math.min(horizon, t)) / horizon) * (GRID - 1);
  const k = Math.min(GRID - 2, Math.floor(x));
  const f = x - k;
  const o = arm.occ[s];
  return o[k] * (1 - f) + o[k + 1] * f;
}
