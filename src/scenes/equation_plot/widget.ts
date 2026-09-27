// equation_plot's widget body: while the figure is paused the viewer changes
// the parameters where they are drawn, and moves the plot's own axes; the
// curve, the equation's numbers, the panel and the marks follow under the
// pointer.
//
//   a number in the equation,   params-ui/controls.ts: drag sideways to
//   a panel value or box,       scrub, tap to type; a slider takes the
//   a slider's knob or track    value under the pointer
//   a curve                     drag up/down: the parameter the press takes
//                               hold of is solved so the curve passes through
//                               the pointer at the x where it was grabbed
//                               (model.ts dragParam / solveParam)
//   a point or tangent whose    drag sideways: the parameter moves with the
//   `at` is a parameter         pointer's x (it rides along the curve)
//   blank paper in the plot     drag: pans the domain (the axes' numbers
//   (the body's surface)        move, the curve is re-sampled)
//   ctrl/⌘ + wheel or a pinch   zooms the domain about the pointer, both axes
//   over the plot
//   the "Reset axes" pill       back to the authored ranges (rest)
//
// Which parameters are live follows the author: `controls`, `editable` /
// `fixed`, `drag`. A y range the author did not set is kept still by the
// widget — each patch writes the range on screen back as `y_range`, widened
// (to round ticks) only when the new curve would leave it. Everything is a
// patch of x_range / y_range / params: the movie never sees it.
import type { BBox } from "../../layout/geometry";
import type { Pt } from "../../layout/model";
import { SURFACE_PART, type EditField, type WidgetBody, type WidgetEvent, type WidgetScene } from "../widget-types";
import { controlDragValue, controlField, controlParts, controlTarget, type ControlTarget } from "../params-ui/controls";
import { panRange, sameRange, tidyRange, zoomRange, type Range } from "../params-ui/domain";
import { clampTo, roundTo, withValue, type Param } from "../params-ui/params";
import { yRangeOf } from "./layout";
import { autoYRange, dragParam, fitsRange, readModel, sampleCurve, solveParam, type EquationPlotParams, type Model } from "./model";

export type EqTarget = ControlTarget | { kind: "curve"; curve: number } | { kind: "along"; param: Param };

/** A press on a curve this near a draggable point takes the point instead. */
export const POINT_GRAB = 16;

/** The n-th point (or tangent) mark on curve c. */
function markFor(m: Model, kind: "point" | "tangent", n: number, c: number) {
  return m.marks.filter((k) => k.kind === kind && (k.curve ?? 0) === c)[n - 1] ?? null;
}

/** What a press on part `id` works, or null. */
export function eqTarget(id: string, m: Model): EqTarget | null {
  const control = controlTarget(id, m);
  if (control) return control;
  let r: RegExpMatchArray | null;
  if ((r = id.match(/^curve_(\d+)$/))) {
    const c = m.curves[Number(r[1])];
    return c && c.node && m.drag !== false ? { kind: "curve", curve: c.index } : null;
  }
  if ((r = id.match(/^(point|tangent)(?:_(\d+))?(?:_c(\d+))?$/))) {
    const mk = markFor(m, r[1] as "point" | "tangent", r[2] ? Number(r[2]) : 1, r[3] ? Number(r[3]) : 0);
    const p = mk && typeof mk.at === "string" ? m.byName.get(mk.at) : undefined;
    return p && p.editable ? { kind: "along", param: p } : null;
  }
  return null;
}

/** Every drawn part the viewer may work, in the order a tie goes: the
 *  panel's knobs and tracks, the riding points, the numbers, the curves. */
export function eqParts(scene: WidgetScene): string[] {
  const m = readModel(scene.params as unknown as EquationPlotParams);
  const controls = controlParts(scene.ids, m);
  const knobs = controls.filter((id) => /^(knob|slider)_/.test(id));
  const numbers = controls.filter((id) => !/^(knob|slider)_/.test(id));
  const marks = scene.ids.filter((id) => /^(point|tangent)/.test(id) && eqTarget(id, m) !== null);
  const curves = scene.ids.filter((id) => id.startsWith("curve_") && eqTarget(id, m) !== null);
  return [...knobs, ...marks, ...numbers, ...curves];
}

/** The ranges on screen: x as drawn, y as drawn (the author's, the viewer's, or the calm auto one). */
export function shownRanges(P: EquationPlotParams): { x: Range; y: Range } {
  const m = readModel(P);
  return { x: m.xRange, y: yRangeOf(m, P) };
}

/**
 * The patch that puts parameter `name` at v: the new `params`, and — when
 * the author left y to the template — the y range to keep: the one on
 * screen, or, when the new curves leave it, the round range that holds both.
 */
export function eqPatch(P: EquationPlotParams, name: string, v: number, yAuto: boolean): Record<string, unknown> {
  const params = withValue(P.params, name, v);
  if (!yAuto) return { params };
  const shown = yRangeOf(readModel(P), P);
  const next = readModel({ ...P, params: params as EquationPlotParams["params"] });
  const ys = next.curves.map((c) => sampleCurve(c, next.env, next.xRange).ys);
  if (fitsRange(ys, shown)) return { params, y_range: shown };
  // Widened, never narrowed: the new curves' own round range, joined to the one on screen.
  const need = autoYRange(ys);
  return { params, y_range: [Math.min(need[0], shown[0]), Math.max(need[1], shown[1])] };
}

