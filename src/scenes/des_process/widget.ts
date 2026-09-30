// des_process' widget body: while the figure is paused the viewer runs the
// clock and changes the process, and the simulation re-runs under the hand.
//
//   the clock ("t = 12 min")    drag sideways: time moves (tap: type a time)
//   the chart's cursor, or      drag: time follows the pointer
//   blank paper in a time chart
//   a source's rate             drag sideways: scrub it; tap: type it
//   a station's service time    drag sideways: scrub the mean (its spread
//                               scales with it); tap: type it
//   a CV readout ("CV 1.0")     drag sideways: scrub the variability (0
//                               regular, 1 random, more bursty); tap: type it
//   a branch's share ("30%")    drag sideways: scrub it, the node's other
//                               shares make room; tap: type it (%)
//   ⊖ ⊕ under the servers       tap: one server fewer / more
//   "new run"                   tap: the next seed — another run of the
//                               same process
//   the "Reset" pill            the author's process, back
//
// Pure like every body (widget-types.ts): each drag frame maps (press point
// → pointer) onto the press-time params. Free play only: the manifest
// carries no `widget` flag.
import type { BBox } from "../../layout/geometry";
import type { Pt } from "../../layout/model";
import { clamp, niceStep, rescaleShares, roundToStep, scrubbed } from "../number-scrub";
import { SURFACE_PART, type EditField, type WidgetBody, type WidgetEvent, type WidgetScene } from "../widget-types";
import { geometry, runOf, timeOf } from "./layout";
import { MAX_SERVERS, MAX_VARIABILITY, nodeSpecs, readModel, routeEntries, scaleDist, type DesParams, type NodeSpec } from "./model";

const RATE = /^rate_(.+)$/;
const SERVICE = /^service_(.+)$/;
const SHARE = /^share_(.+)$/;
const VAR = /^var_(.+)$/;
const ADD = /^add_(.+)$/;
const REMOVE = /^remove_(.+)$/;
const CURSOR = /^cursor(_2)?$/;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Every part the body works, in the order a tie goes. */
export function desParts(scene: WidgetScene): string[] {
  return scene.ids.filter((id) => id === "clock" || id === "reroll" || CURSOR.test(id) || RATE.test(id) || VAR.test(id) || SERVICE.test(id) || SHARE.test(id) || ADD.test(id) || REMOVE.test(id));
}

/** The node list with node `id` changed. */
function withNode(P: DesParams, id: string, change: (n: NodeSpec) => NodeSpec): NodeSpec[] | null {
  const list = Array.isArray(P.nodes) ? P.nodes : [];
  const i = list.findIndex((n) => n && n.id === id);
  if (i < 0) return null;
  return list.map((n, j) => (j === i ? change(n) : n));
}

/** A source's rate as the text shows it: arrivals per unit, or the gap between them. */
export function rateValue(n: NodeSpec): { key: "rate" | "every" | "interarrival" | "schedule"; value: number } | null {
  // A schedule reads (and scrubs) as its peak: every rate scales with it.
  if (n.schedule) {
    const m = readModel({ nodes: [{ ...n, id: "s" }], horizon: 1 }).nodes[0];
    if (m?.schedule) return { key: "schedule", value: Math.max(...m.schedule.rates) };
  }
  if (num(n.rate) && n.rate > 0) return { key: "rate", value: n.rate };
  if (num(n.every) && n.every > 0) return { key: "every", value: n.every };
  if (n.interarrival !== undefined) {
    const m = readModel({ nodes: [{ ...n, id: "s" }], horizon: 1 }).nodes[0];
    if (m?.inter) return { key: "interarrival", value: m.inter.mean };
  }
  return null;
}

