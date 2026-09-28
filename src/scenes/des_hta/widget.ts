// des_hta's widget body: while the figure is paused the viewer works the
// model where its numbers are drawn, and all of it re-simulates live — the
// same patients (the seed is kept), so what moves is the model's answer,
// not the luck of the draw:
//
//   knob_hr            drag sideways: the intervention's hazard ratio, 0.01 a
//                      step (0–3); tap: type it
//   knob_cost          drag sideways: the treatment's cost a year (~1 % a step)
//   reseed             tap: new patients (the seed + 1)
//   the time cursor    drag the t pill, a dashed line, or anywhere on the
//                      lanes or the curves: time moves (the bars fill in, the
//                      curves draw to it)
//   event_label_<i>    drag sideways: the event's median (or rate, or scale)
//   event_shape_<i>    drag sideways: its Weibull (or Gompertz) shape
//   state_utility_<s>, state_cost_<s>   the state's QALY weight and cost a year
//   the "Reset model" pill             the author's model (and patients) back
//
// Re-simulating is ~1 ms for 1,000 patients × 2 (engine.ts), so a drag
// re-runs the whole simulation every frame at full size: no thinned-out
// preview to swap back on release.
//
// Every gesture is a patch of top-level params (`strategies`, `events`,
// `states`, `seed`, `t`). A drag maps (press point → pointer) onto the
// press-time params, so every frame is the whole gesture.
import type { BBox } from "../../layout/geometry";
import type { Pt } from "../../layout/model";
import { amountScrub, clamp, roundTo, roundToStep, scrubbed } from "../number-scrub";
import { SURFACE_PART, type EditField, type WidgetBody, type WidgetEvent, type WidgetScene } from "../widget-types";
import { shownHr, timeSpans, type Span } from "./layout";
import { slugify, type HtaEvent, type HtaParams, type HtaState } from "./model";

export const HR_STEP = 0.01;
export const HR_MAX = 3;
/** The cursor's parts: its dashed lines and its t pill. */
const CURSOR = /^cursor(_knob|_b|_curves)?$/;

type Target =
  | { kind: "hr"; value: number; key: string | null }
  | { kind: "cost"; value: number }
  | { kind: "event"; i: number; field: "median" | "rate" | "scale"; value: number }
  | { kind: "shape"; i: number; value: number; min: number }
  | { kind: "utility" | "state_cost"; i: number; value: number };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** An event's primary number: the one its label writes first. */
function primary(e: HtaEvent): { field: "median" | "rate" | "scale"; value: number } | null {
  const dist = e.dist ?? "exponential";
  if (dist === "piecewise") return null;
  if (num(e.median) && dist !== "gompertz") return { field: "median", value: e.median };
  if (dist === "weibull") return num(e.scale) ? { field: "scale", value: e.scale } : null;
  return num(e.rate) ? { field: "rate", value: e.rate } : null;
}

export function targetOf(id: string, P: HtaParams): Target | null {
  if (id === "knob_hr") {
    const h = shownHr(P);
    return h ? { kind: "hr", value: h.value, key: h.key } : null;
  }
  if (id === "knob_cost") {
    const c = P.strategies?.[1]?.cost;
    return num(c) ? { kind: "cost", value: c } : null;
  }
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^event_label_(\d+)$/))) {
    const i = Number(m[1]);
    const e = P.events?.[i];
    const p = e ? primary(e) : null;
    return p ? { kind: "event", i, ...p } : null;
  }
  if ((m = id.match(/^event_shape_(\d+)$/))) {
    const i = Number(m[1]);
    const e = P.events?.[i];
    if (!e || !num(e.shape) || (e.dist !== "weibull" && e.dist !== "gompertz")) return null;
    return { kind: "shape", i, value: e.shape, min: e.dist === "weibull" ? 0.1 : -Infinity };
  }
  if ((m = id.match(/^state_(utility|cost)_(.+)$/))) {
    const i = (P.states ?? []).findIndex((s) => slugify(s?.name ?? "") === m![2]);
    if (i < 0) return null;
    const s = P.states[i];
    return m[1] === "utility" ? { kind: "utility", i, value: num(s.utility) ? s.utility : 0 } : { kind: "state_cost", i, value: num(s.cost) ? s.cost : 0 };
  }
  return null;
}

function stepOf(t: Target): { step: number; lo: number; hi: number } {
  if (t.kind === "hr") return { step: HR_STEP, lo: 0, hi: HR_MAX };
  if (t.kind === "utility") return { step: 0.01, lo: -0.5, hi: 1 };
  if (t.kind === "shape") return { step: t.min > 0 ? 0.05 : 0.01, lo: t.min, hi: t.min > 0 ? 10 : 2 };
  if (t.kind === "event") {
    const { step } = amountScrub(t.value, t.field === "rate" ? 0.01 : 0.1);
    return { step, lo: step, hi: Infinity };
  }
  const { step, min } = amountScrub(t.value, 100);
  return { step, lo: min, hi: Infinity };
}

/** The value a sideways drag of dx sets. */
export function scrubTarget(t: Target, dx: number): number {
  const { step, lo, hi } = stepOf(t);
  return scrubbed(t.value, dx, step, lo, hi);
}

