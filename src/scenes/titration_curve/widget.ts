// titration_curve's widget body: while the figure is paused the viewer runs
// the titration by hand and changes what is titrated, on the figure itself.
//
//   the curve, the cursor, its dot    drag sideways: the volume added (v)
//   or its readout                    follows the pointer; it catches at the
//                                     equivalence and half-way points
//   the burette                       drag down: more titrant runs in (v)
//   a half-equivalence point          drag up/down: the pKa (the buffer
//                                     plateau rides with it)
//   an equivalence point              drag sideways: how much analyte there
//                                     is (c_analyte) — more acid needs more base
//   a number above the plot           drag sideways to scrub, tap to type:
//                                     concentrations, the volume, the pKa
//   the indicator's band              drag up/down: the indicator whose range
//                                     is nearest (methyl orange … phenolphthalein)
//
// Every patch that changes the chemistry writes the axis's end back as
// v_max, so the axes stand still under the hand (widened only when an
// equivalence point would leave them). Free play only: nothing is judged.
import type { Pt } from "../../layout/model";
import { clamp, STEP_UNITS } from "../number-scrub";
import { niceCeil } from "../plot-axes";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { equivalenceVolumes, INDICATORS, isWeak, nearestIndicator } from "./chem";
import { BURETTE, legendId, legendPieces, type LegendPiece } from "./layout";
import { LIMITS, readModel, type Model, type TitrationParams } from "./model";

/** A press on the curve this near a point that rides it takes the point. */
export const POINT_GRAB = 18;
/** The cursor catches at a marked volume within this share of the axis. */
export const SNAP = 0.012;

const CURSOR_PARTS = ["cursor_dot", "cursor_label", "cursor"];

type Num = Extract<LegendPiece, { key: string }>;

/** The legend's numbers, by part id. */
function numbersOf(m: Model): Map<string, Num> {
  return new Map(legendPieces(m).flatMap((p) => ("key" in p ? [[legendId(p), p] as [string, Num]] : [])));
}

/** The drawn parts the viewer may take, in the order a tie goes. */
export function titrationParts(scene: WidgetScene): string[] {
  const m = readModel(scene.params as TitrationParams);
  const nums = m.numbers ? [...numbersOf(m).keys()] : [];
  const pts = scene.ids.filter((id) => /^(half_point|eq_point)(_\d+)?$/.test(id));
  const rest = ["burette", "burette_liquid", "burette_tip", "indicator_label", "curve", "compare_curve", "indicator_band"];
  return [...pts, "cursor_dot", "cursor_label", ...nums, "cursor", ...rest].filter((id) => scene.ids.includes(id));
}

const r = (v: number, places: number): number => Number(v.toFixed(places));

/** How a legend number scrubs: its step and bounds. */
function scrubOf(n: Num): { step: number; lo: number; hi: number; label: string } {
  if (n.key === "pka") return { step: 0.05, lo: LIMITS.pka[0], hi: LIMITS.pka[1], label: n.index ? `pKa${n.index + 1}` : "pKa" };
  if (n.key === "v_analyte") return { step: 1, lo: LIMITS.va[0], hi: LIMITS.va[1], label: "analyte volume (mL)" };
  return { step: n.decimals > 2 ? 0.001 : 0.01, lo: LIMITS.c[0], hi: LIMITS.c[1], label: n.key === "c_analyte" ? "analyte concentration (mol/L)" : "titrant concentration (mol/L)" };
}

/** The pKa list with entry i set to p — kept rising (a neighbour's 0.1 away at the closest). */
function withPka(P: TitrationParams, m: Model, i: number, p: number): number | number[] {
  const list = [...m.main.pkas];
  const lo = i > 0 ? list[i - 1] + 0.1 : LIMITS.pka[0];
  const hi = i < list.length - 1 ? list[i + 1] - 0.1 : LIMITS.pka[1];
  list[i] = r(clamp(p, lo, hi), 2);
  return Array.isArray(P.pka) ? list : list[0];
}

/** A patch that changes the chemistry: the axis kept as it is, widened only when an equivalence point would leave it. */
function chemPatch(P: TitrationParams, m: Model, patch: Record<string, unknown>): Record<string, unknown> {
  const next = readModel({ ...P, ...patch, v_max: m.vMax });
  const last = Math.max(...equivalenceVolumes(next.main), ...(next.compare ? equivalenceVolumes(next.compare) : []));
  const vMax = last > m.vMax * 0.97 ? niceCeil(last * 1.5) : m.vMax;
  return { ...patch, v_max: vMax };
}