/** The node with its rate (or gap) set to v. */
export function setRate(n: NodeSpec, v: number): NodeSpec {
  const r = rateValue(n);
  if (!r) return n;
  if (r.key === "interarrival") return { ...n, interarrival: scaleDist(n.interarrival, v / r.value) };
  if (r.key === "schedule") {
    const k = v / r.value;
    return { ...n, schedule: { ...n.schedule!, rates: n.schedule!.rates.map((x) => (num(x) ? Number((x * k).toFixed(4)) : x)) } };
  }
  return { ...n, [r.key]: v };
}

/** A station's (or delay's) mean time. */
export function serviceValue(n: NodeSpec): number | null {
  const m = readModel({ nodes: [{ ...n }], horizon: 1 }).nodes[0];
  return m?.service ? m.service.mean : null;
}

/** The node with its mean time set to v (its spread scaled with it). */
export function setService(n: NodeSpec, v: number): NodeSpec {
  const cur = serviceValue(n);
  if (cur === null) return n;
  const key = n.type === "delay" && n.time !== undefined ? "time" : "service";
  const spec = n[key] ?? 1;
  if (!(cur > 0)) return { ...n, [key]: v };
  return { ...n, [key]: scaleDist(spec, v / cur) };
}

/** A node's variability now: as set, else what its distribution has (1 for a plain rate). */
export function variabilityValue(n: NodeSpec): number | null {
  if (num(n.variability)) return clamp(n.variability, 0, MAX_VARIABILITY);
  const m = readModel({ nodes: [{ ...n, id: "s" }], horizon: 1 }).nodes[0];
  const d = n.type === "source" ? m?.inter : m?.service;
  return d ? Math.sqrt(d.cv2) : null;
}

/** The node with its variability set to v (0 – MAX_VARIABILITY, a tenth at a time). */
export function setVariability(n: NodeSpec, v: number): NodeSpec {
  return { ...n, variability: clamp(roundToStep(v, 0.1), 0, MAX_VARIABILITY) };
}

/** The share id's two ends, found among the node ids (ids may hold "_"). */
export function shareEnds(P: DesParams, rest: string): { from: string; to: string } | null {
  const specs = nodeSpecs(P);
  for (const a of specs) {
    if (!rest.startsWith(a.id + "_")) continue;
    const to = rest.slice(a.id.length + 1);
    if (specs.some((b) => b.id === to)) return { from: a.id, to };
  }
  return null;
}

/** The share from→to set to p (0–1); the node's other shares rescale to fill the rest. */
export function setShare(P: DesParams, from: string, to: string, p: number): NodeSpec[] | null {
  const specs = nodeSpecs(P);
  const i = specs.findIndex((n) => n.id === from);
  if (i < 0) return null;
  const entries = routeEntries(specs, i);
  const k = entries.findIndex(([id]) => id === to);
  if (k < 0 || entries.length < 2) return null;
  const v = clamp(roundToStep(p, 0.01), 0, 1);
  const others = rescaleShares(entries.filter((_, j) => j !== k).map(([, s]) => s), 1 - v, 2);
  const shares: Record<string, number> = {};
  let o = 0;
  entries.forEach(([id], j) => {
    shares[id] = j === k ? v : others[o++];
  });
  return withNode(P, from, (n) => ({ ...n, to: shares }));
}

/** The share from→to now. */
export function shareValue(P: DesParams, from: string, to: string): number | null {
  const specs = nodeSpecs(P);
  const i = specs.findIndex((n) => n.id === from);
  if (i < 0) return null;
  const entries = routeEntries(specs, i);
  const total = entries.reduce((a, [, s]) => a + s, 0);
  const e = entries.find(([id]) => id === to);
  return e && total > 0 ? e[1] / total : null;
}

/** A time step for scrubbing the clock: about a hundredth of the run, 1-2-5. */
export function timeStep(horizon: number): number {
  return niceStep(horizon, 0.01);
}

/** The painted page ↔ the layout's own coordinates, through the chart frame
 *  (a fitted page is scaled uniformly and shifted); identity with no chart. */
