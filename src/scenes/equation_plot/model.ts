// equation_plot's model: the template params read once into curves,
// parameters and ranges — and the numerics every part shares (ranges and
// ticks, roots and extrema, the solve a curve drag makes). Pure; the layout
// draws what this computes and the widget patches what this reads. The
// parameters themselves — their shape, the controls, the drawn equation and
// panel — are params-ui's, shared with every template that has a live
// equation.
import { arityProblem, compile, lhsTeX, namesIn, parseExpr, type Env, type Node } from "../params-ui/expr";
import { withPreset } from "./presets";
import { clampTo, declaredNames, niceUp, readParams, roundTo, type Param, type ParamSet, type ParamsMap } from "../params-ui/params";

export type { Param } from "../params-ui/params";

export type MarkKind = "roots" | "extrema" | "y_intercept" | "point" | "tangent" | "hline" | "vline";
export interface MarkSpec {
  kind: MarkKind;
  /** x of a point, tangent or vline, y of an hline: a number, a parameter's
   *  name (the mark then moves with it — and a point drags it), or an
   *  expression in the parameters ("K_m*(1 + I/K_i)", "V_max/2"). */
  at?: number | string;
  /** Which equation (0-based, default 0). */
  curve?: number;
  label?: string | boolean;
  /** A point's words at the feet of its dashed guides: under the x axis, left of the y axis. */
  x_label?: string;
  y_label?: string;
  /** The mark's own id (a preset names its marks: "km", "vmax"); else point, hline_2, … */
  id?: string;
}

export interface EquationPlotParams {
  /** A named textbook curve (presets.ts): its fields fill in under the author's own. */
  preset?: string;
  /** false: the preset's marks are left out (the author's `marks` are otherwise added to them). */
  preset_marks?: boolean;
  equation?: string | string[];
  params?: ParamsMap;
  editable?: string[];
  controls?: "equation" | "panel" | "both";
  panel?: string[];
  drag?: boolean | string | string[];
  x_range?: [number, number];
  y_range?: [number, number];
  /** "log": the x axis runs in powers of ten (x_range above 0; the frame's x is then log10 x). */
  x_scale?: "linear" | "log";
  marks?: (MarkKind | MarkSpec)[];
  variable?: string;
  equation_form?: "values" | "symbols" | "both";
  x_label?: string;
  y_label?: string;
  grid?: boolean;
}

export interface Curve {
  index: number;
  src: string;
  lhs: string;
  lhsTeX: string;
  node: Node | null;
  error: string | null;
  f: (x: number, env: Env) => number;
}

export type XScale = "linear" | "log";

export interface Model extends ParamSet {
  variable: string;
  curves: Curve[];
  xRange: [number, number];
  /** How x maps to the page: linearly, or by log10 (the frame's x is then log10 x). */
  xScale: XScale;
  drag: string[] | "auto" | false;
  marks: MarkSpec[];
  form: "values" | "symbols" | "both";
  errors: string[];
}

export const MAX_CURVES = 4;
export const DEFAULT_X: [number, number] = [-5, 5];
export const DEFAULT_LOG_X: [number, number] = [0.01, 100];

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The variable an equation's left side names: "f(t)" → t; else null. */
function lhsVariable(lhs: string): string | null {
  const m = /^\s*[A-Za-z][A-Za-z0-9_]*\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*$/.exec(lhs);
  return m ? m[1] : null;
}

function splitEquation(src: string): { lhs: string; rhs: string } {
  const at = src.indexOf("=");
  if (at < 0) return { lhs: "y", rhs: src };
  return { lhs: src.slice(0, at).trim() || "y", rhs: src.slice(at + 1) };
}

/** x → the page's axis coordinate: x itself, or log10 x on a log axis. */
export const toU = (scale: XScale, x: number): number => (scale === "log" ? Math.log10(x) : x);
/** The axis coordinate back to x. */
export const fromU = (scale: XScale, u: number): number => (scale === "log" ? 10 ** u : u);

/** A mark's `at` as an expression over the parameters, or null (a number, nothing, or not an expression). */
export function atExpr(at: unknown, declared: readonly string[] = []): Node | null {
  if (typeof at !== "string" || at.trim() === "") return null;
  try {
    const node = parseExpr(at, declared);
    return arityProblem(node) ? null : node;
  } catch {
    return null;
  }
}

/** Where a mark sits: its `at` at the current parameters (NaN when it cannot be read). */
export function markAt(mk: MarkSpec, m: Pick<Model, "env" | "params">): number {
  if (typeof mk.at === "number") return mk.at;
  const node = atExpr(mk.at, m.params.map((p) => p.name));
  return node ? compile(node)(m.env) : NaN;
}

