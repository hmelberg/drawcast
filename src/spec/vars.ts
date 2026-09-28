// Vars (design 2026-09-10 §2.1–2.2): a spec's top-level numbers, read by
// curve expressions, by `bind` expressions on any element, and as `{name}`
// tokens in drawn text. animate sweeps them (render/plan.ts).
import { compileExpression } from "./expression";
import type { SpecElement, VarDef } from "./types";
import { decimalsOf, niceStep } from "../scenes/number-scrub";

export type Vars = Record<string, number>;

/** The variable names every curve expression already has. */
export const EXPR_BASE_VARS: readonly string[] = ["x", "X", "q", "Q", "t", "T"];

/**
 * Names a var can never be read under: `x` (the curve variable) and the
 * evaluator's functions and constants. `t`, `q` (and `T`, `Q`) are aliases of
 * `x` in a curve expression ONLY until a var of that name exists — `t` is the
 * name a sweep parameter naturally takes, so a var shadows the alias
 * (layout/curves.ts sampleExpression spreads the vars last).
 */
const RESERVED = new Set([
  "x", "X",
  "pi", "e",
  "exp", "ln", "log", "log10", "sqrt", "abs", "min", "max", "pow", "sin", "cos", "tan", "floor", "ceil", "round",
]);

const NAME = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

export function varNameErrors(vars: unknown): string[] {
  if (typeof vars !== "object" || vars === null || Array.isArray(vars)) return ["vars: must be an object of numbers, e.g. {f: 1}"];
  const errors: string[] = [];
  const seen: string[] = [];
  for (const [name, value] of Object.entries(vars as Record<string, unknown>)) {
    if (!NAME.test(name)) errors.push(`vars: "${name}" is not a name (letters, digits and _ only, not starting with a digit)`);
    else if (RESERVED.has(name)) errors.push(`vars: "${name}" is reserved (a curve variable, a function or a constant of expressions)`);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) errors.push(...varDefErrors(name, value as Record<string, unknown>, seen));
    else if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`vars: "${name}" must be a finite number`);
    seen.push(name);
  }
  return errors;
}

const DEF_KEYS = new Set(["value", "expr", "min", "max", "step", "decimals", "color", "fixed", "_written"]);

/** The object form's own rules: a value or an expr (not both), numbers where numbers go, an expr that reads only the vars before it. */
function varDefErrors(name: string, def: Record<string, unknown>, before: string[]): string[] {
  const errors: string[] = [];
  for (const k of Object.keys(def)) if (!DEF_KEYS.has(k)) errors.push(`vars: "${name}" has an unknown field "${k}" (value, expr, min, max, step, decimals, color, fixed)`);
  for (const k of ["value", "min", "max", "step", "decimals"]) {
    if (def[k] !== undefined && (typeof def[k] !== "number" || !Number.isFinite(def[k] as number))) errors.push(`vars: "${name}".${k} must be a finite number`);
  }
  if (def.step !== undefined && typeof def.step === "number" && !(def.step > 0)) errors.push(`vars: "${name}".step must be above 0`);
  if (def.color !== undefined && typeof def.color !== "string") errors.push(`vars: "${name}".color must be a colour string`);
  if (def.fixed !== undefined && typeof def.fixed !== "boolean") errors.push(`vars: "${name}".fixed must be true or false`);
  const hasValue = def.value !== undefined;
  if (def.expr !== undefined) {
    if (typeof def.expr !== "string") errors.push(`vars: "${name}".expr must be a string`);
    else if (hasValue) errors.push(`vars: "${name}" has both value and expr — a computed var has no value of its own`);
    else {
      try {
        compileExpression(def.expr, before);
      } catch (err) {
        errors.push(`vars: "${name}".expr "${def.expr}" — ${(err as Error).message} (it reads only the vars listed before it)`);
      }
    }
  } else if (!hasValue) errors.push(`vars: "${name}" needs a value (or an expr)`);
  return errors;
}

/** A var's definition, read: its value where it has one, and what the object form says. */
export interface VarInfo {
  name: string;
  /** The value now (a sweep's or a scrub's, once one has replaced it); NaN for a computed var (see varValues). */
  value: number;
  /** The value as the author wrote it — whose decimals a formula keeps and whose size sets the scrub step. */
  written: number;
  expr?: string;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  color?: string;
  /** Never live: `fixed: true`, or a computed var. */
  fixed: boolean;
}

