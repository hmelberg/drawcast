// equation_plot's widget body: while the figure is paused the viewer changes
// the parameters where they are drawn, and the curve, the equation's numbers,
// the panel and the marks follow under the pointer.
//
//   a number in the equation   drag sideways: one step per STEP_UNITS of
//   (eq_param_<name>),         travel from the value at the press, clamped
//   a panel value or box       to min/max; tap: type a number
//   a slider's knob or track   drag: the value under the pointer
//   a curve                    drag up/down: the parameter the press takes
//                              hold of is solved so the curve passes through
//                              the pointer at the x where it was grabbed
//                              (model.ts dragParam / solveParam)
//   a point or tangent whose   drag sideways: the parameter moves with the
//   `at` is a parameter        pointer's x (it rides along the curve)
//
// Which of these are live follows the author: `controls` (equation, panel,
// both), `editable` / `fixed`, `drag`. A y range the author did not set is
// kept still by the widget — each patch writes the range on screen back as
// `y_range`, widened (to round ticks) only when the new curve would leave it.
import { STEP_UNITS } from "../number-scrub";
import type { Pt } from "../../layout/model";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { yRangeOf } from "./layout";
import { autoYRange, clampTo, dragParam, fitsRange, readModel, roundTo, sampleCurve, solveParam, type EquationPlotParams, type Model, type Param } from "./model";

export type EqTarget =
  | { kind: "scrub"; param: Param }
  | { kind: "slider"; param: Param }
  | { kind: "curve"; curve: number }
  | { kind: "along"; param: Param };

/** A press on a curve this near a draggable point takes the point instead. */
export const POINT_GRAB = 16;

/** What a press on part `id` works, or null. */
export function eqTarget(id: string, m: Model): EqTarget | null {
  const eqOn = m.controls !== "panel";
  const panelOn = m.controls !== "equation";
  const edit = (name: string): Param | null => {
    const p = m.byName.get(name);
    return p && p.editable ? p : null;
  };
  let r: RegExpMatchArray | null;
  if (eqOn && id.startsWith("eq_param_")) {
    // eq_param_<name>, or eq_param_<name>_<k> where the name appears again
    // (a name may itself end in _<digits>: the whole of it is tried first).
    const rest = id.slice("eq_param_".length);
    const p = edit(rest) ?? (/_\d+$/.test(rest) ? edit(rest.replace(/_\d+$/, "")) : null);
    return p ? { kind: "scrub", param: p } : null;
  }
  if (panelOn && (r = id.match(/^(value|box)_(.+)$/))) {
    const p = m.panel.some((q) => q.name === r![2]) ? edit(r[2]) : null;
    return p ? { kind: "scrub", param: p } : null;
  }
  if (panelOn && (r = id.match(/^(knob|slider)_(.+)$/))) {
    const p = m.panel.some((q) => q.name === r![2]) ? edit(r[2]) : null;
    return p && p.min !== undefined && p.max !== undefined ? { kind: "slider", param: p } : null;
  }
  if ((r = id.match(/^curve_(\d+)$/))) {
    const c = m.curves[Number(r[1])];
    return c && c.node && m.drag !== false ? { kind: "curve", curve: c.index } : null;
  }
  if ((r = id.match(/^(point|tangent)(?:_(\d+))?(?:_c(\d+))?$/))) {
    const mk = markFor(m, r[1] as "point" | "tangent", r[2] ? Number(r[2]) : 1, r[3] ? Number(r[3]) : 0);
    const p = mk && typeof mk.at === "string" ? edit(mk.at) : null;
    return p ? { kind: "along", param: p } : null;
  }
  return null;
}

/** The n-th point (or tangent) mark on curve c. */
function markFor(m: Model, kind: "point" | "tangent", n: number, c: number) {
  return m.marks.filter((k) => k.kind === kind && (k.curve ?? 0) === c)[n - 1] ?? null;
}

/** Every drawn part the viewer may work, in the order a tie goes. */
export function eqParts(scene: WidgetScene): string[] {
  const P = scene.params as unknown as EquationPlotParams;
  const m = readModel(P);
  const rank = (id: string): number => ["knob_", "slider_", "point", "tangent", "eq_param_", "value_", "box_", "curve_"].findIndex((p) => id.startsWith(p));
  return scene.ids
    .filter((id) => rank(id) >= 0 && eqTarget(id, m) !== null)
    .sort((a, b) => rank(a) - rank(b));
}

/** The params map with `name` set to v, written the way the author wrote it
 *  (a bare number stays a number, an object keeps its other keys). */
export function withValue(P: EquationPlotParams, name: string, v: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(P.params ?? {}) };
  const cur = out[name];
  out[name] = cur && typeof cur === "object" ? { ...(cur as object), value: v } : v;
  return out;
}

