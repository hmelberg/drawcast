// plot3d's widget body: while the figure is paused the viewer turns the
// plot in their hands, and changes its parameters where they are drawn.
//
//   blank paper or the wireframe   drag: ORBITS — sideways turns the
//   over the plot (the surface)    azimuth, up/down tilts the elevation
//                                  (clamped short of straight down/up); the
//                                  paper under the hand moves with it
//   ctrl/⌘ + wheel or a pinch      zooms about the plot's centre (clamped)
//   over the plot
//   a number in the equation,      params-ui/controls.ts: drag sideways to
//   a panel value or box,          scrub, tap to type; a slider takes the
//   a slider's knob or track       value under the pointer
//   the "Reset view" pill          back to the camera the figure paused on
//
// There is no curve drag: in 3D a pointer names no single point on the
// surface worth solving for. Everything is a patch of azimuth_deg /
// elevation_deg / zoom / params — so the movie never sees it, and an
// `animate` of any of them still plays as written.
import type { BBox } from "../../layout/geometry";
import type { Pt } from "../../layout/model";
import { SURFACE_PART, type EditField, type WidgetBody, type WidgetEvent, type WidgetScene } from "../widget-types";
import { controlDragValue, controlField, controlParts, controlTarget } from "../params-ui/controls";
import { clampTo, withValue } from "../params-ui/params";
import { clampElevation, clampZoom, readModel, type Plot3dParams } from "./model";

/** Degrees of orbit per logical unit the pointer travels (a drag across the plot turns it ~200°). */
export const ORBIT_DEG_PER_UNIT = 0.4;
/** How far outside its drawn ink the plot's paper reaches for an orbit. */
export const SURFACE_PAD = 40;

/** The camera a figure shows: its three live numbers, the template defaults filled in. */
export function cameraOf(P: Plot3dParams): { azimuth: number; elevation: number; zoom: number } {
  const c = readModel(P).camera;
  return { azimuth: c.azimuth, elevation: c.elevation, zoom: c.zoom };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The orbit a drag from `from` to `to` (logical, y-up) makes, from the
 * press-time camera: the front of the plot follows the hand — right turns
 * it right (azimuth down), down tilts its top toward the viewer (elevation
 * up).
 */
export function orbitPatch(P: Plot3dParams, from: Pt, to: Pt): Record<string, unknown> {
  const c = cameraOf(P);
  return {
    azimuth_deg: round1(c.azimuth - (to[0] - from[0]) * ORBIT_DEG_PER_UNIT),
    elevation_deg: round1(clampElevation(c.elevation - (to[1] - from[1]) * ORBIT_DEG_PER_UNIT)),
  };
}

/** The zoom a wheel step or pinch of `factor` (> 1 in) makes. */
export function zoomPatch(P: Plot3dParams, factor: number): Record<string, unknown> {
  if (!(factor > 0) || !Number.isFinite(factor)) return {};
  return { zoom: Math.round(clampZoom(cameraOf(P).zoom * factor) * 1000) / 1000 };
}

/** The ids of the plot itself (not its equation, panel or title). */
const PLOT_ID = /^(axis_[xyz](_label)?|wire_(row|col)_\d+|curve|pt_\d+|pt_label_\d+|mark_\d+|mark_label_\d+)$/;

/** The plot's paper, logical y-up: its drawn ink, padded, kept off the equation and the panel. */
export function plotSurface(scene: WidgetScene): BBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [id, b] of scene.boxes) {
    if (!PLOT_ID.test(id)) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  x0 -= SURFACE_PAD;
  y0 -= SURFACE_PAD;
  x1 += SURFACE_PAD;
  y1 += SURFACE_PAD;
  // The equation above and the panel beside are their own parts' — the paper stops short of them.
  for (const [id, b] of scene.boxes) {
    if (id === "eq" || id.startsWith("eq_param_")) y1 = Math.min(y1, b.y - 6);
    else if (/^(name|value|slider|knob|box)_/.test(id)) x1 = Math.min(x1, b.x - 12);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

interface State {
  /** The camera the figure paused on — what the Reset pill goes back to. */
  rest: { azimuth_deg?: number; elevation_deg?: number; zoom?: number };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function plot3dWidget(): WidgetBody {
  return {
    live: true,
    restLabel: "Reset view",
    parts: (scene: WidgetScene) => controlParts(scene.ids, readModel(scene.params as Plot3dParams)),
    init: (scene: WidgetScene): State => {
      const P = scene.params as Plot3dParams;
      return { rest: { azimuth_deg: num(P.azimuth_deg), elevation_deg: num(P.elevation_deg), zoom: num(P.zoom) } };
    },
    surface: plotSurface,
    rest(scene: WidgetScene, raw: unknown) {
      const state = raw as State | undefined;
      if (!state) return null;
      const now = cameraOf(scene.params as Plot3dParams);
      const then = cameraOf(state.rest as Plot3dParams);
      const same = Math.abs(now.azimuth - then.azimuth) < 1e-6 && Math.abs(now.elevation - then.elevation) < 1e-6 && Math.abs(now.zoom - then.zoom) < 1e-6;
      return same ? null : { azimuth_deg: state.rest.azimuth_deg, elevation_deg: state.rest.elevation_deg, zoom: state.rest.zoom };
    },
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const t = controlTarget(id, readModel(scene.params as Plot3dParams));
      return t ? controlField(t) : null;
    },
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      const P = scene.params as Plot3dParams;
      const none = { state, effects: [] };
      if (event.type === "zoom") {
        const patch = zoomPatch(P, event.factor);
        return Object.keys(patch).length > 0 ? { state, effects: [{ patch }] } : none;
      }
      if (event.type === "input") {
        const t = controlTarget(event.id, readModel(P));
        if (!t || t.kind !== "scrub" || !Number.isFinite(event.value)) return none;
        return { state, effects: [{ patch: { params: withValue(P.params, t.param.name, clampTo(event.value, t.param)) } }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      const from = event.from;
      if (!from) return none;
      if (event.id === SURFACE_PART) return { state, effects: [{ patch: orbitPatch(P, from, event.point) }] };
      const t = controlTarget(event.id, readModel(P));
      if (!t) return none;
      const r = controlDragValue(t, scene, from, event.point);
      return r ? { state, effects: [{ patch: { params: withValue(P.params, r.name, r.value) } }] } : none;
    },
  };
}