/** The domain zoomed by `factor` about the domain point `at`, both axes. */
export function zoomPatch(P: EquationPlotParams, at: Pt, factor: number): Record<string, unknown> {
  const { x, y } = shownRanges(P);
  return { x_range: tidyRange(zoomRange(x, at[0], factor)), y_range: tidyRange(zoomRange(y, at[1], factor)) };
}

/** The domain panned so the paper under `from` is under `to` (domain points, press-time frame). */
export function panPatch(P: EquationPlotParams, from: Pt, to: Pt): Record<string, unknown> {
  const { x, y } = shownRanges(P);
  return { x_range: tidyRange(panRange(x, from[0], to[0])), y_range: tidyRange(panRange(y, from[1], to[1])) };
}

/** The value a drag of target `t` sets, or null for nothing. */
export function dragValue(t: EqTarget, m: Model, scene: WidgetScene, from: Pt, fromDomain: Pt | null, to: Pt, toDomain: Pt | null): { name: string; value: number } | null {
  if (t.kind === "scrub" || t.kind === "slider") return controlDragValue(t, scene, from, to);
  if (!fromDomain || !toDomain) return null;
  if (t.kind === "along") return { name: t.param.name, value: clampTo(roundTo(t.param.value + (toDomain[0] - fromDomain[0]), t.param.step), t.param) };
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
  /** The ranges the author wrote (undefined: the template's own). */
  authored: { x?: Range; y?: Range };
  /** The viewer has zoomed or panned: the Reset pill may show. */
  moved: boolean;
}

const rangeOf = (r: unknown): Range | undefined => (Array.isArray(r) && r.length === 2 && r.every((v) => typeof v === "number") ? [r[0], r[1]] : undefined);

export function equationPlotWidget(): WidgetBody {
  return {
    live: true,
    parts: eqParts,
    init: (scene: WidgetScene): State => {
      const P = scene.params as unknown as EquationPlotParams;
      const x = rangeOf(P.x_range);
      const y = rangeOf(P.y_range);
      return { yAuto: !y, authored: { ...(x ? { x } : {}), ...(y ? { y } : {}) }, moved: false };
    },
    surface(scene: WidgetScene): BBox | null {
      const { x, y } = shownRanges(scene.params as unknown as EquationPlotParams);
      const a = scene.toLogical([x[0], y[0]]);
      const b = scene.toLogical([x[1], y[1]]);
      if (![...a, ...b].every(Number.isFinite)) return null;
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    },
    rest(scene: WidgetScene, raw: unknown) {
      const state = raw as State | undefined;
      if (!state?.moved) return null;
      const P = scene.params as unknown as EquationPlotParams;
      if (sameRange(rangeOf(P.x_range), state.authored.x ?? null) && sameRange(rangeOf(P.y_range), state.authored.y ?? null)) return null;
      return { x_range: state.authored.x, y_range: state.authored.y };
    },
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const t = controlTarget(id, readModel(scene.params as unknown as EquationPlotParams));
      return t ? controlField(t) : null;
    },
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw ?? { yAuto: true, authored: {}, moved: false }) as State;
      const P = scene.params as unknown as EquationPlotParams;
      const m = readModel(P);
      if (event.type === "input") {
        const t = controlTarget(event.id, m);
        if (!t || t.kind !== "scrub" || !Number.isFinite(event.value)) return { state, effects: [] };
        return { state, effects: [{ patch: eqPatch(P, t.param.name, clampTo(event.value, t.param), state.yAuto) }] };
      }
      if (event.type === "zoom") {
        if (!event.domain) return { state, effects: [] };
        return { state: { ...state, moved: true }, effects: [{ patch: zoomPatch(P, event.domain, event.factor) }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return { state, effects: [] };
      const from = event.from;
      if (!from) return { state, effects: [] };
      const fromDomain = event.fromDomain ?? null;
      if (event.id === SURFACE_PART) {
        if (!fromDomain || !event.domain) return { state, effects: [] };
        return { state: { ...state, moved: true }, effects: [{ patch: panPatch(P, fromDomain, event.domain) }] };
      }
      let t = eqTarget(event.id, m);
      // A press on the curve right at a point that rides it takes the point.
      if (t?.kind === "curve") {
        for (const id of scene.ids) {
          if (!/^point/.test(id)) continue;
          const b = scene.boxes.get(id);
          const tt = eqTarget(id, m);
          if (b && tt?.kind === "along" && Math.hypot(b.x + b.w / 2 - from[0], b.y + b.h / 2 - from[1]) <= POINT_GRAB) t = tt;
        }
      }
      if (!t) return { state, effects: [] };
      const r = dragValue(t, m, scene, from, fromDomain, event.point, event.domain);
      if (!r) return { state, effects: [] };
      return { state, effects: [{ patch: eqPatch(P, r.name, r.value, state.yAuto) }] };
    },
  };
}
