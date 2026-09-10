// Vars (design 2026-09-10 §2.1–2.2): a spec's top-level numbers, read by
// curve expressions, by `bind` expressions on any element, and as `{name}`
// tokens in drawn text. animate sweeps them (render/plan.ts).
import { compileExpression } from "./expression";
import type { SpecElement } from "./types";

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
  for (const [name, value] of Object.entries(vars as Record<string, unknown>)) {
    if (!NAME.test(name)) errors.push(`vars: "${name}" is not a name (letters, digits and _ only, not starting with a digit)`);
    else if (RESERVED.has(name)) errors.push(`vars: "${name}" is reserved (a curve variable, a function or a constant of expressions)`);
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`vars: "${name}" must be a finite number`);
  }
  return errors;
}

export function exprVariables(vars?: Vars): string[] {
  return [...EXPR_BASE_VARS, ...Object.keys(vars ?? {})];
}

/** The measure rule (layout/measures.ts formatMeasure): ≥ 100 → no decimals, else one, a trailing .0 dropped; explicit decimals kept as written. */
export function formatVar(value: number, decimals?: number): string {
  if (decimals !== undefined) return value.toFixed(decimals);
  const d = Math.abs(value) >= 100 ? 0 : 1;
  return value.toFixed(d).replace(/\.0$/, "");
}

const TOKEN = /\{([a-zA-Z_][a-zA-Z_0-9]*)(?::(\d))?\}/g;

/** `{f}` / `{f:2}` → the var's value; an unknown name is left as written and returned in `unknown`. */
export function interpolateVars(text: string, vars: Vars): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(TOKEN, (whole, name: string, decimals: string | undefined) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    }
    return formatVar(vars[name], decimals === undefined ? undefined : Number(decimals));
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
