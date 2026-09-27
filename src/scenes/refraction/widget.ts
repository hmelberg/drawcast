// refraction's widget body: while the figure is paused the viewer takes the
// light in hand, on the figure itself.
//
//   the lamp or the incident ray    drag: aims the ray — the angle of
//                                   incidence follows the pointer (across
//                                   the normal it comes from the other side)
//   the refracted or exit ray       drag: the ray goes where the pointer is,
//                                   and the incidence that gives it is solved
//                                   by Snell's law (as far as one exists)
//   the reflected ray               drag: the mirror image of the lamp's
//   "n = 1.33" beside a medium      drag sideways: scrubs the index (0.01 a
//                                   step); tap: type it. The medium's name
//                                   follows the index it lands on (1.50 →
//                                   glass), the author's own at their value
//   "θ₁ = 40°", "θ₂ = 29°"          drag sideways: a degree a step; tap: type
//                                   it (θ₂ solves θ₁)
//
// Every gesture is a patch of theta1_deg / from / n1 / n2 / medium names —
// so the movie never sees it, and an `animate` of any of them plays as
// written. Free play only: the manifest carries no `widget` flag.
import type { Pt } from "../../layout/model";
import { STEP_UNITS, clamp, roundTo } from "../number-scrub";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { incidenceFor, mediumFor, N_MAX, N_MIN, readModel, THETA_MAX, type RefractionParams } from "./model";

export const REFRACTION_PARTS = ["source", "incident_ray", "refracted_ray", "exit_ray", "reflected_ray", "n1_label", "n2_label", "theta1_label", "theta2_label"];

const deg = (r: number): number => (r * 180) / Math.PI;

interface State {
  /** The media as the author wrote them: an index scrubbed back to its value gets its name back. */
  authored: { medium1?: string; n1: number; medium2?: string; n2: number };
}

/** The angle a pointer at canonical `c` makes with the normal on its own side, and whether it crossed to +x. */
function aim(c: Pt, up: boolean): { theta: number; flip: boolean } {
  const along = up ? c[1] : -c[1];
  const theta = along <= 0 ? THETA_MAX : Math.min(THETA_MAX, deg(Math.atan2(Math.abs(c[0]), along)));
  return { theta, flip: c[0] > 0 };
}

const wholeDeg = (a: number): number => clamp(Math.round(a), 0, THETA_MAX);

/** The patch a drag of `id` to logical `to` makes (press-time params). Null: nothing. */
export function aimPatch(id: string, P: RefractionParams, to: Pt): Record<string, unknown> | null {
  const m = readModel(P);
  const c = m.canon(to);
  const other = P.from === "right" ? "left" : "right";
  if (id === "source" || id === "incident_ray") {
    // The lamp sits at −x; a pointer at +x has crossed the normal.
    const a = aim(c, true);
    return { theta1_deg: wholeDeg(a.theta), ...(a.flip ? { from: other } : {}) };
  }
  if (id === "reflected_ray") {
    const a = aim(c, true);
    return { theta1_deg: wholeDeg(a.theta), ...(c[0] < 0 ? { from: other } : {}) };
  }
  if (id === "refracted_ray") {
    const a = aim(c, false);
    const t1 = incidenceFor(m.n1, m.n2, a.theta);
    const theta = t1 === null ? THETA_MAX : t1;
    return { theta1_deg: wholeDeg(theta), ...(c[0] < 0 ? { from: other } : {}) };
  }
  if (id === "exit_ray") {
    // Out of a slab the ray runs parallel to the incident one: its angle IS θ₁.
    const a = aim(c, false);
    return { theta1_deg: wholeDeg(a.theta), ...(c[0] < 0 ? { from: other } : {}) };
  }
  return null;
}

/** An index scrubbed `dx` logical units from `n0`. */
export function scrubIndex(n0: number, dx: number): number {
  return clamp(roundTo(n0 + Math.trunc(dx / STEP_UNITS) * 0.01, 2), N_MIN, N_MAX);
}

/** The English names the viewer's index is read back as (a Norwegian cast's own names are left alone). */
const ENGLISH = new Set(["air", "ice", "water", "oil", "acrylic", "glass", "crown glass", "flint glass", "diamond", "vacuum"]);

/** The name a medium takes at index n: the author's at the author's index, else the one n is known by (in English casts). */
export function nameAt(n: number, authored: { name?: string; n: number }): string {
  if (Math.abs(n - authored.n) < 0.005 && authored.name !== undefined) return authored.name;
  const english = authored.name === undefined || ENGLISH.has(authored.name.trim().toLowerCase());
  return (english ? mediumFor(n) : null) ?? "";
}

