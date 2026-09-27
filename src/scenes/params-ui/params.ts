// A figure's live parameters (params-ui, 2026-09-27): the numbers an equation
// names that are not its variables — each with a value, an optional range,
// a step, a label, and whether the paused viewer may change it — read from a
// template's params in ONE shape, so every template with an equation
// (equation_plot, and plot3d next) offers the same controls:
//
//   params:   { a: 2, b: { value, min, max, step, label, fixed, control } }
//   editable: ["a"]                          only these (default: all not fixed)
//   controls: "equation" | "panel" | "both"  where the viewer works them
//   panel:    ["a", "b"]                     the panel's rows (default: editable)
//
// Every name the expressions read that the author did not declare is a
// parameter too, at 1. The JSON-schema fragment for a manifest is
// PARAMS_SCHEMA below (manifests are JSON, so a template copies it).
import { isConstantName, isFunctionName } from "./expr";

export interface ParamSpec {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** Shown, never changed by the viewer. */
  fixed?: boolean;
  /** The panel's control for it: a slider (needs min and max) or a number box. */
  control?: "slider" | "box";
}

export type ParamsMap = Record<string, number | ParamSpec>;
export type ControlsMode = "equation" | "panel" | "both";

export interface Param {
  name: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  /** Decimals the value is written with (from the step). */
  decimals: number;
  label: string;
  editable: boolean;
  control: "slider" | "box";
  /** Given in the spec's `params` (else defaulted to 1). */
  declared: boolean;
}

export interface ParamSet {
  params: Param[];
  byName: Map<string, Param>;
  /** name → value, prototype-free: what an expression evaluates against. */
  env: Record<string, number>;
  controls: ControlsMode;
  /** The panel's rows, in order (empty when controls is "equation"). */
  panel: Param[];
  /** Names past MAX_PARAMS, left out. */
  dropped: string[];
}

export const MAX_PARAMS = 8;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 1, 2 or 5 times a power of ten, at or above `raw`. */
export function niceUp(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw * (1 - 1e-9)) return m * pow;
  return 10 * pow;
}

/** Decimals a step needs (0.05 → 2, 1 → 0). */
export function decimalsFor(step: number): number {
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
}

/** Decimals a written number has (1.25 → 2). */
export function writtenDecimals(v: number): number {
  const s = String(v);
  if (/e-/i.test(s)) return Math.min(6, Number(s.split(/e-/i)[1]));
  return (s.split(".")[1] ?? "").length;
}

/** A parameter's step: the author's, else a fiftieth of its range (1-2-5),
 *  else one unit in the last decimal the value is written with (at least 0.1). */
export function stepFor(value: number, min?: number, max?: number, step?: number): number {
  if (num(step) && step > 0) return step;
  if (num(min) && num(max) && max > min) return niceUp((max - min) / 50);
  return 10 ** -Math.max(1, writtenDecimals(value));
}

export const roundTo = (v: number, step: number): number => {
  const d = decimalsFor(step);
  return Number((Math.round(v / step) * step).toFixed(Math.min(10, d + 2)));
};
export const clampTo = (v: number, p: { min?: number; max?: number }): number => Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));