/** The colour of the parameter a mark's `at` follows (the first with a
 *  colour of its own that the expression reads), or null: a fixed x. */
export function markColor(mk: MarkSpec, m: Pick<Model, "params" | "byName">): string | null {
  const node = atExpr(mk.at, m.params.map((p) => p.name));
  if (!node) return null;
  for (const n of namesIn(node)) {
    const c = m.byName.get(n)?.color;
    if (c) return c;
  }
  return null;
}

/** The ids of the marks that are one part each (point, tangent, hline,
 *  vline): the author's `id`, else the kind numbered in order (point,
 *  point_2, …) with _c<i> for a mark on curve i > 0. */
export function markIds(marks: readonly MarkSpec[]): Map<MarkSpec, string> {
  const out = new Map<MarkSpec, string>();
  const count: Record<string, number> = {};
  for (const mk of marks) {
    if (mk.kind !== "point" && mk.kind !== "tangent" && mk.kind !== "hline" && mk.kind !== "vline") continue;
    const n = (count[mk.kind] = (count[mk.kind] ?? 0) + 1);
    const c = mk.curve ?? 0;
    out.set(mk, typeof mk.id === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(mk.id) ? mk.id : `${mk.kind}${n > 1 ? `_${n}` : ""}${c > 0 ? `_c${c}` : ""}`);
  }
  return out;
}

/** Read the template params (a preset's filled in first). Never throws: what is wrong is listed in `errors`. */
export function readModel(raw: EquationPlotParams): Model {
  const P = withPreset(raw);
  const errors: string[] = [];
  const list = (Array.isArray(P.equation) ? P.equation : [P.equation]).filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, MAX_CURVES);
  if (list.length === 0) errors.push("no equation (write `equation`, or name a `preset`)");
  const declared = declaredNames(P.params);
  const split = list.map(splitEquation);
  const variable =
    typeof P.variable === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(P.variable) ? P.variable : (split.map((s) => lhsVariable(s.lhs)).find((v) => v !== null) ?? "x");

  const curves: Curve[] = split.map(({ lhs, rhs }, index) => {
    let node: Node | null = null;
    let error: string | null = null;
    try {
      node = parseExpr(rhs, declared);
      error = arityProblem(node);
      if (error) node = null;
    } catch (e) {
      error = (e as Error).message;
    }
    const fn = node ? compile(node) : null;
    const f = fn ? (x: number, env: Env): number => fn({ ...env, [variable]: x }) : (): number => NaN;
    return { index, src: list[index], lhs, lhsTeX: lhsTeX(lhs), node, error, f };
  });
  for (const c of curves) if (c.error) errors.push(`equation ${curves.length > 1 ? `${c.index + 1} ` : ""}"${c.src}": ${c.error}`);

  // Parameters: every free name but the variable, in first-use order, then
  // a mark's `at` name, then any declared one the equations do not read.
  const names: string[] = [];
  for (const c of curves) if (c.node) for (const n of namesIn(c.node)) if (n !== variable && !names.includes(n)) names.push(n);
  for (const m of P.marks ?? []) {
    if (typeof m !== "object" || !m || typeof m.at !== "string") continue;
    const node = atExpr(m.at, declared);
    if (!node) {
      errors.push(`mark ${m.kind}: at "${m.at}" is neither a number, a parameter nor an expression`);
      continue;
    }
    for (const n of namesIn(node)) if (n !== variable && !names.includes(n)) names.push(n);
  }
  const set = readParams({ given: P.params, names: names.concat(declared.filter((n) => n !== variable)), editable: P.editable, controls: P.controls, panel: P.panel });
  if (set.dropped.length > 0) errors.push(`${set.params.length + set.dropped.length} parameters — at most ${set.params.length}`);

  const xScale: XScale = P.x_scale === "log" ? "log" : "linear";
  const xGiven = Array.isArray(P.x_range) && num(P.x_range[0]) && num(P.x_range[1]) && P.x_range[1] > P.x_range[0];
  if (xGiven && xScale === "log" && !(P.x_range![0] > 0)) errors.push(`x_scale "log" needs an x_range above 0, not [${P.x_range!.join(", ")}]`);
  const xr = xGiven && (xScale === "linear" || P.x_range![0] > 0) ? ([P.x_range![0], P.x_range![1]] as [number, number]) : xScale === "log" ? DEFAULT_LOG_X : DEFAULT_X;
  const drag: Model["drag"] =
    P.drag === false ? false : typeof P.drag === "string" ? [P.drag] : Array.isArray(P.drag) ? P.drag.filter((s): s is string => typeof s === "string") : "auto";
  const marks: MarkSpec[] = (P.marks ?? []).flatMap((m): MarkSpec[] =>
    typeof m === "string" ? [{ kind: m }] : m && typeof m === "object" && typeof m.kind === "string" ? [m] : [],
  );
  const form = P.equation_form === "symbols" || P.equation_form === "both" ? P.equation_form : "values";
  return { ...set, variable, curves, xRange: xr, xScale, drag, marks, form, errors };
}