function indexPatch(which: 1 | 2, n: number, st: State): Record<string, unknown> {
  const a = which === 1 ? { name: st.authored.medium1, n: st.authored.n1 } : { name: st.authored.medium2, n: st.authored.n2 };
  return { [`n${which}`]: n, [`medium${which}`]: nameAt(n, a) };
}

function initState(scene: WidgetScene): State {
  const P = scene.params as RefractionParams;
  const m = readModel(P);
  return {
    authored: {
      medium1: typeof P.medium1 === "string" ? P.medium1 : (m.name1 ?? undefined),
      n1: m.n1,
      medium2: typeof P.medium2 === "string" ? P.medium2 : (m.name2 ?? undefined),
      n2: m.n2,
    },
  };
}

export function refractionWidget(): WidgetBody {
  return {
    live: true,
    parts: REFRACTION_PARTS,
    init: initState,
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const m = readModel(scene.params as RefractionParams);
      if (id === "n1_label") return { value: roundTo(m.n1, 2), label: "Refractive index n₁", min: N_MIN, max: N_MAX, step: 0.01 };
      if (id === "n2_label") return { value: roundTo(m.n2, 2), label: "Refractive index n₂", min: N_MIN, max: N_MAX, step: 0.01 };
      if (id === "theta1_label") return { value: roundTo(m.theta1, 1), label: "Angle of incidence θ₁ in degrees", min: 0, max: THETA_MAX, step: 1 };
      if (id === "theta2_label" && m.theta2 !== null) {
        // As far as a θ₁ can reach: 90° when light slows, the refraction of a grazing ray when it speeds up.
        const top = m.n1 < m.n2 ? Math.floor(deg(Math.asin(m.n1 / m.n2)) * 10) / 10 : THETA_MAX;
        return { value: roundTo(m.theta2, 1), label: "Angle of refraction θ₂ in degrees", min: 0, max: top, step: 1 };
      }
      return null;
    },
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw as State | undefined) ?? initState(scene);
      const P = scene.params as RefractionParams;
      const none = { state, effects: [] };
      if (event.type === "input") {
        const m = readModel(P);
        const v = event.value;
        if (!Number.isFinite(v)) return none;
        if (event.id === "n1_label") return { state, effects: [{ patch: indexPatch(1, clamp(roundTo(v, 2), N_MIN, N_MAX), state) }] };
        if (event.id === "n2_label") return { state, effects: [{ patch: indexPatch(2, clamp(roundTo(v, 2), N_MIN, N_MAX), state) }] };
        if (event.id === "theta1_label") return { state, effects: [{ patch: { theta1_deg: clamp(roundTo(v, 1), 0, THETA_MAX) } }] };
        if (event.id === "theta2_label") {
          const t1 = incidenceFor(m.n1, m.n2, clamp(v, 0, 90));
          return t1 === null ? none : { state, effects: [{ patch: { theta1_deg: clamp(roundTo(t1, 1), 0, THETA_MAX) } }] };
        }
        return none;
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      const from = event.fromDomain ?? event.from;
      const to = event.domain ?? event.point;
      if (!from || !to) return none;
      // A number scrubs by the pointer's sideways travel on the page, as every scrub does.
      const dx = event.point[0] - (event.from ?? event.point)[0];
      const m = readModel(P);
      if (event.id === "n1_label" || event.id === "n2_label") {
        const which = event.id === "n1_label" ? 1 : 2;
        return { state, effects: [{ patch: indexPatch(which, scrubIndex(which === 1 ? m.n1 : m.n2, dx), state) }] };
      }
      if (event.id === "theta1_label") {
        return { state, effects: [{ patch: { theta1_deg: clamp(Math.round(m.theta1) + Math.trunc(dx / STEP_UNITS), 0, THETA_MAX) } }] };
      }
      if (event.id === "theta2_label" && m.theta2 !== null) {
        const t2 = clamp(Math.round(m.theta2) + Math.trunc(dx / STEP_UNITS), 0, 90);
        const t1 = incidenceFor(m.n1, m.n2, t2);
        return t1 === null ? none : { state, effects: [{ patch: { theta1_deg: clamp(roundTo(t1, 1), 0, THETA_MAX) } }] };
      }
      const patch = aimPatch(event.id, P, to);
      return patch ? { state, effects: [{ patch }] } : none;
    },
  };
}