/** The patch that puts target t at v. */
export function patchFor(t: Target, v: number, P: HtaParams): Record<string, unknown> {
  if (t.kind === "hr" || t.kind === "cost") {
    const strategies = P.strategies.map((s, k) => {
      if (k !== 1) return s;
      if (t.kind === "cost") return { ...s, cost: v };
      if (t.key === null) return { ...s, hr: v };
      return { ...s, hr: { ...(s.hr as Record<string, number>), [t.key]: v } };
    });
    return { strategies };
  }
  if (t.kind === "event" || t.kind === "shape") {
    const events = P.events.map((e, i) => (i !== t.i ? e : t.kind === "shape" ? { ...e, shape: v } : { ...e, [t.field]: v }));
    return { events };
  }
  const states: HtaState[] = P.states.map((s, i) => (i !== t.i ? s : t.kind === "utility" ? { ...s, utility: v } : { ...s, cost: v }));
  return { states };
}

const LABELS: Record<Target["kind"], string> = {
  hr: "Hazard ratio",
  cost: "Treatment cost a year",
  event: "Event time",
  shape: "Shape",
  utility: "QALY weight",
  state_cost: "Cost a year",
};

/** A time step near a two-hundredth of the horizon: 0.1 for 10–20 years. */
export const timeStep = (H: number): number => {
  const raw = H / 200;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw - 1e-12) ?? raw;
};

/** The cursor's time under a page point (through the layout's frame), or null off the time axes. */
export function timeAtPoint(scene: WidgetScene, p: Pt): number | null {
  const P = scene.params as unknown as HtaParams;
  const d = scene.toDomain(p);
  const ts = timeSpans(P);
  if (!d || !ts || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) return null;
  const H = ts.horizon;
  // The frame is the first span: the point in layout units, then the span it is nearest.
  const f = ts.spans[0];
  const X = f.x0 + (d[0] / H) * (f.x1 - f.x0);
  const Y = f.y0 + d[1] * (f.y1 - f.y0);
  const away = (s: Span): number => Math.max(0, s.x0 - X, X - s.x1) + Math.max(0, s.y0 - Y, Y - s.y1);
  const best = ts.spans.reduce((a, s) => (away(s) < away(a) ? s : a));
  const t = ((X - best.x0) / (best.x1 - best.x0)) * H;
  return roundToStep(clamp(t, 0, H), timeStep(H));
}

/** What the widget may change of the model (the cursor `t` is not the model). */
const MODEL_KEYS = ["states", "events", "strategies", "seed"] as const;
const snapshot = (P: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(MODEL_KEYS.map((k) => [k, P[k]]));

export function htaParts(scene: WidgetScene): string[] {
  const P = scene.params as unknown as HtaParams;
  return scene.ids.filter((id) => CURSOR.test(id) || id === "reseed" || targetOf(id, P) !== null);
}

export function desHtaWidget(): WidgetBody {
  return {
    live: true,
    parts: htaParts,
    taps: (id: string) => id === "reseed",
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const t = targetOf(id, scene.params as unknown as HtaParams);
      if (!t) return null;
      const { step, lo, hi } = stepOf(t);
      return { value: t.value, label: LABELS[t.kind], ...(Number.isFinite(lo) ? { min: lo } : {}), ...(Number.isFinite(hi) ? { max: hi } : {}), step };
    },
    surface(scene: WidgetScene): BBox | null {
      const P = scene.params as unknown as HtaParams;
      const ts = timeSpans(P);
      if (!ts) return null;
      const H = ts.horizon;
      const f = ts.spans[0];
      const toDom = (X: number, Y: number): Pt => [((X - f.x0) / (f.x1 - f.x0)) * H, (Y - f.y0) / (f.y1 - f.y0)];
      const xs = ts.spans.flatMap((s) => [s.x0, s.x1]);
      const ys = ts.spans.flatMap((s) => [s.y0, s.y1]);
      const lo = scene.toLogical(toDom(Math.min(...xs), Math.min(...ys)));
      const hi = scene.toLogical(toDom(Math.max(...xs), Math.max(...ys)));
      if (![...lo, ...hi].every(Number.isFinite)) return null;
      return { x: Math.min(lo[0], hi[0]), y: Math.min(lo[1], hi[1]), w: Math.abs(hi[0] - lo[0]), h: Math.abs(hi[1] - lo[1]) };
    },
    // The author's model, for the Reset pill (moving time alone shows none).
    init: (scene: WidgetScene) => ({ original: snapshot(scene.params) }),
    restLabel: "Reset model",
    rest(scene: WidgetScene, raw: unknown) {
      const original = (raw as { original?: Record<string, unknown> } | null)?.original;
      if (!original) return null;
      const now = snapshot(scene.params);
      return MODEL_KEYS.every((k) => JSON.stringify(now[k] ?? null) === JSON.stringify(original[k] ?? null)) ? null : { ...original };
    },
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      const P = scene.params as unknown as HtaParams;
      const none = { state, effects: [] };
      if (event.type === "click") {
        if (event.id !== "reseed") return none;
        return { state, effects: [{ patch: { seed: (num(P.seed) ? Math.round(P.seed) : 1) + 1 } }, { caption: "New patients" }] };
      }
      if (event.type === "input") {
        const t = targetOf(event.id, P);
        if (!t || !Number.isFinite(event.value)) return none;
        const { lo, hi } = stepOf(t);
        return { state, effects: [{ patch: patchFor(t, clamp(roundTo(event.value, 6), lo, hi), P) }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      if (!event.from) return none;
      if (CURSOR.test(event.id) || event.id === SURFACE_PART) {
        const t = timeAtPoint(scene, event.point);
        return t === null ? none : { state, effects: [{ patch: { t } }] };
      }
      const t = targetOf(event.id, P);
      if (!t) return none;
      return { state, effects: [{ patch: patchFor(t, scrubTarget(t, event.point[0] - event.from[0]), P) }] };
    },
  };
}