export function painter(scene: WidgetScene, P: DesParams): { toLayout: (p: Pt) => Pt; toPaint: (p: Pt) => Pt } {
  const same = { toLayout: (p: Pt): Pt => p, toPaint: (p: Pt): Pt => p };
  const m = readModel(P);
  const G = geometry(P, m);
  const c = G.charts.find((x) => x.of !== "wait_util") ?? G.charts[0];
  if (!c) return same;
  const a = scene.toLogical([0, 0]);
  const b = scene.toLogical([c.of === "wait_util" ? 100 : m.horizon, 0]);
  const k = (b[0] - a[0]) / (c.plot.x1 - c.plot.x0);
  if (![...a, ...b].every(Number.isFinite) || !(Math.abs(k) > 1e-9)) return same;
  return {
    toLayout: ([x, y]) => [c.plot.x0 + (x - a[0]) / k, c.plot.y0 + (y - a[1]) / k],
    toPaint: ([x, y]) => [a[0] + (x - c.plot.x0) * k, a[1] + (y - c.plot.y0) * k],
  };
}

/** The time a point in a time chart stands for, or null when it is in none. */
export function timeAtPoint(scene: WidgetScene, P: DesParams, p: Pt, clampIt = true): number | null {
  const m = readModel(P);
  const G = geometry(P, m);
  const q = painter(scene, P).toLayout(p);
  const charts = G.charts.filter((c) => c.of !== "wait_util");
  // The chart under the point, else the nearest one by x.
  let best: (typeof charts)[number] | null = null;
  let bd = Infinity;
  for (const c of charts) {
    const d = q[0] < c.plot.x0 ? c.plot.x0 - q[0] : q[0] > c.plot.x1 ? q[0] - c.plot.x1 : 0;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  if (!best) return null;
  const u = (q[0] - best.plot.x0) / (best.plot.x1 - best.plot.x0);
  const t = u * m.horizon;
  return clampIt ? clamp(roundToStep(t, timeStep(m.horizon)), 0, m.horizon) : t;
}

const PROCESS_KEYS = ["nodes", "seed"] as const;
interface State {
  said: string | null;
  original: Record<string, unknown>;
}
const snapshot = (P: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(PROCESS_KEYS.map((k) => [k, P[k]]));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The patch and caption a drag of part `id` from `from` to `to` (page points) makes. */
export function dragPatch(id: string, from: Pt, to: Pt, scene: WidgetScene): { patch: Record<string, unknown>; caption: string } | null {
  const P = scene.params as DesParams;
  const dx = to[0] - from[0];
  let mt: RegExpExecArray | null;
  if (id === "clock") {
    const m = readModel(P);
    const t0 = timeOf(P, m);
    return { patch: { t: scrubbed(t0, dx, timeStep(m.horizon), 0, m.horizon) }, caption: "Moving through time" };
  }
  if (CURSOR.test(id) || id === SURFACE_PART) {
    const t = timeAtPoint(scene, P, to);
    return t === null ? null : { patch: { t }, caption: "Moving through time" };
  }
  if ((mt = RATE.exec(id))) {
    const n = nodeSpecs(P).find((x) => x.id === mt![1]);
    const r = n && rateValue(n);
    if (!n || !r) return null;
    const v = scrubbed(r.value, dx, niceStep(r.value, 0.01), niceStep(r.value, 0.01), Infinity);
    const nodes = withNode(P, n.id, (x) => setRate(x, v));
    return nodes ? { patch: { nodes }, caption: r.key === "rate" || r.key === "schedule" ? "Changing the arrival rate" : "Changing the gap between arrivals" } : null;
  }
  if ((mt = VAR.exec(id))) {
    const n = nodeSpecs(P).find((x) => x.id === mt![1]);
    const v0 = n ? variabilityValue(n) : null;
    if (!n || v0 === null) return null;
    const nodes = withNode(P, n.id, (x) => setVariability(x, scrubbed(v0, dx, 0.1, 0, MAX_VARIABILITY)));
    return nodes ? { patch: { nodes }, caption: varCaption(n) } : null;
  }
  if ((mt = SERVICE.exec(id))) {
    const n = nodeSpecs(P).find((x) => x.id === mt![1]);
    const v0 = n ? serviceValue(n) : null;
    if (!n || v0 === null) return null;
    const step = niceStep(v0, 0.01);
    const v = scrubbed(v0, dx, step, step, Infinity);
    const nodes = withNode(P, n.id, (x) => setService(x, v));
    return nodes ? { patch: { nodes }, caption: n.type === "delay" ? "Changing the time spent" : "Changing the service time" } : null;
  }
  if ((mt = SHARE.exec(id))) {
    const ends = shareEnds(P, mt[1]);
    const p0 = ends ? shareValue(P, ends.from, ends.to) : null;
    if (!ends || p0 === null) return null;
    const nodes = setShare(P, ends.from, ends.to, scrubbed(p0, dx, 0.01, 0, 1));
    return nodes ? { patch: { nodes }, caption: "Changing the share" } : null;
  }
  return null;
}

const varCaption = (n: NodeSpec): string => (n.type === "source" ? "Changing how bursty arrivals are" : "Changing how much the time varies");

/** The patch a tap on part `id` makes. */
export function tapPatch(id: string, P: DesParams): { patch: Record<string, unknown>; caption: string } | null {
  let mt: RegExpExecArray | null;
  if (id === "reroll") return { patch: { seed: (num(P.seed) ? Math.round(P.seed) : 1) + 1 }, caption: "Another run" };
  if ((mt = ADD.exec(id)) || (mt = REMOVE.exec(id))) {
    const add = id.startsWith("add_");
    const n = nodeSpecs(P).find((x) => x.id === mt![1]);
    if (!n || n.type !== "station") return null;
    const c = num(n.servers) ? Math.round(n.servers) : 1;
    const next = clamp(c + (add ? 1 : -1), 1, MAX_SERVERS);
    if (next === c) return null;
    const nodes = withNode(P, n.id, (x) => ({ ...x, servers: next }));
    return nodes ? { patch: { nodes }, caption: add ? "One more server" : "One server fewer" } : null;
  }
  return null;
}

export function desWidget(): WidgetBody {
  return {
    live: true,
    parts: desParts,
    restLabel: "Reset process",
    init: (scene: WidgetScene): State => ({ said: null, original: snapshot(scene.params) }),
    taps: (id: string) => id === "reroll" || ADD.test(id) || REMOVE.test(id),
    surface(scene: WidgetScene): BBox | null {
      const P = scene.params as DesParams;
      const m = readModel(P);
      const G = geometry(P, m);
      const c = G.charts.find((x) => x.of !== "wait_util");
      if (!c || !scene.ids.includes(c.suffix ? "cursor_2" : "cursor")) return null;
      // The first time chart's plot, as painted.
      const { toPaint } = painter(scene, P);
      const lo = toPaint([c.plot.x0, c.plot.y0]);
      const hi = toPaint([c.plot.x1, c.plot.y1]);
      return { x: Math.min(lo[0], hi[0]), y: Math.min(lo[1], hi[1]), w: Math.abs(hi[0] - lo[0]), h: Math.abs(hi[1] - lo[1]) };
    },
    rest(scene: WidgetScene, raw: unknown) {
      const state = raw as State | undefined;
      if (!state) return null;
      const now = snapshot(scene.params);
      if (PROCESS_KEYS.every((k) => same(now[k], state.original[k]))) return null;
      return { ...state.original };
    },
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const P = scene.params as DesParams;
      let mt: RegExpExecArray | null;
      if (id === "clock") {
        const m = readModel(P);
        return { value: Number(timeOf(P, m).toFixed(2)), label: `Time (${m.unit})`, min: 0, max: m.horizon, step: timeStep(m.horizon) };
      }
      if ((mt = RATE.exec(id))) {
        const n = nodeSpecs(P).find((x) => x.id === mt![1]);
        const r = n && rateValue(n);
        const label = r?.key === "rate" ? `Arrivals per ${readModel(P).unit}` : r?.key === "schedule" ? `Peak arrivals per ${readModel(P).unit}` : `Time between arrivals (${readModel(P).unit})`;
        return r ? { value: r.value, label, min: 0.0001, step: niceStep(r.value, 0.01) } : null;
      }
      if ((mt = VAR.exec(id))) {
        const n = nodeSpecs(P).find((x) => x.id === mt![1]);
        const v = n ? variabilityValue(n) : null;
        return v !== null ? { value: v, label: n!.type === "source" ? "Variability of the gaps (CV: 0 regular, 1 random)" : "Variability of the times (CV)", min: 0, max: MAX_VARIABILITY, step: 0.1 } : null;
      }
      if ((mt = SERVICE.exec(id))) {
        const n = nodeSpecs(P).find((x) => x.id === mt![1]);
        const v = n ? serviceValue(n) : null;
        return v !== null ? { value: v, label: `Mean ${n!.type === "delay" ? "time" : "service time"} (${readModel(P).unit})`, min: 0, step: niceStep(v, 0.01) } : null;
      }
      if ((mt = SHARE.exec(id))) {
        const ends = shareEnds(P, mt[1]);
        const p = ends ? shareValue(P, ends.from, ends.to) : null;
        return p !== null ? { value: Math.round(p * 100), label: `Share from ${ends!.from} to ${ends!.to} (%)`, min: 0, max: 100, step: 1 } : null;
      }
      return null;
    },
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw ?? { said: null, original: snapshot(scene.params) }) as State;
      const P = scene.params as DesParams;
      const none = { state, effects: [] as unknown[] };
      const say = (r: { patch: Record<string, unknown>; caption: string } | null) => {
        if (!r) return none;
        const effects: Record<string, unknown>[] = [{ patch: r.patch }];
        if (r.caption !== state.said) effects.push({ caption: r.caption });
        return { state: { ...state, said: r.caption }, effects };
      };
      if (event.type === "click") return say(tapPatch(event.id, P));
      if (event.type === "input") {
        if (!Number.isFinite(event.value)) return none;
        let mt: RegExpExecArray | null;
        if (event.id === "clock") {
          const m = readModel(P);
          return say({ patch: { t: clamp(event.value, 0, m.horizon) }, caption: "Moving through time" });
        }
        if ((mt = RATE.exec(event.id)) && event.value > 0) {
          const nodes = withNode(P, mt[1], (x) => setRate(x, event.value));
          return say(nodes ? { patch: { nodes }, caption: "Changing the arrival rate" } : null);
        }
        if ((mt = VAR.exec(event.id)) && event.value >= 0) {
          const n = nodeSpecs(P).find((x) => x.id === mt![1]);
          const nodes = n ? withNode(P, n.id, (x) => setVariability(x, event.value)) : null;
          return say(nodes ? { patch: { nodes }, caption: varCaption(n!) } : null);
        }
        if ((mt = SERVICE.exec(event.id)) && event.value >= 0) {
          const nodes = withNode(P, mt[1], (x) => setService(x, event.value));
          return say(nodes ? { patch: { nodes }, caption: "Changing the service time" } : null);
        }
        if ((mt = SHARE.exec(event.id))) {
          const ends = shareEnds(P, mt[1]);
          const nodes = ends ? setShare(P, ends.from, ends.to, event.value / 100) : null;
          return say(nodes ? { patch: { nodes }, caption: "Changing the share" } : null);
        }
        return none;
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      if (!event.from) return none;
      return say(dragPatch(event.id, event.from, event.point, scene));
    },
  };
}

/** Warm the run for the params (the host's first frame is then a read). */
export const warm = (P: DesParams): void => void runOf(P);
