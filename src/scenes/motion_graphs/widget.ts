// motion_graphs' widget body: while the figure is paused the viewer takes
// hold of the graphs and the whole motion recomputes under the pointer —
// every graph, the object on its track, the shaded area, the readouts:
//
//   the time cursor, its handle     drag sideways: time moves; x, v and a are
//   (the "t = …" pill), or blank    read out at the new time, the object
//   paper in the panels             rides the track
//   a piece of the v(t) graph       drag up/down. Near its start or its end:
//                                   that corner's velocity moves (the piece's
//                                   acceleration changes; a joined neighbour
//                                   turns with it). In its middle: the whole
//                                   piece moves (its level; its slope stays)
//   a piece of the a(t) graph       drag up/down: that piece's acceleration
//   the x(t) graph                  drag up/down: the starting position x0
//   a number in the header          drag sideways to scrub, tap to type
//   the "Reset" pill                the author's motion, back
//
// Structure-derived: the template simply HAS these; no command asks for them.
// Pure like every body (widget-types.ts): each drag frame maps (press point →
// pointer) onto the press-time params, so every frame is the whole gesture.
// The pointer is read through the template's chart frame (the v panel, or
// the first panel), so a drag is exact under any fit of the page.
import type { BBox } from "../../layout/geometry";
import type { Pt } from "../../layout/model";
import { scrubbed } from "../number-scrub";
import { niceUp } from "../params-ui/params";
import { SURFACE_PART, type EditField, type WidgetBody, type WidgetEvent, type WidgetScene } from "../widget-types";
import { extents, framePanel, geometry, niceRange, numbersOf, resolveMotion, type Geometry, type Motion, type MotionParams, type NumberKey, type PanelKey, type Range, type SegmentSpec } from "./model";

/** The share of a v piece's duration, at either end, that moves that corner only. */
export const CORNER_ZONE = 0.3;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const decimalsOf = (step: number): number => Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
const roundStep = (v: number, step: number): number => Number((Math.round(v / step) * step).toFixed(decimalsOf(step)));
const r4 = (v: number): number => Number(v.toFixed(4));

/** The step a value of each panel moves by: a fiftieth of the range on screen, rounded 1-2-5. */
export function stepOf(g: Geometry, k: PanelKey): number {
  return niceUp((g.ranges[k][1] - g.ranges[k][0]) / 50);
}

/** The time step the cursor moves by. */
export const timeStep = (m: Motion): number => niceUp(m.T / 100);

/** A page point in the layout's own coordinates, through the chart frame. */
export function toLayout(scene: WidgetScene, g: Geometry, p: Pt): Pt | null {
  const d = scene.toDomain(p);
  if (!d || !d.every(Number.isFinite)) return null;
  const fp = framePanel(g);
  return [g.sx(d[0]), g.sy(fp.key, d[1])];
}

/** The pieces' start and end velocities written back in the author's own form. */
export function writeVelocities(P: MotionParams, m: Motion, S: number[], E: number[], vStep: number): Record<string, unknown> {
  const rv = (v: number): number => roundStep(v, vStep);
  if (!m.piecewise) {
    const d = m.segs[0].d;
    return { v0: rv(S[0]), a: r4((rv(E[0]) - rv(S[0])) / d) };
  }
  const patch: Record<string, unknown> = {};
  const specs = P.segments!;
  const segments = specs.map((spec, j) => {
    const k = m.segs.findIndex((s) => s.index === j);
    if (k < 0) return spec;
    const s = m.segs[k];
    const out: SegmentSpec = { ...spec };
    if (k === 0) {
      if (num(spec.v0)) out.v0 = rv(S[0]);
      else patch.v0 = rv(S[0]);
    } else if (s.explicitV0) out.v0 = rv(S[k]);
    if (num(spec.v1) && !num(spec.a)) out.v1 = rv(E[k]);
    else {
      out.a = r4((rv(E[k]) - rv(S[k])) / s.d);
      delete out.v1;
    }
    return out;
  });
  patch.segments = segments;
  return patch;
}

/** The patch a vertical drag of `dv` on v piece `index`, grabbed `u` of the way along it, makes. */
export function velocityPatch(P: MotionParams, index: number, u: number, dvRaw: number): Record<string, unknown> | null {
  const g = geometry(P);
  const m = g.motion;
  const k = m.segs.findIndex((s) => s.index === index);
  if (k < 0) return null;
  const step = stepOf(g, "v");
  const dv = roundStep(dvRaw, step);
  const S = m.segs.map((s) => s.v0);
  const E = m.segs.map((s) => s.v1);
  const start = u < 1 - CORNER_ZONE;
  const end = u > CORNER_ZONE;
  if (start) {
    S[k] += dv;
    if (k > 0 && !m.segs[k].explicitV0) E[k - 1] += dv;
  }
  if (end) {
    E[k] += dv;
    if (k + 1 < m.segs.length && !m.segs[k + 1].explicitV0) S[k + 1] += dv;
  }
  return writeVelocities(P, m, S, E, step);
}