/** The volume the cursor goes to for a pointer at volume x: caught by a marked volume near it. */
export function snapVolume(m: Model, x: number): number {
  const v = clamp(x, 0, m.vMax);
  const eqs = equivalenceVolumes(m.main);
  const marks = [...eqs, ...(isWeak(m.main.kind) ? m.main.pkas.map((_, i) => (i === 0 ? 0 : eqs[i - 1]) + eqs[0] / 2) : [])];
  for (const k of marks) if (Math.abs(k - v) <= SNAP * m.vMax) return r(k, 3);
  return r(v, 1);
}

/** The patch a drag of part `id` from `from` to `to` makes (logical points, and the same in mL / pH). */
export function dragPatch(id: string, scene: WidgetScene, from: Pt, to: Pt, fromD: Pt | null, toD: Pt | null): Record<string, unknown> | null {
  const P = scene.params as TitrationParams;
  const m = readModel(P);
  if (id.startsWith("burette")) {
    const box = scene.boxes.get("burette");
    const h = box ? box.h * ((BURETTE.top - 12 - BURETTE.bottom) / (BURETTE.top - BURETTE.bottom)) : BURETTE.top - BURETTE.bottom;
    return { v: snapVolume(m, (m.v ?? 0) + ((from[1] - to[1]) / h) * m.vMax) };
  }
  const n = numbersOf(m).get(id);
  if (n) {
    const s = scrubOf(n);
    // Whole steps from the value at the press, off the step's grid (4.76 stays …76).
    const steps = Math.trunc((to[0] - from[0]) / STEP_UNITS);
    return numberPatch(P, m, n, clamp(r(n.value + steps * s.step, 4), s.lo, s.hi));
  }
  if (!fromD || !toD) return null;
  if (CURSOR_PARTS.includes(id)) return { v: snapVolume(m, (m.v ?? fromD[0]) + (toD[0] - fromD[0])) };
  if (id === "curve" || id === "compare_curve") return { v: snapVolume(m, toD[0]) };
  let k: RegExpMatchArray | null;
  if ((k = id.match(/^half_point(?:_(\d+))?$/))) {
    const i = k[1] ? Number(k[1]) - 1 : 0;
    const p0 = m.main.pkas[i];
    if (p0 === undefined) return null;
    return { pka: withPka(P, m, i, p0 + (toD[1] - fromD[1])) };
  }
  if ((k = id.match(/^eq_point(?:_(\d+))?$/))) {
    const n = k[1] ? Number(k[1]) : 1;
    const ve = equivalenceVolumes(m.main)[n - 1];
    const target = clamp(ve + (toD[0] - fromD[0]), 0.05 * m.vMax, 0.95 * m.vMax);
    return chemPatch(P, m, { c_analyte: r(clamp((target * m.main.ct) / (n * m.main.va), LIMITS.c[0], LIMITS.c[1]), 4) });
  }
  if (id === "indicator_band" || id === "indicator_label") {
    const ind = m.indicator ?? INDICATORS.phenolphthalein;
    return { indicator: nearestIndicator((ind.lo + ind.hi) / 2 + (toD[1] - fromD[1])).name };
  }
  return null;
}

function numberPatch(P: TitrationParams, m: Model, n: Num, v: number): Record<string, unknown> {
  if (n.key === "pka") return { pka: withPka(P, m, n.index ?? 0, v) };
  return chemPatch(P, m, { [n.key]: v });
}

export function titrationWidget(): WidgetBody {
  return {
    live: true,
    parts: titrationParts,
    init: () => ({}),
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const n = numbersOf(readModel(scene.params as TitrationParams)).get(id);
      if (!n) return null;
      const s = scrubOf(n);
      return { value: n.value, label: s.label, min: s.lo, max: s.hi, step: s.step };
    },
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      const none = { state, effects: [] };
      const P = scene.params as TitrationParams;
      if (event.type === "input") {
        const m = readModel(P);
        const n = numbersOf(m).get(event.id);
        if (!n || !Number.isFinite(event.value)) return none;
        const s = scrubOf(n);
        return { state, effects: [{ patch: numberPatch(P, m, n, clamp(event.value, s.lo, s.hi)) }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      if (!event.from) return none;
      let id = event.id;
      // A press on the curve right at a marked point takes the point.
      if (id === "curve") {
        for (const p of scene.ids) {
          if (!/^(half_point|eq_point)(_\d+)?$/.test(p)) continue;
          const b = scene.boxes.get(p);
          if (b && Math.hypot(b.x + b.w / 2 - event.from[0], b.y + b.h / 2 - event.from[1]) <= POINT_GRAB) id = p;
        }
      }
      const patch = dragPatch(id, scene, event.from, event.point, event.fromDomain ?? null, event.domain);
      return patch ? { state, effects: [{ patch }] } : none;
    },
  };
}