// ---- sampling, ranges and ticks -------------------------------------------

export const SAMPLES = 240;

/** The curve's values across the x range (NaN where undefined), evenly
 *  spaced on the page — in powers of ten on a log axis. */
export function sampleCurve(c: Curve, env: Env, [x0, x1]: [number, number], n = SAMPLES, scale: XScale = "linear"): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const [u0, u1] = [toU(scale, x0), toU(scale, x1)];
  for (let i = 0; i <= n; i++) {
    const x = fromU(scale, u0 + ((u1 - u0) * i) / n);
    xs.push(x);
    const y = c.f(x, env);
    ys.push(Number.isFinite(y) ? y : NaN);
  }
  return { xs, ys };
}

/** What the auto y range must hold: every curve across the x range, and the
 *  height of every hline mark (an asymptote a curve only approaches). */
export function yNeeds(m: Model): number[][] {
  const lines = m.marks.filter((mk) => mk.kind === "hline").map((mk) => markAt(mk, m)).filter(Number.isFinite);
  return [...m.curves.map((c) => sampleCurve(c, m.env, m.xRange, SAMPLES, m.xScale).ys), ...(lines.length ? [lines] : [])];
}

/** Evenly spaced round numbers covering [lo, hi], about `target` of them. */
export function niceTicks(lo: number, hi: number, target = 6): { step: number; ticks: number[] } {
  const step = niceUp((hi - lo) / target);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { step, ticks };
}

/**
 * The y range the curves need, snapped outward to round ticks — the calm
 * rule: a small change of a parameter leaves the axis where it was, and it
 * moves only in whole tick steps. The extent is the curves' values trimmed
 * of a pole's spikes (the 2nd–98th percentile when the extremes run far past
 * it), padded a tenth, and reaching 0 when 0 is near.
 */
export function autoYRange(ysets: number[][]): [number, number] {
  const all = ysets.flat().filter(Number.isFinite).sort((a, b) => a - b);
  if (all.length === 0) return [-1, 1];
  let lo = all[0];
  let hi = all[all.length - 1];
  const q = (t: number): number => all[Math.min(all.length - 1, Math.max(0, Math.round(t * (all.length - 1))))];
  const [q2, q98] = [q(0.02), q(0.98)];
  const core = Math.max(q98 - q2, 1e-9);
  if (hi - q98 > 3 * core) hi = q98;
  if (q2 - lo > 3 * core) lo = q2;
  if (hi - lo < 1e-9) {
    const m = Math.max(1, Math.abs(hi));
    lo -= m * 0.5;
    hi += m * 0.5;
  }
  // A curve that stays on one side of 0, near it, is drawn from 0 (no pad
  // below a population, a price); otherwise a tenth of air either side.
  const span = hi - lo;
  const pad = span * 0.1;
  const fromZero = lo >= 0 && lo <= span * 0.5;
  const toZero = hi <= 0 && -hi <= span * 0.5;
  lo = fromZero ? 0 : lo - pad;
  hi = toZero ? 0 : hi + pad;
  const { step } = niceTicks(lo, hi, 8);
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
}

/** Whether the curves stay inside `range` (their trimmed extent does). */
export function fitsRange(ysets: number[][], range: [number, number]): boolean {
  const [lo, hi] = autoYRangeRaw(ysets);
  return lo >= range[0] - 1e-9 && hi <= range[1] + 1e-9;
}
function autoYRangeRaw(ysets: number[][]): [number, number] {
  const all = ysets.flat().filter(Number.isFinite).sort((a, b) => a - b);
  if (all.length === 0) return [0, 0];
  const q = (t: number): number => all[Math.round(t * (all.length - 1))];
  const core = Math.max(q(0.98) - q(0.02), 1e-9);
  const hi = all[all.length - 1] - q(0.98) > 3 * core ? q(0.98) : all[all.length - 1];
  const lo = q(0.02) - all[0] > 3 * core ? q(0.02) : all[0];
  return [lo, hi];
}