/** The patch a vertical drag of `da` on a piece `index` makes: its acceleration. */
export function accelerationPatch(P: MotionParams, index: number, daRaw: number): Record<string, unknown> | null {
  const g = geometry(P);
  const m = g.motion;
  const k = m.segs.findIndex((s) => s.index === index);
  if (k < 0) return null;
  const step = stepOf(g, "a");
  const a = roundStep(m.segs[k].a + roundStep(daRaw, step), step);
  if (!m.piecewise) return { a };
  const segments = P.segments!.map((spec, j) => {
    if (j !== index) return spec;
    const out: SegmentSpec = { ...spec, a };
    delete out.v1;
    return out;
  });
  return { segments };
}

/** A header number's current value. */
export function numberValue(m: Motion, k: NumberKey): number {
  return k === "x0" ? m.x0 : k === "v0" ? m.segs[0].v0 : m.segs[0].a;
}

/** The patch that sets a header number. */
export function numberPatch(P: MotionParams, k: NumberKey, v: number): Record<string, unknown> {
  const m = resolveMotion(P);
  if (k === "x0") return { x0: v };
  if (k === "a") return m.piecewise ? {} : { a: v };
  if (m.piecewise && num(P.segments?.[0]?.v0)) return { segments: P.segments!.map((s, j) => (j === 0 ? { ...s, v0: v } : s)) };
  return { v0: v };
}

/**
 * The ranges to keep on screen with a patch: each range the author did not
 * set is written back as it is on screen, widened (to round ticks) only when
 * the new motion would leave it — so a drag never rescales the graph under
 * the hand unless it must.
 */
export function withRanges(P: MotionParams, patch: Record<string, unknown>, authored: Partial<Record<PanelKey, boolean>>): Record<string, unknown> {
  const shown = geometry(P).ranges;
  const next = resolveMotion({ ...P, ...patch } as MotionParams);
  const need = extents(next);
  const out = { ...patch };
  for (const k of ["x", "v", "a"] as PanelKey[]) {
    if (authored[k]) continue;
    const [lo, hi] = shown[k];
    const [nlo, nhi] = need[k];
    const fits = nlo >= lo - 1e-9 && nhi <= hi + 1e-9;
    const r: Range = fits ? [lo, hi] : niceRange(Math.min(lo, nlo), Math.max(hi, nhi), k === "a" ? 2 : 3, k !== "x");
    out[`${k}_range`] = r;
  }
  return out;
}

// The cursor is not the motion: moving time alone shows no Reset pill.
/** At a gesture's release: the held ranges go back to the automatic ones. */
export function settleRanges(patch: Record<string, unknown>, authored: Partial<Record<PanelKey, boolean>>): Record<string, unknown> {
  const out = { ...patch };
  for (const k of ["x", "v", "a"] as PanelKey[]) if (!authored[k] && `${k}_range` in out) out[`${k}_range`] = undefined;
  return out;
}

const MOTION_KEYS = ["x0", "v0", "a", "duration", "segments", "x_range", "v_range", "a_range"] as const;

interface State {
  said: string | null;
  /** Which ranges the author wrote (the widget never touches those). */
  authored: Partial<Record<PanelKey, boolean>>;
  /** The author's motion, for the Reset pill. */
  original: Record<string, unknown>;
}

