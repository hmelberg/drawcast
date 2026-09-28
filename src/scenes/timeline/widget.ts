// timeline's widget body: while paused, the viewer moves along time.
//
//   drag on the timeline (blank paper,   pans the view: the dates move, the
//   an event, an era)                    labels re-place and re-thin
//   ctrl/⌘ + wheel or a pinch            zooms the view about the pointer —
//                                        lower-priority events fade in as
//                                        room appears (layout.ts LOD)
//   a tap on an event                    passes through: its info card
//   the "Reset view" pill                back to the authored view
//
// The body works in the axis's own units (the layout's `frame`: calendar
// years on a linear axis, −log10(years ago) on log_ago), so pan and zoom
// are the same arithmetic on both scales; every patch is `view: {from, to}`
// as plain calendar years.
import type { BBox } from "../../layout/geometry";
import { SURFACE_PART, type WidgetBody, type WidgetEvent, type WidgetScene } from "../widget-types";
import { PRESENT, fromAxis, toAxis, type Scale } from "./dates";
import { dataExtent, layoutTimeline, viewOf, type TimelineParams } from "./layout";

/** The layout's frame at these params (remembered: surface() runs on every pointer move). */
let frameMemo: { key: string; frame: ReturnType<typeof layoutTimeline>["frame"] } | null = null;
function frameOf(p: TimelineParams): ReturnType<typeof layoutTimeline>["frame"] {
  const key = JSON.stringify(p);
  if (frameMemo?.key !== key) frameMemo = { key, frame: layoutTimeline(p).frame };
  return frameMemo.frame;
}

type Range = [number, number];

const P = (scene: WidgetScene): TimelineParams => scene.params as unknown as TimelineParams;
const scaleOf = (p: TimelineParams): Scale => (p.scale === "log_ago" ? "log_ago" : "linear");
const presentOf = (p: TimelineParams): number => (typeof p.present === "number" ? p.present : PRESENT);

/** The view in axis units. */
export function axisView(p: TimelineParams): Range {
  const [a, b] = viewOf(p);
  return [toAxis(scaleOf(p), a, presentOf(p)), toAxis(scaleOf(p), b, presentOf(p))];
}

/** How far the viewer may go: the data extent widened, and a floor on the span. */
function limits(p: TimelineParams): { lo: number; hi: number; minSpan: number } {
  const s = scaleOf(p);
  const [d0, d1] = dataExtent(p);
  const u0 = toAxis(s, d0, presentOf(p));
  const u1 = toAxis(s, d1, presentOf(p));
  const span = u1 - u0;
  const hi = s === "log_ago" ? 0 : u1 + span * 0.5; // log: never past one year ago
  return { lo: u0 - span * 0.5, hi, minSpan: s === "log_ago" ? 0.05 : 1 / 12 };
}

function clampView([a, b]: Range, p: TimelineParams): Range {
  const { lo, hi, minSpan } = limits(p);
  let span = Math.max(minSpan, Math.min(b - a, hi - lo));
  let x0 = a + (b - a - span) / 2;
  if (x0 < lo) x0 = lo;
  if (x0 + span > hi) x0 = hi - span;
  span = Math.max(minSpan, span);
  return [x0, x0 + span];
}

/** A view patch from axis units, rounded so it reads cleanly. */
export function viewPatch(p: TimelineParams, u: Range): Record<string, unknown> {
  const s = scaleOf(p);
  const [a, b] = clampView(u, p);
  const y0 = fromAxis(s, a, presentOf(p));
  const y1 = fromAxis(s, b, presentOf(p));
  const tidy = (y: number, span: number): number => {
    const step = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, span))) - 2);
    return Math.round(y / step) * step;
  };
  const span = Math.abs(y1 - y0);
  return { view: { from: tidy(y0, span), to: tidy(y1, span) } };
}

interface State {
  authored: TimelineParams["view"] | undefined;
  moved: boolean;
}

export function timelineWidget(): WidgetBody {
  return {
    live: true,
    // No part is grabbed: a press anywhere on the timeline is the pan, and a
    // tap goes on to the event's card.
    parts: [],
    restLabel: "Reset view",
    init: (scene: WidgetScene): State => ({ authored: P(scene).view ? { ...P(scene).view } : undefined, moved: false }),
    surface(scene: WidgetScene): BBox | null {
      // The whole band the timeline draws in: the layout's frame, mapped through any fit.
      const f = frameOf(P(scene));
      if (!f) return null;
      const a = scene.toLogical([f.x[0], f.y[0]]);
      const b = scene.toLogical([f.x[1], f.y[1]]);
      if (![...a, ...b].every(Number.isFinite)) return null;
      const x0 = Math.min(a[0], b[0]) - 30;
      const y0 = Math.min(a[1], b[1]);
      return { x: x0, y: y0, w: Math.abs(b[0] - a[0]) + 60, h: Math.abs(b[1] - a[1]) };
    },
    rest(scene: WidgetScene, raw: unknown) {
      const st = raw as State | undefined;
      if (!st?.moved) return null;
      const now = JSON.stringify(P(scene).view ?? null);
      if (now === JSON.stringify(st.authored ?? null)) return null;
      return { view: st.authored ?? null };
    },
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw ?? { authored: undefined, moved: false }) as State;
      const p = P(scene);
      if (event.type === "zoom") {
        if (!event.domain || !(event.factor > 0)) return { state, effects: [] };
        const [a, b] = axisView(p);
        const at = event.domain[0];
        const k = 1 / event.factor;
        return { state: { ...state, moved: true }, effects: [{ patch: viewPatch(p, [at + (a - at) * k, at + (b - at) * k]) }] };
      }
      if ((event.type === "drag_move" || event.type === "drag") && event.id === SURFACE_PART) {
        if (!event.fromDomain || !event.domain) return { state, effects: [] };
        const d = event.fromDomain[0] - event.domain[0];
        const [a, b] = axisView(p);
        return { state: { ...state, moved: true }, effects: [{ patch: viewPatch(p, [a + d, b + d]) }] };
      }
      return { state, effects: [] };
    },
  };
}