/** The value as the digits the figure writes ("2.0", never "-0.0"). */
export function digitsOf(p: Param, v = p.value): string {
  const s = v.toFixed(p.decimals);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** A name a parameter may have (and not a function or a constant). */
export const isParamName = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !isConstantName(s) && !isFunctionName(s);

/** The names the author declared in `params`, in their order. */
export function declaredNames(given: unknown): string[] {
  return given && typeof given === "object" && !Array.isArray(given) ? Object.keys(given).filter(isParamName) : [];
}

/**
 * Read the parameters: `names` are the free names the expressions read (in
 * first-use order), then any the author declared but no expression reads.
 */
export function readParams(opts: { given?: unknown; names: string[]; editable?: unknown; controls?: unknown; panel?: unknown }): ParamSet {
  const given = (opts.given && typeof opts.given === "object" && !Array.isArray(opts.given) ? opts.given : {}) as ParamsMap;
  const names: string[] = [];
  for (const n of [...opts.names, ...declaredNames(given)]) if (isParamName(n) && !names.includes(n)) names.push(n);
  const editableList = Array.isArray(opts.editable) ? opts.editable.filter((s): s is string => typeof s === "string") : null;
  const params: Param[] = names.slice(0, MAX_PARAMS).map((name) => {
    const raw = Object.prototype.hasOwnProperty.call(given, name) ? given[name] : undefined;
    const spec: ParamSpec = num(raw) ? { value: raw } : raw && typeof raw === "object" ? raw : {};
    const min = num(spec.min) ? spec.min : undefined;
    const max = num(spec.max) ? spec.max : undefined;
    const value = num(spec.value) ? spec.value : min !== undefined && max !== undefined ? (min <= 1 && 1 <= max ? 1 : (min + max) / 2) : 1;
    const step = stepFor(value, min, max, spec.step);
    const bounded = min !== undefined && max !== undefined && max > min;
    return {
      name,
      value,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      step,
      decimals: Math.max(decimalsFor(step), writtenDecimals(value) > decimalsFor(step) ? Math.min(writtenDecimals(value), 4) : 0),
      label: typeof spec.label === "string" && spec.label.trim() ? spec.label.trim() : name,
      editable: spec.fixed !== true && (editableList === null || editableList.includes(name)),
      control: spec.control === "box" || !bounded ? "box" : "slider",
      declared: raw !== undefined,
    };
  });
  const byName = new Map(params.map((p) => [p.name, p]));
  const env = Object.create(null) as Record<string, number>;
  for (const p of params) env[p.name] = p.value;
  const controls: ControlsMode = opts.controls === "panel" || opts.controls === "both" ? opts.controls : "equation";
  const panelNames = Array.isArray(opts.panel) ? opts.panel.filter((s): s is string => typeof s === "string") : null;
  const panel = controls === "equation" ? [] : panelNames ? panelNames.flatMap((n) => (byName.has(n) ? [byName.get(n)!] : [])) : params.filter((p) => p.editable);
  return { params, byName, env, controls, panel, dropped: names.slice(MAX_PARAMS) };
}

/** Problems with the params the schema cannot see (a template's lint adds them). */
export function lintParams(given: unknown, set: ParamSet, lists: Record<string, unknown>): { severity: "warn" | "error"; message: string }[] {
  const out: { severity: "warn" | "error"; message: string }[] = [];
  const g = (given && typeof given === "object" ? given : {}) as ParamsMap;
  for (const [name, raw] of Object.entries(g)) {
    if (!raw || typeof raw !== "object") continue;
    const { value, min, max } = raw;
    if (typeof min === "number" && typeof max === "number" && !(max > min)) out.push({ severity: "error", message: `param "${name}": min ${min} is not below max ${max}` });
    else if (typeof value === "number" && ((typeof min === "number" && value < min) || (typeof max === "number" && value > max)))
      out.push({ severity: "error", message: `param "${name}": value ${value} is outside its range [${min ?? "−∞"}, ${max ?? "∞"}]` });
  }
  if (set.dropped.length > 0) out.push({ severity: "error", message: `${set.params.length + set.dropped.length} parameters — at most ${MAX_PARAMS} (${set.dropped.join(", ")} left out)` });
  for (const [field, list] of Object.entries(lists)) {
    const names = typeof list === "string" ? [list] : Array.isArray(list) ? list : [];
    for (const n of names) if (typeof n === "string" && !set.byName.has(n)) out.push({ severity: "warn", message: `${field}: "${n}" is not a parameter of the equation` });
  }
  return out;
}

/** The params map with `name` set to v, written the way the author wrote it
 *  (a bare number stays a number, an object keeps its other keys). */
export function withValue(given: unknown, name: string, v: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...((given && typeof given === "object" ? given : {}) as object) };
  const cur = out[name];
  out[name] = cur && typeof cur === "object" ? { ...(cur as object), value: v } : v;
  return out;
}

/**
 * The tray's sliders (SceneModule.sliders): one per editable parameter with
 * both bounds, at the path an animate or the tray writes — <key>.<name> for
 * a bare number, <key>.<name>.value for the object form. A parameter the
 * author never wrote has no number to slide from, so none.
 */
export function traySliders(given: unknown, set: ParamSet, key = "params"): { path: string; label: string; min: number; max: number; step: number }[] {
  const g = (given && typeof given === "object" ? given : {}) as ParamsMap;
  return set.params.flatMap((p) => {
    if (!p.editable || !p.declared || p.min === undefined || p.max === undefined || !(p.max > p.min)) return [];
    return [{ path: typeof g[p.name] === "number" ? `${key}.${p.name}` : `${key}.${p.name}.value`, label: p.label, min: p.min, max: p.max, step: p.step }];
  });
}

/**
 * The manifest's JSON-schema properties for this shape — a template's
 * manifest.json carries a copy (it cannot import); tests/params-ui.test.ts
 * holds every copy to this one.
 */
export const PARAMS_SCHEMA = {
  params: {
    type: "object",
    description:
      "Parameter name → a number (its value), or {value, min, max, step, label, fixed, control}. min+max give a slider and bound scrubbing and dragging; step defaults to a fiftieth of the range; label names it in the panel (\"amplitude a\"); fixed: true shows it but the viewer cannot change it; control \"box\" makes its panel control a number box.",
    additionalProperties: {
      oneOf: [
        { type: "number" },
        {
          type: "object",
          properties: {
            value: { type: "number" },
            min: { type: "number" },
            max: { type: "number" },
            step: { type: "number" },
            label: { type: "string" },
            fixed: { type: "boolean" },
            control: { type: "string", enum: ["slider", "box"] },
          },
        },
      ],
    },
  },
  editable: { type: "array", items: { type: "string", "x-translate": false }, description: "Only these parameters may be changed by the viewer (default: all but fixed ones)." },
  controls: {
    type: "string",
    enum: ["equation", "panel", "both"],
    description: "Where the viewer changes them: the equation's own numbers (default), a panel of sliders/boxes right of the plot, or both.",
  },
  panel: { type: "array", items: { type: "string", "x-translate": false }, description: "The parameters in the panel, in order (default: the editable ones)." },
} as const;