const snapshot = (P: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(MOTION_KEYS.map((k) => [k, P[k]]));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What each named part does under a drag, in the order a tie goes. */
export function motionParts(scene: WidgetScene): string[] {
  const ids = scene.ids;
  return [
    "cursor_knob",
    ...ids.filter((id) => /^num_(x0|v0|a)$/.test(id)),
    "cursor",
    ...ids.filter((id) => /^v_seg_\d+$/.test(id)),
    ...ids.filter((id) => /^a_seg_\d+$/.test(id)),
    "curve_x",
  ].filter((id) => ids.includes(id));
}

/** The patch and caption a drag of part `id` from `from` to `to` (page points) makes. */
export function dragPatch(id: string, from: Pt, to: Pt, scene: WidgetScene, authored: Partial<Record<PanelKey, boolean>> = {}): { patch: Record<string, unknown>; caption: string } | null {
  const P = scene.params as MotionParams;
  const g = geometry(P);
  const m = g.motion;
  let n: RegExpMatchArray | null;
  if ((n = id.match(/^num_(x0|v0|a)$/))) {
    const k = n[1] as NumberKey;
    const panel: PanelKey = k === "x0" ? "x" : k === "v0" ? "v" : "a";
    const v = scrubbed(numberValue(m, k), to[0] - from[0], stepOf(g, panel));
    return { patch: withRanges(P, numberPatch(P, k, v), authored), caption: k === "a" ? "Changing the acceleration" : k === "v0" ? "Changing the starting velocity" : "Changing the starting position" };
  }
  const a = toLayout(scene, g, from);
  const b = toLayout(scene, g, to);
  if (!a || !b) return null;
  if (id === "cursor" || id === "cursor_knob" || id === SURFACE_PART) {
    const t = roundStep(Math.min(m.T, Math.max(0, g.tAt(b[0]))), timeStep(m));
    return { patch: { t }, caption: "Moving through time" };
  }
  if ((n = id.match(/^v_seg_(\d+)$/))) {
    const i = Number(n[1]);
    const s = m.segs.find((q) => q.index === i);
    if (!s) return null;
    const u = (g.tAt(a[0]) - s.t0) / s.d;
    const patch = velocityPatch(P, i, u, (b[1] - a[1]) / g.scale("v"));
    return patch ? { patch: withRanges(P, patch, authored), caption: "Changing the velocity" } : null;
  }
  if ((n = id.match(/^a_seg_(\d+)$/))) {
    const patch = accelerationPatch(P, Number(n[1]), (b[1] - a[1]) / g.scale("a"));
    return patch ? { patch: withRanges(P, patch, authored), caption: "Changing the acceleration" } : null;
  }
  if (id === "curve_x") {
    const x0 = roundStep(m.x0 + (b[1] - a[1]) / g.scale("x"), stepOf(g, "x"));
    return { patch: withRanges(P, { x0 }, authored), caption: "Changing the starting position" };
  }
  return null;
}

export function motionGraphsWidget(): WidgetBody {
  return {
    live: true,
    parts: motionParts,
    restLabel: "Reset motion",
    init: (scene: WidgetScene): State => {
      const P = scene.params as MotionParams;
      const valid = (r: unknown): boolean => Array.isArray(r) && r.length === 2 && num(r[0]) && num(r[1]) && r[1] > r[0];
      return { said: null, authored: { x: valid(P.x_range), v: valid(P.v_range), a: valid(P.a_range) }, original: snapshot(scene.params) };
    },
    surface(scene: WidgetScene): BBox | null {
      const g = geometry(scene.params as MotionParams);
      if ((scene.params as MotionParams).cursor === false) return null;
      const fp = framePanel(g);
      const toDom = (X: number, Y: number): Pt => [g.tAt(X), g.valueAt(fp.key, Y)];
      const lo = scene.toLogical(toDom(g.plotX0, g.bottom));
      const hi = scene.toLogical(toDom(g.plotX1, g.top));
      if (![...lo, ...hi].every(Number.isFinite)) return null;
      return { x: Math.min(lo[0], hi[0]), y: Math.min(lo[1], hi[1]), w: Math.abs(hi[0] - lo[0]), h: Math.abs(hi[1] - lo[1]) };
    },
    rest(scene: WidgetScene, raw: unknown) {
      const state = raw as State | undefined;
      if (!state) return null;
      const now = snapshot(scene.params);
      if (MOTION_KEYS.every((k) => same(now[k], state.original[k]))) return null;
      return { ...state.original };
    },
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const n = id.match(/^num_(x0|v0|a)$/);
      if (!n) return null;
      const P = scene.params as MotionParams;
      const g = geometry(P);
      const k = n[1] as NumberKey;
      if (!numbersOf(P, g.motion).includes(k)) return null;
      const label = k === "x0" ? "Starting position" : k === "v0" ? "Starting velocity" : "Acceleration";
      return { value: numberValue(g.motion, k), label, step: stepOf(g, k === "x0" ? "x" : k === "v0" ? "v" : "a") };
    },
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw ?? { said: null, authored: {}, original: snapshot(scene.params) }) as State;
      const P = scene.params as MotionParams;
      if (event.type === "input") {
        const n = event.id.match(/^num_(x0|v0|a)$/);
        if (!n || !Number.isFinite(event.value)) return { state, effects: [] };
        return { state, effects: [{ patch: settleRanges(withRanges(P, numberPatch(P, n[1] as NumberKey, event.value), state.authored), state.authored) }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return { state, effects: [] };
      if (!event.from) return { state, effects: [] };
      const r = dragPatch(event.id, event.from, event.point, scene, state.authored);
      if (!r) return { state, effects: [] };
      // Let go: the graphs the widget held still for the gesture are fitted
      // to the new motion (a range the author wrote stays as written).
      const patch = event.type === "drag" ? settleRanges(r.patch, state.authored) : r.patch;
      const effects: Record<string, unknown>[] = [{ patch }];
      if (r.caption !== state.said) effects.push({ caption: r.caption });
      return { state: { ...state, said: r.caption }, effects };
    },
  };
}
