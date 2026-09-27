// The widget side of a figure's parameters (params-ui): which drawn part
// works which parameter, and how, for a live widget body to compose with its
// own gestures (equation_plot adds the curve drag and the plot's domain).
//
//   eq_param_<p>, value_<p>, box_<p>   drag sideways: a step per STEP_UNITS
//                                      of travel from the value at the press,
//                                      clamped; tap: a number field
//   knob_<p>, slider_<p>               drag: the value under the pointer
//
// Which are live: `controls` "equation" → the equation's numbers only,
// "panel" → the panel's parts only, "both" → both; a parameter must be
// editable. A patch is the whole params map with the one value changed,
// written the way the author wrote it (params.ts withValue).
import type { Pt } from "../../layout/model";
import { STEP_UNITS } from "../number-scrub";
import type { EditField, WidgetScene } from "../widget-types";
import { paramOfEqPart } from "./equation";
import { clampTo, roundTo, type Param, type ParamSet } from "./params";

export type ControlTarget = { kind: "scrub"; param: Param } | { kind: "slider"; param: Param };

/** The prefixes of the control parts, in the order a tie between them goes. */
export const CONTROL_PREFIXES = ["knob_", "slider_", "eq_param_", "value_", "box_"] as const;

/** What a press on part `id` works, or null (not a control, or not live). */
export function controlTarget(id: string, set: ParamSet): ControlTarget | null {
  const edit = (name: string | null): Param | null => {
    const p = name ? set.byName.get(name) : undefined;
    return p && p.editable ? p : null;
  };
  const eqOn = set.controls !== "panel";
  const panelOn = set.controls !== "equation";
  if (eqOn && id.startsWith("eq_param_")) {
    const p = edit(paramOfEqPart(id, set));
    return p ? { kind: "scrub", param: p } : null;
  }
  const m = /^(value|box|knob|slider)_(.+)$/.exec(id);
  if (!m || !panelOn || !set.panel.some((q) => q.name === m[2])) return null;
  const p = edit(m[2]);
  if (!p) return null;
  if (m[1] === "value" || m[1] === "box") return { kind: "scrub", param: p };
  return p.min !== undefined && p.max !== undefined ? { kind: "slider", param: p } : null;
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

/** The number field a tap on a scrub target opens. */
export function controlField(t: ControlTarget): EditField | null {
  if (t.kind !== "scrub") return null;
  const p = t.param;
  return { value: p.value, label: p.label, step: p.step, ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}) };
}

/** The value a drag from `from` to `to` (logical) sets. A slider reads its
 *  own drawn track off the scene, so any fit of the page is already in it. */
export function controlDragValue(t: ControlTarget, scene: WidgetScene, from: Pt, to: Pt): { name: string; value: number } | null {
  if (t.kind === "scrub") return { name: t.param.name, value: scrubValue(t.param, to[0] - from[0]) };
  const track = scene.lines.get(`slider_${t.param.name}`)?.[0];
  if (!track || track.length < 2) return null;
  const xs = track.map((q) => q[0]);
  return { name: t.param.name, value: sliderPointerValue(t.param, to[0], Math.min(...xs), Math.max(...xs)) };
}

/** The control parts among `ids` that are live, in tie order. */
export function controlParts(ids: readonly string[], set: ParamSet): string[] {
  const rank = (id: string): number => CONTROL_PREFIXES.findIndex((p) => id.startsWith(p));
  return ids.filter((id) => rank(id) >= 0 && controlTarget(id, set) !== null).sort((a, b) => rank(a) - rank(b));
}