/**
 * The patch that puts parameter `name` at v: the new `params`, and — when
 * the author left y to the template — the y range to keep: the one on
 * screen, or, when the new curves leave it, the round range that holds both.
 */
export function eqPatch(P: EquationPlotParams, name: string, v: number, yAuto: boolean): Record<string, unknown> {
  const params = withValue(P, name, v);
  if (!yAuto) return { params };
  const shown = yRangeOf(readModel(P), P);
  const next = readModel({ ...P, params: params as EquationPlotParams["params"] });
  const ys = next.curves.map((c) => sampleCurve(c, next.env, next.xRange).ys);
  if (fitsRange(ys, shown)) return { params, y_range: shown };
  // Widened, never narrowed: the new curves' own round range, joined to the one on screen.
  const need = autoYRange(ys);
  const y_range = [Math.min(need[0], shown[0]), Math.max(need[1], shown[1])];
  return { params, y_range };
}

/** A scrub's value: whole steps of travel from the value at the press. */
export function scrubValue(p: Param, dx: number): number {
  const n = Math.trunc(dx / STEP_UNITS);
  return clampTo(roundTo(p.value + n * p.step, p.step), p);
}

/** A slider's value for a pointer at logical x on a track from x0 to x1. */
export function sliderPointerValue(p: Param, x: number, x0: number, x1: number): number {
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0 || 1)));
  return clampTo(roundTo(p.min! + t * (p.max! - p.min!), p.step), p);
}

/** The value a drag of target `t` sets, or null for nothing. */
export function dragValue(t: EqTarget, m: Model, scene: WidgetScene, from: Pt, fromDomain: Pt | null, to: Pt, toDomain: Pt | null): { name: string; value: number } | null {
  if (t.kind === "scrub") return { name: t.param.name, value: scrubValue(t.param, to[0] - from[0]) };
  if (t.kind === "slider") {
    const track = scene.lines.get(`slider_${t.param.name}`)?.[0];
    if (!track || track.length < 2) return null;
    const xs = track.map((q) => q[0]);
    return { name: t.param.name, value: sliderPointerValue(t.param, to[0], Math.min(...xs), Math.max(...xs)) };
  }
  if (!fromDomain || !toDomain) return null;
  if (t.kind === "along") {
    const v = clampTo(roundTo(t.param.value + (toDomain[0] - fromDomain[0]), t.param.step), t.param);
    return { name: t.param.name, value: v };
  }
  const c = m.curves[t.curve];
  const x0 = fromDomain[0];
  const p = dragParam(m, c, x0);
  if (!p) return null;
  const y0 = c.f(x0, m.env);
  if (!Number.isFinite(y0)) return null;
  return { name: p.name, value: solveParam(c, m.env, x0, y0 + (toDomain[1] - fromDomain[1]), p) };
}

interface State {
  /** The author set no y range: the widget keeps the one on screen. */
  yAuto: boolean;
}

export function equationPlotWidget(): WidgetBody {
  return {
    live: true,
    parts: eqParts,
    init: (scene: WidgetScene): State => {
      const yr = (scene.params as unknown as EquationPlotParams).y_range;
      return { yAuto: !(Array.isArray(yr) && yr.length === 2) };
    },
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const P = scene.params as unknown as EquationPlotParams;
      const m = readModel(P);
      const t = eqTarget(id, m);
      if (!t || t.kind !== "scrub") return null;
      const p = t.param;
      return { value: p.value, label: p.label, step: p.step, ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}) };
    },
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw ?? { yAuto: true }) as State;
      const P = scene.params as unknown as EquationPlotParams;
      const m = readModel(P);
      if (event.type === "input") {
        const t = eqTarget(event.id, m);
        if (!t || t.kind !== "scrub" || !Number.isFinite(event.value)) return { state, effects: [] };
        return { state, effects: [{ patch: eqPatch(P, t.param.name, clampTo(event.value, t.param), state.yAuto) }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return { state, effects: [] };
      const from = event.from;
      if (!from) return { state, effects: [] };
      let t = eqTarget(event.id, m);
      // A press on the curve right at a point that rides it takes the point.
      if (t?.kind === "curve") {
        for (const id of scene.ids) {
          if (!/^(point|tangent)/.test(id)) continue;
          const b = scene.boxes.get(id);
          const tt = eqTarget(id, m);
          if (!b || tt?.kind !== "along" || id.startsWith("tangent")) continue;
          if (Math.hypot(b.x + b.w / 2 - from[0], b.y + b.h / 2 - from[1]) <= POINT_GRAB) t = tt;
        }
      }
      if (!t) return { state, effects: [] };
      const fromDomain = event.type === "drag_move" ? event.fromDomain : (event.fromDomain ?? null);
      const r = dragValue(t, m, scene, from, fromDomain, event.point, event.domain);
      if (!r) return { state, effects: [] };
      return { state, effects: [{ patch: eqPatch(P, r.name, r.value, state.yAuto) }] };
    },
  };
}