// ---- marks ------------------------------------------------------------------

const GRID = 800;

function bisect(g: (x: number) => number, a: number, b: number, ga: number): number {
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (!Number.isFinite(gm)) return m;
    if (gm === 0) return m;
    if (Math.sign(gm) === Math.sign(ga)) {
      a = m;
      ga = gm;
    } else b = m;
  }
  return (a + b) / 2;
}

/** d/dx by central difference. */
export function slopeAt(f: (x: number) => number, x: number, span: number): number {
  const h = span * 1e-5;
  return (f(x + h) - f(x - h)) / (2 * h);
}

/** Powers of ten across [lo, hi] (lo > 0) — with their 2s and 5s when the range spans under three decades. */
export function logTicks(lo: number, hi: number): number[] {
  const k0 = Math.floor(Math.log10(lo) + 1e-9);
  const k1 = Math.ceil(Math.log10(hi) - 1e-9);
  const within = (v: number): boolean => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);
  const few = k1 - k0 < 3;
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) for (const m of few ? [1, 2, 5] : [1]) {
    const v = Number((m * 10 ** k).toPrecision(12));
    if (within(v)) out.push(v);
  }
  return out;
}

/** Where f crosses (or touches) zero in [x0, x1], left to right — at most `cap`. */
export function rootsOf(f: (x: number) => number, [x0, x1]: [number, number], cap = 6): number[] {
  const out: number[] = [];
  const dx = (x1 - x0) / GRID;
  let xp = x0;
  let gp = f(x0);
  const push = (r: number): void => {
    if (out.length < cap && !out.some((o) => Math.abs(o - r) < dx * 0.5)) out.push(r);
  };
  if (gp === 0) push(x0);
  for (let i = 1; i <= GRID; i++) {
    const x = x0 + dx * i;
    const g = f(x);
    if (g === 0) push(x);
    else if (Number.isFinite(g) && Number.isFinite(gp) && gp !== 0 && Math.sign(g) !== Math.sign(gp)) {
      const r = bisect(f, xp, x, gp);
      // A pole also changes sign (1/x at 0): a true root has a small value there.
      const fr = Math.abs(f(r));
      if (fr <= Math.max(Math.abs(g), Math.abs(gp))) push(r);
    }
    xp = x;
    gp = g;
  }
  // A root the curve only touches (x² at 0) is a turning point at height 0.
  const scale = Math.max(1e-12, ...Array.from({ length: 21 }, (_, i) => Math.abs(f(x0 + ((x1 - x0) * i) / 20))).filter(Number.isFinite));
  for (const e of extremaOf(f, [x0, x1])) if (Math.abs(e.y) < 1e-9 * scale) push(e.x);
  return out.sort((a, b) => a - b);
}

/** The curve's turning points in (x0, x1), left to right — at most `cap`. */
export function extremaOf(f: (x: number) => number, [x0, x1]: [number, number], cap = 6): { x: number; y: number; kind: "max" | "min" }[] {
  const span = x1 - x0;
  const d = (x: number): number => slopeAt(f, x, span);
  const out: { x: number; y: number; kind: "max" | "min" }[] = [];
  const dx = span / GRID;
  // The last grid point with a slope of either sign: a slope of exactly 0 on
  // the grid (a parabola's vertex at x = 0) sits between two of them.
  let xp = x0 + dx;
  let dp = d(xp);
  for (let i = 2; i < GRID && out.length < cap; i++) {
    const x = x0 + dx * i;
    const dv = d(x);
    if (!Number.isFinite(dv)) {
      dp = NaN;
      continue;
    }
    if (dv === 0) continue;
    if (Number.isFinite(dp) && dp !== 0 && Math.sign(dv) !== Math.sign(dp)) {
      const r = bisect(d, xp, x, dp);
      const y = f(r);
      // A pole flips the slope's sign too (1/x² at 0): skip what is not finite
      // or far past its neighbours.
      const around = Math.max(Math.abs(f(xp)), Math.abs(f(x)));
      if (Number.isFinite(y) && Math.abs(y) <= around * 1.5 + 1e-9) out.push({ x: r, y, kind: dp > 0 ? "max" : "min" });
    }
    xp = x;
    dp = dv;
  }
  return out;
}

// ---- the curve drag's solve ---------------------------------------------------

