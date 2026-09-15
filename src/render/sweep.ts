// The sweep model (spec 2026-09-15 §4): a `run` command's series, and the
// explore beat's seeded demo walk, as lists of COMPLETE value maps — one per
// step, every control named. Pure: the planner turns these into a step, the
// player runs each map through applyControls + runCode. The demo's seed is a
// stable hash of the element id and its control names, so a cast plays the
// same demo every time and a test can pin a frame (a movie that differs per
// export, and a frame a test cannot pin, are both worse than a fixed walk).
import type { ControlSpec, ControlValue } from "../code/controls";
// The three series types live with the rest of the spec's shapes in
// src/spec/types.ts (the schema and the lint read them too); this module only
// uses them.
import type { PlayArgs, SeriesSpec } from "../spec/types";

export const RUN_MAX_STEPS = 20;
export const DEMO_MAX_STEPS = 5;
export const DEMO_EVERY_S = 0.5;

/** FNV-1a, 32-bit unsigned — the same tag run.ts and svg-backend.ts keep privately. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Numerical-Recipes LCG (basic.ts keeps one privately): a seeded stream in [0, 1). */
export function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const isRange = (s: SeriesSpec): s is { from: number; to: number; steps: number } => typeof s === "object" && s !== null && !Array.isArray(s);

/** A slider value snapped to its step and clamped, rounded to its decimals. */
function snap(c: ControlSpec, v: number): number {
  const min = c.min ?? 0, max = c.max ?? 1;
  let out = v;
  if (c.step && c.step > 0) out = min + Math.round((out - min) / c.step) * c.step;
  if (c.integer) out = Math.round(out);
  out = Math.min(max, Math.max(min, out));
  return Number(out.toFixed(c.decimals ?? 6));
}

export function expandSeries(c: ControlSpec, s: SeriesSpec): ControlValue[] {
  if (Array.isArray(s)) return s;
  if (isRange(s)) {
    const n = Math.max(1, Math.floor(s.steps));
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = n === 1 ? s.from : s.from + ((s.to - s.from) * i) / (n - 1);
      out.push(c.kind === "slider" ? snap(c, v) : v);
    }
    return out;
  }
  return [s];
}

export function runValues(args: PlayArgs, controls: ControlSpec[]): { steps: Record<string, ControlValue>[]; issues: string[] } {
  const issues: string[] = [];
  const names = Object.keys(args.values ?? {});
  if (names.length === 0) issues.push("values names no control");
  const series = new Map<string, ControlValue[]>();
  for (const name of names) {
    const c = controls.find((x) => x.name === name);
    if (!c) { issues.push(`values.${name}: no control named "${name}"`); continue; }
    const spec = args.values[name];
    if (isRange(spec) && !(spec.steps >= 1)) { issues.push(`values.${name}: steps must be at least 1`); continue; }
    const vals = expandSeries(c, spec);
    if (vals.length === 0) { issues.push(`values.${name}: an empty list names no step`); continue; }
    if (c.kind === "choice") for (const v of vals) if (!(c.options ?? []).includes(String(v))) issues.push(`values.${name}: "${v}" is not one of ${(c.options ?? []).join(", ")}`);
    if (c.kind === "toggle") for (const v of vals) if (typeof v !== "boolean") issues.push(`values.${name}: a toggle takes true or false`);
    series.set(name, vals);
  }
  const n = Math.max(0, ...[...series.values()].map((v) => v.length));
  const loop = Math.max(1, Math.floor(args.loop ?? 1));
  if (n * loop > RUN_MAX_STEPS) issues.push(`a run may have at most ${RUN_MAX_STEPS} steps (this one has ${n * loop})`);
  if (issues.length > 0 || n === 0) return { steps: [], issues };
  const base: Record<string, ControlValue>[] = [];
  for (let i = 0; i < n; i++) {
    const m: Record<string, ControlValue> = {};
    for (const c of controls) {
      const s = series.get(c.name);
      m[c.name] = s && s.length > 0 ? s[Math.min(i, s.length - 1)] : c.default;
    }
    base.push(m);
  }
  const steps: Record<string, ControlValue>[] = [];
  for (let k = 0; k < loop; k++) steps.push(...base.map((m) => ({ ...m })));
  return { steps, issues };
}

/** The explore demo: a seeded walk over the movable controls, one at a time,
 *  at most DEMO_MAX_STEPS moves, then back to the defaults. */
export function demoWalk(id: string, controls: ControlSpec[]): Record<string, ControlValue>[] {
  const movable = controls.filter((c) => c.kind === "slider" || c.kind === "choice" || c.kind === "toggle");
  if (movable.length === 0) return [];
  const rnd = lcg(stableHash(`${id}:${controls.map((c) => c.name).join(",")}`));
  const defaults: Record<string, ControlValue> = Object.fromEntries(controls.map((c) => [c.name, c.default]));
  // Seeded visiting order (Fisher–Yates on a copy).
  const order = [...movable];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const moves: { name: string; value: ControlValue }[] = [];
  for (const c of order) {
    if (c.kind === "slider") {
      const min = c.min ?? 0, max = c.max ?? 1;
      const pts = [snap(c, min + 0.25 * (max - min)), snap(c, min + 0.75 * (max - min))];
      if (rnd() < 0.5) pts.reverse();
      for (const p of pts) if (p !== c.default) moves.push({ name: c.name, value: p });
    } else if (c.kind === "choice") {
      const opts = c.options ?? [];
      const i = opts.indexOf(String(c.default));
      if (opts.length > 1) moves.push({ name: c.name, value: opts[(i + 1) % opts.length] });
    } else if (c.kind === "toggle") {
      moves.push({ name: c.name, value: !(c.default === true || c.default === "true") });
    }
  }
  const steps: Record<string, ControlValue>[] = [];
  let cur = { ...defaults };
  for (const m of moves.slice(0, DEMO_MAX_STEPS)) {
    cur = { ...cur, [m.name]: m.value };
    steps.push(cur);
  }
  steps.push({ ...defaults });
  return steps;
}