/** Each var as a VarInfo, in declaration order. Ill-formed entries are skipped (validation names them). */
export function varInfos(vars: Record<string, VarDef> | undefined): VarInfo[] {
  const out: VarInfo[] = [];
  for (const [name, def] of Object.entries(vars ?? {})) {
    if (typeof def === "number") {
      if (Number.isFinite(def)) out.push({ name, value: def, written: def, fixed: false });
      continue;
    }
    if (typeof def !== "object" || def === null) continue;
    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const expr = typeof def.expr === "string" && def.expr.trim() !== "" ? def.expr : undefined;
    const value = num(def.value);
    if (expr === undefined && value === undefined) continue;
    out.push({
      name,
      value: expr !== undefined ? NaN : value!,
      written: expr !== undefined ? NaN : num(def._written) ?? value!,
      ...(expr !== undefined ? { expr } : {}),
      ...(num(def.min) !== undefined ? { min: num(def.min) } : {}),
      ...(num(def.max) !== undefined ? { max: num(def.max) } : {}),
      ...(num(def.step) !== undefined && num(def.step)! > 0 ? { step: num(def.step) } : {}),
      ...(num(def.decimals) !== undefined ? { decimals: Math.max(0, Math.min(6, Math.round(num(def.decimals)!))) } : {}),
      ...(typeof def.color === "string" && def.color.trim() !== "" ? { color: def.color.trim() } : {}),
      fixed: def.fixed === true || expr !== undefined,
    });
  }
  return out;
}

/**
 * The numbers every reader of vars wants (curve expr, bind, `{name}`): each
 * var's value, and each computed var evaluated in declaration order over the
 * ones before it. A computed var that cannot be evaluated is left out (its
 * `{name}` then stays as written and warns, like any unknown name).
 */
export function varValues(vars: Record<string, VarDef> | undefined): Vars {
  const out: Vars = {};
  for (const v of varInfos(vars)) {
    if (v.expr === undefined) {
      out[v.name] = v.value;
      continue;
    }
    try {
      const x = compileExpression(v.expr, Object.keys(out))(out);
      if (Number.isFinite(x)) out[v.name] = x;
    } catch {
      /* validation says why */
    }
  }
  return out;
}

/** The vars an animate may sweep: every var with a value of its own (a computed var follows the others). */
export function animatableVars(vars: Record<string, VarDef> | undefined): Vars | null {
  if (vars === undefined) return null;
  const out: Vars = {};
  for (const v of varInfos(vars)) if (v.expr === undefined) out[v.name] = v.value;
  return out;
}

/** Swept or previewed values put back into the definitions: an object-form
 *  var keeps its range, colour and decimals, only its value changes. */
export function withVarValues(vars: Record<string, VarDef> | undefined, values: Record<string, number>): Record<string, VarDef> {
  const out: Record<string, VarDef> = { ...(vars ?? {}) };
  for (const [name, v] of Object.entries(values)) {
    const def = out[name];
    if (typeof def === "object" && def !== null) {
      if (def.expr === undefined) out[name] = { ...def, value: v, _written: def._written ?? def.value };
    } else if (typeof def === "number" && def !== v) out[name] = { value: v, _written: def };
    else out[name] = v;
  }
  return out;
}

/**
 * How a live var is scrubbed when its definition does not say: the step is
 * the larger of the written value's own last decimal (0.035 → 0.001, 20 → 1)
 * and a nice 1 % of it (1000 → 10) — or 1 % of max − min when both are given; the floor is 0 unless the value is
 * negative (number-scrub.ts amountScrub's rule); no ceiling.
 */
export function varScrub(v: VarInfo): { step: number; min: number; max: number } {
  const written = 10 ** -Math.min(6, decimalsOf(v.written));
  // With both ends given, 1 % of the range is the step.
  const ranged = v.min !== undefined && v.max !== undefined && v.max > v.min;
  const step = v.step ?? (ranged ? niceStep(v.max! - v.min!, written) : Math.max(written, niceStep(v.written, written)));
  return { step, min: v.min ?? (v.written < 0 ? -Infinity : 0), max: v.max ?? Infinity };
}

/** The decimals a live var is written with in a formula: its own `decimals`,
 *  else as many as the author wrote or the step needs (0.035 → 3, so a scrub
 *  to 0.04 reads "0.040", never "0"). */
export function liveDecimals(v: VarInfo): number {
  if (v.decimals !== undefined) return v.decimals;
  return Math.min(6, Math.max(decimalsOf(v.written), decimalsOf(varScrub(v).step)));
}

export function exprVariables(vars?: Vars): string[] {
  return [...EXPR_BASE_VARS, ...Object.keys(vars ?? {})];
}