/** ∂f/∂p at x0 (central difference in p). */
export function sensitivity(c: Curve, env: Env, x0: number, p: Param): number {
  const h = Math.max(1e-4, Math.abs(p.value) * 1e-4);
  const e1 = { ...env, [p.name]: p.value + h };
  const e0 = { ...env, [p.name]: p.value - h };
  const d = (c.f(x0, e1) - c.f(x0, e0)) / (2 * h);
  return Number.isFinite(d) ? d : 0;
}

/**
 * The parameter a press on the curve at x0 takes hold of. The author's
 * `drag` list: its first editable name that moves the curve at x0 at all.
 * By default: the editable parameter that moves the curve at x0 the most
 * per unit (largest |∂f/∂p|). Null: nothing there to move.
 */
export function dragParam(m: Model, c: Curve, x0: number): Param | null {
  if (m.drag === false) return null;
  const pool = m.drag === "auto" ? m.params.filter((p) => p.editable) : m.drag.map((n) => m.byName.get(n)).filter((p): p is Param => !!p && p.editable);
  let best: Param | null = null;
  let bestS = 0;
  for (const p of pool) {
    const s = Math.abs(sensitivity(c, m.env, x0, p));
    if (s < 1e-9) continue;
    if (m.drag !== "auto") return p;
    if (s > bestS * (1 + 1e-9)) {
      best = p;
      bestS = s;
    }
  }
  return best;
}

/**
 * The value of `p` that puts the curve through (x0, target): Newton from the
 * value at the press, then — when Newton wanders or stalls — the bracket
 * nearest the press value, bisected. Clamped to the parameter's range; a
 * target out of reach gives the in-range value that comes closest. Rounded
 * to the parameter's step.
 */
export function solveParam(c: Curve, env: Env, x0: number, target: number, p: Param): number {
  const g = (v: number): number => c.f(x0, { ...env, [p.name]: v }) - target;
  const lo = p.min ?? -Infinity;
  const hi = p.max ?? Infinity;
  const clamp = (v: number): number => Math.min(hi, Math.max(lo, v));
  const tol = 1e-9 * Math.max(1, Math.abs(target));
  const done = (v: number): number => clampTo(roundTo(v, p.step), p);

  let v = clamp(p.value);
  for (let i = 0; i < 40; i++) {
    const gv = g(v);
    if (!Number.isFinite(gv)) break;
    if (Math.abs(gv) < tol) return done(v);
    const h = Math.max(1e-6, Math.abs(v) * 1e-6);
    const d = (g(v + h) - g(v - h)) / (2 * h);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-14) break;
    const next = clamp(v - gv / d);
    if (Math.abs(next - v) < 1e-12 * Math.max(1, Math.abs(v))) {
      if (Math.abs(g(next)) < 1e-6 * Math.max(1, Math.abs(target))) return done(next);
      break;
    }
    v = next;
  }
  // Fallback: walk out from the press value both ways for a sign change.
  const v0 = clamp(p.value);
  const g0 = g(v0);
  let best = { v: v0, e: Number.isFinite(g0) ? Math.abs(g0) : Infinity };
  const bounded = Number.isFinite(lo) && Number.isFinite(hi);
  const probe = (a: number, b: number): number | null => {
    const ga = g(a);
    const gb = g(b);
    for (const [vv, gg] of [
      [a, ga],
      [b, gb],
    ] as const)
      if (Number.isFinite(gg) && Math.abs(gg) < best.e) best = { v: vv, e: Math.abs(gg) };
    if (Number.isFinite(ga) && Number.isFinite(gb) && Math.sign(ga) !== Math.sign(gb)) return bisect(g, a, b, ga);
    return null;
  };
  if (bounded) {
    const n = 400;
    const dv = (hi - lo) / n;
    // Outward from v0, the nearer bracket first.
    for (let k = 0; k < n; k++) {
      for (const dir of [1, -1]) {
        const a = clamp(v0 + dir * k * dv);
        const b = clamp(v0 + dir * (k + 1) * dv);
        if (a === b) continue;
        const r = probe(a, b);
        if (r !== null) return done(r);
      }
    }
  } else {
    let span = Math.max(1, Math.abs(v0)) * 0.05;
    let [a1, a2] = [v0, v0];
    for (let k = 0; k < 60; k++) {
      const [b1, b2] = [clamp(v0 + span), clamp(v0 - span)];
      const r = probe(a1, b1) ?? probe(b2, a2);
      if (r !== null) return done(r);
      [a1, a2] = [b1, b2];
      span *= 1.5;
      if (span > 1e7) break;
    }
  }
  return done(best.v);
}

