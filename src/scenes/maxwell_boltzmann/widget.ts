// maxwell_boltzmann's widget body: while the figure is paused the viewer
// heats the gas and moves the barrier, on the figure itself.
//
//   a curve (or its magnified tail)   drag sideways: its temperature — the
//                                     point under the hand stays under it
//                                     (the distribution only stretches with
//                                     T), so the curve flattens and shifts as
//                                     it goes. On a figure with ONE curve the
//                                     first pull leaves the authored curve as
//                                     the reference and pulls off a second,
//                                     hotter or colder one (compare)
//   a temperature ("300 K")           drag sideways to scrub, tap to type
//   the Eₐ line (or the shaded tail)  drag sideways: the activation energy
//   the catalyst's line               drag sideways: the catalysed Eₐ (kept below Eₐ)
//
// Temperatures stay inside t_range and every patch writes the axes' scale
// back (t_range, x_max), so the axes stand still under the hand.
import type { Pt } from "../../layout/model";
import { clamp, scrubbed } from "../number-scrub";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { axisOfEnergy, readModel, type MaxwellParams, type Model } from "./model";
import { energyForSpeed } from "./physics";

export const MB_PARTS = ["ea_cat_line", "ea_cat_label", "catalyst_tail", "ea_line", "ea_label", "curve_label", "compare_label", "compare_curve", "curve", "compare_tail", "tail", "catalyst_shade", "shade", "compare_shade"];

/** Kelvin per scrub step. */
export const T_STEP = 5;

const frozen = (m: Model): Record<string, unknown> => ({ t_range: m.tRange, x_max: m.xMax });

/** The temperature that moves the curve's point at domain x `from` to `to` (fixed axes). */
export function stretchT(m: Model, T0: number, from: number, to: number): number | null {
  if (!(from > m.xMax * 0.02) || !(to > 0)) return null;
  const s = to / from;
  const T = T0 * (m.mode === "speed" ? s * s : s);
  return Math.round(clamp(T, m.tRange[0], m.tRange[1]));
}

/** The energy (kJ/mol) at domain x on the drawn axis. */
const energyAt = (m: Model, x: number): number => (m.mode === "energy" ? x : energyForSpeed(x, m.main.M));

const half = (v: number): number => Math.round(v * 2) / 2;

export function dragPatch(id: string, scene: WidgetScene, from: Pt, to: Pt, fromD: Pt | null, toD: Pt | null): Record<string, unknown> | null {
  const P = scene.params as MaxwellParams;
  const m = readModel(P);
  if (id === "curve_label" || id === "compare_label") {
    const c = id === "curve_label" ? m.main : m.compare;
    if (!c) return null;
    const T = scrubbed(c.T, to[0] - from[0], T_STEP, m.tRange[0], m.tRange[1]);
    return tPatch(P, m, id === "curve_label" ? "main" : "compare", T);
  }
  if (!fromD || !toD) return null;
  if (id === "curve" || id === "tail" || id === "catalyst_tail" || id === "compare_curve" || id === "compare_tail") {
    const which = id.startsWith("compare") ? "compare" : "main";
    const c = which === "main" ? m.main : m.compare!;
    const T = stretchT(m, c.T, fromD[0], toD[0]);
    if (T === null) return null;
    // One curve: the authored one stays, the pull makes the second.
    if (which === "main" && !m.compare) return { ...frozen(m), compare: { T } };
    return tPatch(P, m, which, T);
  }
  const maxE = energyAt(m, m.xMax * 0.97);
  if (id === "ea_line" || id === "ea_label" || id === "shade" || id === "compare_shade") {
    if (m.ea === null) return null;
    // The line keeps its place under the hand: it moves by the pointer's travel.
    const x = axisOfEnergy(m.mode, m.ea, m.main.M) + (toD[0] - fromD[0]);
    const lo = m.eaCat !== null ? m.eaCat + 0.5 : 0.5;
    return { ...frozen(m), ea: half(clamp(energyAt(m, Math.max(0, x)), lo, maxE)) };
  }
  if (id === "ea_cat_line" || id === "ea_cat_label" || id === "catalyst_shade") {
    if (m.ea === null || m.eaCat === null) return null;
    const x = axisOfEnergy(m.mode, m.eaCat, m.main.M) + (toD[0] - fromD[0]);
    return { ...frozen(m), ea_catalyst: half(clamp(energyAt(m, Math.max(0, x)), 0.5, m.ea - 0.5)) };
  }
  return null;
}

function tPatch(P: MaxwellParams, m: Model, which: "main" | "compare", T: number): Record<string, unknown> {
  if (which === "main") return { ...frozen(m), T };
  return { ...frozen(m), compare: { ...(P.compare ?? {}), T } };
}

export function maxwellWidget(): WidgetBody {
  return {
    live: true,
    parts: MB_PARTS,
    init: () => ({}),
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const m = readModel(scene.params as MaxwellParams);
      const c = id === "curve_label" ? m.main : id === "compare_label" ? m.compare : null;
      if (!c) return null;
      return { value: Math.round(c.T), label: "temperature (K)", min: m.tRange[0], max: m.tRange[1], step: 1 };
    },
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      const none = { state, effects: [] };
      const P = scene.params as MaxwellParams;
      if (event.type === "input") {
        const m = readModel(P);
        if (!Number.isFinite(event.value)) return none;
        const T = Math.round(clamp(event.value, m.tRange[0], m.tRange[1]));
        if (event.id === "curve_label") return { state, effects: [{ patch: tPatch(P, m, "main", T) }] };
        if (event.id === "compare_label" && m.compare) return { state, effects: [{ patch: tPatch(P, m, "compare", T) }] };
        return none;
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      if (!event.from) return none;
      const patch = dragPatch(event.id, scene, event.from, event.point, event.fromDomain ?? null, event.domain);
      return patch ? { state, effects: [{ patch }] } : none;
    },
  };
}