/** The measure rule (layout/measures.ts formatMeasure): ≥ 100 → no decimals, else one, a trailing .0 dropped; explicit decimals kept as written. `group` puts thousands separators in the whole part: "12,500" in an English cast, "12 500" (a no-break space) where the decimal mark is a comma. */
export function formatVar(value: number, decimals?: number, decimalComma = false, group = false): string {
  const d = decimals !== undefined ? decimals : Math.abs(value) >= 100 ? 0 : 1;
  const s = decimals !== undefined ? value.toFixed(d) : value.toFixed(d).replace(/\.0$/, "");
  // The figure writes a number the way the voice reads it: 2,3 in a
  // Norwegian cast, as `measure` does (2026-09-25).
  const marked = decimalComma ? s.replace(".", ",") : s;
  return group ? marked.replace(/^-?\d+/, (whole) => whole.replace(/\B(?=(\d{3})+$)/g, decimalComma ? "\u00a0" : ",")) : marked;
}

// One optional dotted part: `{market.dwl}` reads a template's computed value
// (scenes/types.ts SceneLayout.values), which the caller merges into `vars`.
const TOKEN = /\{([a-zA-Z_][a-zA-Z_0-9]*(?:\.[a-zA-Z_][a-zA-Z_0-9]*)?)(?::(\d)?(,)?)?\}/g;

/** `{f}` / `{f:2}` / `{m:0,}` (thousands grouped) / `{market.dwl}` → the value; an unknown name is left as written and returned in `unknown`. */
export function interpolateVars(text: string, vars: Record<string, number | string>, decimalComma = false, decimalsFor: Record<string, number> = {}): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(TOKEN, (whole, name: string, decimals: string | undefined, group: string | undefined) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    }
    // A script's value may be words (`{pow.label}`, an sprintf line): as written.
    const v = vars[name];
    if (typeof v === "string") return v;
    return formatVar(v, decimals === undefined ? decimalsFor[name] : Number(decimals), decimalComma, group !== undefined);
  });
  return { text: out, unknown };
}

/** Read the number at a dot path (`at.x`, `points.2.0`); null when the path does not end on a finite number. */
function numberAt(obj: unknown, segs: string[]): number | null {
  let cur: unknown = obj;
  for (const s of segs) {
    if (Array.isArray(cur)) cur = /^\d+$/.test(s) ? cur[Number(s)] : undefined;
    else if (typeof cur === "object" && cur !== null) cur = (cur as Record<string, unknown>)[s];
    else return null;
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

/** Write `value` at a dot path on a copy, cloning every container on the way. */
function withNumberAt<T>(obj: T, segs: string[], value: number): T {
  const [head, ...rest] = segs;
  if (Array.isArray(obj)) {
    const copy = [...obj] as unknown[];
    const i = Number(head);
    copy[i] = rest.length === 0 ? value : withNumberAt(copy[i], rest, value);
    return copy as unknown as T;
  }
  const copy = { ...(obj as Record<string, unknown>) };
  copy[head] = rest.length === 0 ? value : withNumberAt(copy[head], rest, value);
  return copy as T;
}

/**
 * `bind: {field: expr}` — evaluate every expression over the vars into a
 * shallow copy of the element (design §2.2). A path that does not end on a
 * number, an unknown identifier, a bad expression or a non-finite result is
 * an error and that binding is dropped; the others still apply.
 */
export function evalBindings(el: SpecElement, vars: Vars): { el: SpecElement; errors: string[] } {
  const bind = (el as { bind?: unknown }).bind;
  if (typeof bind !== "object" || bind === null) return { el, errors: [] };
  const errors: string[] = [];
  let out = el;
  const names = Object.keys(vars);
  for (const [path, expr] of Object.entries(bind as Record<string, unknown>)) {
    const segs = path.split(".");
    if (typeof expr !== "string" || segs.some((s) => s === "") || segs[0] === "bind") {
      errors.push(`element "${el.id}": bind "${path}" — the expression must be a string`);
      continue;
    }
    if (numberAt(out, segs) === null) {
      errors.push(`element "${el.id}": bind "${path}" — not a numeric field of the element`);
      continue;
    }
    let value: number;
    try {
      value = compileExpression(expr, names)(vars);
    } catch (err) {
      errors.push(`element "${el.id}": bind "${path}" — ${(err as Error).message}`);
      continue;
    }
    if (!Number.isFinite(value)) {
      errors.push(`element "${el.id}": bind "${path}" — "${expr}" is not a finite number`);
      continue;
    }
    out = withNumberAt(out, segs, value);
  }
  return { el: out, errors };
}
