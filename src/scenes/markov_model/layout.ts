// Deterministic layout for the markov_model scene: states as ellipses laid
// out by kit.layoutNodes (a ring for 3+ states, a horizontal pair for
// exactly 2; "chain" gives the classic textbook row for any count), sized
// down automatically when states crowd each other. Transition arrows bow
// when a reverse edge exists (so the pair never overlaps) AND whenever the
// straight chord would spear through another state's ellipse — the bow
// escalates until it clears, preferring the downward side so a chain row
// keeps its top air free. Self-loops are true loops (kit.edgeArrow
// selfLoop): both ends on the ellipse boundary, aimed into the state's
// widest angular gap between its incident transitions — never into the
// ring's interior — with an optional stay-probability caption. Absorbing
// states — no outgoing transition — render in plain ink instead of the
// normal accent stroke, the same "dead end" convention every health-econ
// Markov diagram leans on (transient states are colored, the terminal
// state fades to ink).

import {
  COLORS,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
  type StrokeDrawable,
} from "../../layout/model";
import type { LabelRequest, Side } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { kit } from "../kit";

export interface MarkovTransition {
  from: string;
  to: string;
  /** Transition probability/rate caption, e.g. "0.10". */
  label?: string;
}

/** A state that also "stays": a bare name, or {state, label} to caption the stay probability. */
export type MarkovSelfLoop = string | { state: string; label?: string };

export interface MarkovParams {
  /** 2–6 state names, in the order they should be laid out. */
  states: string[];
  transitions: MarkovTransition[];
  /** States that also have a "stay" probability — drawn with a small loop. */
  self_loops?: MarkovSelfLoop[];
  /** Node arrangement; default: "circle" for 3+ states, "chain" for exactly 2. */
  layout?: "circle" | "chain";
  /** One state name to highlight with a tinted halo. */
  highlight_state?: string;
  title?: string;
  /** Run the model: a cohort table beside the diagram (see MarkovTrace). */
  trace?: MarkovTrace;
  /**
   * What to draw: the state diagram (default), the transition "matrix" —
   * rows from, columns to, each cell a probability, the stay on the diagonal
   * derived as 1 − the row's exits — or "both". The matrix alone takes up to
   * 10 states, where a ring of circles stops reading; with it, `trace`'s
   * table runs full width under the matrix and so takes as many states too.
   */
  view?: "diagram" | "matrix" | "both";
}

/**
 * A cohort run through the model, drawn as a table right of the diagram:
 * how many are in each state year by year, what each state is worth (QALY
 * weight) and costs, the QALYs and cost each year yields, the discounted
 * lifetime totals, the average per person — and, with `compare`, the same for
 * a second option and the cost per QALY gained. Every number is COMPUTED from
 * the transition labels (read as probabilities; a state's stay is what its
 * arrows leave), so the narration can quote the table and never has to do the
 * arithmetic itself (Hans, 2026-09-26: "a table … which notes the number you
 * speak of (as you speak) … and how this is used to calculate utility each
 * year, total utility and finally average utility (and costs) so we can
 * compare two treatments").
 */
export interface MarkovTrace {
  /** Cohort size, all starting in the first state (default 1000). */
  start?: number;
  /** QALY weight of a year in each state, in `states` order (default 0). An
   *  array, not a map by name: a translated cast renames the states. */
  utility?: number[];
  /** Cost of a year in each state, in `states` order (default 0). */
  cost?: number[];
  /** Year rows shown under the start row (default 2, at most 4). */
  cycles?: number;
  /** Years the lifetime totals run (default 100). */
  horizon?: number;
  /** Annual discount rate for the totals (default 0.035). */
  discount?: number;
  /** Currency symbol (default "£"). */
  currency?: string;
  /** A second option: its name, the transitions it changes, and what it adds to a year's cost in each state. */
  compare?: { name: string; transitions?: MarkovTransition[]; cost?: number[] };
  /** With `compare`: the first option's name, labelling its per-person row (default "Current care"). */
  name?: string;
}

const BOX = { x: 140, y: 200, w: 720, h: 360 };
const RX = 78;
const RY = 44;
const REVERSE_CURVE = 0.18; // was 0.12: with edges now attaching where their own curve arrives, a little more bow gives a reverse pair air between the lines too (arrow round 2, 2026-09-17)
/** Min normalized clearance (1.0 = a state ellipse's own boundary) a transition path must keep from every OTHER state. */
const EDGE_CLEARANCE = 1.12;
/** Clear air between a probability label and the arrow (or loop) it names. */
const LABEL_GAP = 7;
const LABEL_FS = 20;
/** How far a self-loop reaches past its state's ellipse (kit.edgeArrow's default loop). */
const LOOP_REACH = 50;

/** lowercase, every non-alphanumeric character becomes "_" — deterministic element ids from arbitrary state names. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

const SIDE_VECS: [Side, [number, number]][] = [
  ["above", [0, 1]],
  ["below", [0, -1]],
  ["left", [-1, 0]],
  ["right", [1, 0]],
  ["above-left", [-0.75, 0.75]],
  ["above-right", [0.75, 0.75]],
  ["below-left", [-0.75, -0.75]],
  ["below-right", [0.75, -0.75]],
];

/** The compass side whose direction vector best matches (dx, dy). */
function nearestSide(dx: number, dy: number): Side {
  let best: Side = "above";
  let bestScore = -Infinity;
  for (const [side, [vx, vy]] of SIDE_VECS) {
    const score = dx * vx + dy * vy;
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}

/**
 * The widest circular gap between a state's incident-transition directions,
 * bisected — the least crowded direction to aim its self-loop. Ties (a
 * two-neighbor chain state has two equal half-circle gaps) prefer the
 * bisector closest to straight up, the textbook default. No incident
 * edges → straight up.
 */
function loopDirFor(dirs: Pt[]): Pt {
  if (dirs.length === 0) return [0, 1];
  const angles = dirs.map((v) => Math.atan2(v[1], v[0])).sort((a, b) => a - b);
  let bestMid = Math.PI / 2;
  let bestSize = -Infinity;
  for (let i = 0; i < angles.length; i++) {
    const a0 = angles[i];
    const a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
    const size = a1 - a0;
    const mid = (a0 + a1) / 2;
    if (size > bestSize + 1e-9 || (Math.abs(size - bestSize) <= 1e-9 && Math.sin(mid) > Math.sin(bestMid))) {
      bestSize = size;
      bestMid = mid;
    }
  }
  return [Math.cos(bestMid), Math.sin(bestMid)];
}

/** Sample the path edgeArrow would draw for this curve (untrimmed chord — the trimmed ends only hide inside their own endpoint states). */
function samplePath(from: Pt, to: Pt, curve: number): Pt[] {
  if (!curve) {
    const pts: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      pts.push([from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12]);
    }
    return pts;
  }
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const ux = (to[0] - from[0]) / len, uy = (to[1] - from[1]) / len;
  const mid: Pt = [(from[0] + to[0]) / 2 - uy * curve * len, (from[1] + to[1]) / 2 + ux * curve * len];
  return kit.smooth([from, mid, to], 10);
}

/**
 * The curve for one transition: the reverse-pair bow (or straight) when it
 * already clears every other state's ellipse, else the smallest escalated
 * bow that does. Plain edges may bow either way — downward-first, so a
 * chain row's long arcs pass under the row and leave the top air for
 * self-loops; reverse-pair members only escalate on their own sign (the
 * partner bows the opposite visual side because from/to are swapped).
 */
function chooseCurve(from: Pt, to: Pt, hasReverse: boolean, obstacles: Pt[], rx: number, ry: number): number {
  const clearance = (curve: number): number => {
    let min = Infinity;
    for (const p of samplePath(from, to, curve)) {
      for (const c of obstacles) {
        min = Math.min(min, Math.hypot((p[0] - c[0]) / rx, (p[1] - c[1]) / ry));
      }
    }
    return min;
  };
  const base = hasReverse ? REVERSE_CURVE : 0;
  if (obstacles.length === 0 || clearance(base) >= EDGE_CLEARANCE) return base;
  const ux = (to[0] - from[0]) / (Math.hypot(to[0] - from[0], to[1] - from[1]) || 1);
  // +curve offsets the midpoint along (-uy, ux); its y-component is ux — so
  // when ux > 0 a NEGATIVE curve bows downward.
  const downFirst = ux > 0 ? [-1, 1] : [1, -1];
  const candidates = hasReverse ? [0.2, 0.3] : [0.16, 0.24, 0.34].flatMap((m) => downFirst.map((s) => s * m));
  let bestCurve = base;
  let bestClear = clearance(base);
  for (const c of candidates) {
    const cl = clearance(c);
    if (cl >= EDGE_CLEARANCE) return c;
    if (cl > bestClear) {
      bestClear = cl;
      bestCurve = c;
    }
  }
  return bestCurve;
}

/**
 * The ellipse size for these positions: crowded arrangements (a 5–6 state
 * chain or ring) shrink every ellipse together so neighbors keep clear air;
 * roomy ones keep the full size.
 */
function stateSize(states: string[], positions: Record<string, Pt>): { rx: number; ry: number; font: number } {
  let minDist = Infinity;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = positions[states[i]], b = positions[states[j]];
      if (a && b) minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
  }
  const scale = Math.min(1, (0.44 * minDist) / RX);
  return { rx: RX * scale, ry: RY * scale, font: Math.max(20, Math.round(28 * scale)) };
}

/** Each state's incident-transition directions (unit vectors away from it). */
function incidentDirs(transitions: MarkovTransition[], positions: Record<string, Pt>): Map<string, Pt[]> {
  const incident = new Map<string, Pt[]>();
  for (const t of transitions) {
    const a = positions[t.from], b = positions[t.to];
    if (!a || !b || t.from === t.to) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    (incident.get(t.from) ?? incident.set(t.from, []).get(t.from)!).push(u);
    (incident.get(t.to) ?? incident.set(t.to, []).get(t.to)!).push([-u[0], -u[1]]);
  }
  return incident;
}

/**
 * Which side of an arrow its label goes: a bowed edge's CONVEX side — the
 * concave side is exactly where the state the bow swerved around (or the
 * reverse partner edge) sits; a straight edge perpendicular to itself at the
 * midpoint, upward-biased.
 */
function labelNormal(pts: Pt[]): Pt {
  const { at, tangent } = midway(pts);
  let n: Pt = [-tangent[1], tangent[0]];
  const chordMid: Pt = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
  const bulge = (at[0] - chordMid[0]) * n[0] + (at[1] - chordMid[1]) * n[1];
  if (Math.abs(bulge) > 3 ? bulge < 0 : n[1] < 0 || (n[1] === 0 && n[0] < 0)) n = [-n[0], -n[1]];
  return n;
}

/**
 * Halfway along a polyline by length, and the unit direction there. (The
 * middle POINT is not it: a straight arrow is two points, and its middle
 * index is its start — which put a straight arrow's label at its tail.)
 */
function midway(pts: Pt[]): { at: Pt; tangent: Pt } {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] > 0 && (left <= seg[i] || i === seg.length - 1)) {
      const f = Math.min(1, left / seg[i]);
      const [a, b] = [pts[i], pts[i + 1]];
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], tangent: [(b[0] - a[0]) / seg[i], (b[1] - a[1]) / seg[i]] };
    }
    left -= seg[i];
  }
  return { at: pts[0], tangent: [1, 0] };
}

/** Half the label's box (w/2, h/2) — the solver's own heuristic size. */
function labelHalf(text: string): [number, number] {
  return [kit.textWidth(text, LABEL_FS) / 2, (LABEL_FS * 1.25) / 2];
}

/**
 * A probability label standing LABEL_GAP off the point it names (an arrow's
 * midpoint, a loop's apex), out along `n`, on that side only. The solver
 * puts a label's box a ring (10 + 0.55 × font) beyond its anchor, so the
 * anchor is set back by exactly that: the first box it tries is the one
 * wanted. Keeping to one side, a crowded label steps further OUT, never
 * across its own arrow or along it to the far state, where it read as the
 * next arrow's number (Well→Sick's "0.10" beside Sick, 2026-09-27).
 */
function labelBeside(id: string, text: string, at: Pt, n: Pt, own: string): LabelRequest {
  const side = nearestSide(n[0], n[1]);
  const [dx, dy] = SIDE_VECS.find(([s]) => s === side)![1];
  const [a, b] = labelHalf(text);
  const t = LABEL_GAP + a * Math.abs(n[0]) + b * Math.abs(n[1]);
  const r0 = 10 + LABEL_FS * 0.55;
  const centre: Pt = [at[0] + n[0] * t, at[1] + n[1] * t];
  return {
    id,
    anchor: [centre[0] - dx * (r0 + (dx !== 0 ? a : 0)), centre[1] - dy * (r0 + (dy !== 0 ? b : 0))],
    side,
    sides: [side],
    text,
    fontSize: LABEL_FS,
    style: defaultStyle({ color: COLORS.guide }),
    drawOpts: defaultDrawOpts("instant"),
    ignore: [own],
  };
}

/** What the diagram inks at these positions — ellipses, arrows, loops and their labels — as a box. */
function diagramReach(states: string[], params: MarkovParams, positions: Record<string, Pt>): { x: number; y: number; w: number; h: number } {
  const { rx, ry } = stateSize(states, positions);
  const pts: Pt[] = [];
  for (const s of states) {
    const c = positions[s];
    if (c) pts.push([c[0] - rx, c[1] - ry], [c[0] + rx, c[1] + ry]);
  }
  const labelFar = (at: Pt, n: Pt, text: string) => {
    const [a, b] = labelHalf(text);
    const t = LABEL_GAP + 2 * (a * Math.abs(n[0]) + b * Math.abs(n[1]));
    pts.push([at[0] + n[0] * t, at[1] + n[1] * t]);
  };
  for (const t of params.transitions) {
    const from = positions[t.from], to = positions[t.to];
    if (!from || !to || t.from === t.to) continue;
    const hasReverse = params.transitions.some((o) => o.from === t.to && o.to === t.from);
    const obstacles = states.filter((s) => s !== t.from && s !== t.to).map((s) => positions[s]).filter(Boolean) as Pt[];
    const path = samplePath(from, to, chooseCurve(from, to, hasReverse, obstacles, rx, ry));
    pts.push(...path);
    if (t.label) labelFar(midway(path).at, labelNormal(path), t.label);
  }
  const incident = incidentDirs(params.transitions, positions);
  for (const e of params.self_loops ?? []) {
    const name = typeof e === "string" ? e : e.state;
    const c = positions[name];
    if (!c) continue;
    const d = loopDirFor(incident.get(name) ?? []);
    const bd = 1 / Math.hypot(d[0] / rx, d[1] / ry);
    const apex: Pt = [c[0] + d[0] * (bd + LOOP_REACH), c[1] + d[1] * (bd + LOOP_REACH)];
    pts.push(apex, [c[0] + d[0] * bd - d[1] * 30, c[1] + d[1] * bd + d[0] * 30], [c[0] + d[0] * bd + d[1] * 30, c[1] + d[1] * bd - d[0] * 30]);
    const label = typeof e === "string" ? undefined : e.label;
    if (label) labelFar(apex, d, label);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The diagram as large as fits `region`, loops and labels included: the
 * arrangement kit.layoutNodes gives, spread (or drawn in) about its centre
 * until what it inks fills the region, then centred there. The ellipses
 * keep their size; only the distances grow.
 */
function fitDiagram(states: string[], params: MarkovParams, style: "circle" | "chain", region: { x: number; y: number; w: number; h: number }): Record<string, Pt> {
  const unit = kit.layoutNodes(states, params.transitions, { style, x: -500, y: -500, w: 1000, h: 1000 });
  const at = (k: number): Record<string, Pt> => Object.fromEntries(Object.entries(unit).map(([s, p]) => [s, [p[0] * k, p[1] * k] as Pt]));
  const fits = (k: number) => {
    const r = diagramReach(states, params, at(k));
    return r.w <= region.w && r.h <= region.h;
  };
  let lo = 0.05, hi = 1.2;
  if (fits(hi)) lo = hi;
  else for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const pos = at(lo);
  const r = diagramReach(states, params, pos);
  const dx = region.x + region.w / 2 - (r.x + r.w / 2), dy = region.y + region.h / 2 - (r.y + r.h / 2);
  return Object.fromEntries(Object.entries(pos).map(([s, p]) => [s, [p[0] + dx, p[1] + dy] as Pt]));
}

/** The diagram's box when a trace table takes the right of the canvas. */
const TRACED_BOX = { x: 80, y: 250, w: 280, h: 300 };

/** States a diagram draws; the matrix alone takes more (a ring of 7+ circles stops reading). */
export const MAX_DIAGRAM_STATES = 6;
export const MAX_MATRIX_STATES = 10;
/** A cohort table BESIDE the diagram fits this many state columns; under a matrix it runs full width. */
export const MAX_TRACE_BESIDE = 4;

/**
 * The params with every numeric label written as text. A label is a string
 * ("0.10"), but an `animate` of "transitions.0.label" tweens it as a number
 * (render/params.ts reads "0.10" as its start), so mid-sweep and after it a
 * label may be 0.1234: written with two decimals, or as many as it needs up
 * to four. The same object back when nothing is numeric.
 */
export function withTextLabels(params: MarkovParams): MarkovParams {
  const text = (v: unknown): unknown => {
    if (typeof v !== "number" || !Number.isFinite(v)) return v;
    const r = Number(v.toFixed(4));
    return r.toFixed(Math.max(2, (String(r).split(".")[1] ?? "").length));
  };
  const fix = (ts: MarkovTransition[] | undefined): MarkovTransition[] | undefined =>
    ts && ts.some((t) => typeof t?.label === "number") ? ts.map((t) => ({ ...t, label: text(t.label) as string })) : ts;
  const loops = params.self_loops?.some((e) => typeof e === "object" && e !== null && typeof e.label === "number")
    ? params.self_loops.map((e) => (typeof e === "object" && e !== null ? { ...e, label: text(e.label) as string } : e))
    : params.self_loops;
  const transitions = fix(params.transitions);
  const cmp = params.trace?.compare;
  const cmpT = fix(cmp?.transitions);
  if (transitions === params.transitions && loops === params.self_loops && cmpT === cmp?.transitions) return params;
  return {
    ...params,
    ...(transitions ? { transitions } : {}),
    ...(loops ? { self_loops: loops } : {}),
    ...(cmp && cmpT !== cmp.transitions ? { trace: { ...params.trace, compare: { ...cmp, transitions: cmpT } } } : {}),
  };
}

export function layoutMarkovModel(raw: MarkovParams): SceneLayout {
  const params = withTextLabels(raw);
  const view = params.view === "matrix" || params.view === "both" ? params.view : "diagram";
  const showDiagram = view !== "matrix";
  const showMatrix = view !== "diagram";
  const states = params.states.slice(0, showDiagram ? MAX_DIAGRAM_STATES : MAX_MATRIX_STATES);
  const style = params.layout ?? (states.length >= 3 ? "circle" : "chain");
  const run = params.trace ? runTrace(states, params.transitions, params.trace, showMatrix ? MAX_MATRIX_STATES : MAX_TRACE_BESIDE) : null;
  // The page: the diagram's region, and where the matrix and the table go.
  const page = showMatrix ? pagePlan(states, params, run, showDiagram) : null;
  const positions: Record<string, Pt> = !showDiagram
    ? {}
    : page?.diagram
      ? fitDiagram(states, params, style, page.diagram)
      : kit.layoutNodes(states, params.transitions, { style, ...(run ? TRACED_BOX : BOX) });

  const { rx, ry, font: stateFont } = stateSize(states, positions);

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };

  // A state is absorbing when nothing leaves it — self-loops ("stay") don't
  // count as leaving, only entries in `transitions` do.
  const outgoing = new Set(params.transitions.map((t) => t.from));

  // Each state's incident-transition directions (both ends), for aiming its
  // self-loop into the widest free gap.
  const incident = incidentDirs(params.transitions, positions);

  (showDiagram ? states : []).forEach((name) => {
    const c = positions[name];
    if (!c) return;
    const slug = slugify(name);
    const stateId = `state_${slug}`;
    anchors[stateId] = c;

    if (params.highlight_state === name) {
      const hlId = `hl_${slug}`;
      push(kit.area(hlId, kit.ellipse(c, rx + 16, ry + 16), COLORS.accent));
      anchors[hlId] = c;
    }

    const absorbing = !outgoing.has(name);
    push(
      kit.stroke(stateId, kit.ellipse(c, rx, ry), {
        closed: true,
        color: absorbing ? COLORS.ink : COLORS.accent,
        strokeWidth: 3.5,
        ms: SKETCH_MS.node,
      }),
    );
    // ~1/3 of the ellipse's height — a small font reads thin against the
    // 3.5px halo stroke; this holds its own against it.
    push(kit.text(`state_label_${slug}`, c, name, { fontSize: stateFont }));
  });

  params.transitions.forEach((t, i) => {
    const from = positions[t.from];
    const to = positions[t.to];
    if (!from || !to) return;
    const hasReverse = params.transitions.some((o) => o.from === t.to && o.to === t.from);
    const obstacles = states.filter((s) => s !== t.from && s !== t.to).map((s) => positions[s]).filter(Boolean) as Pt[];
    const id = `t_${i}`;
    const { drawables: edgeDrawables } = kit.edgeArrow(id, from, to, {
      shorten: { ellipse: [rx, ry] },
      curve: chooseCurve(from, to, hasReverse, obstacles, rx, ry),
    });
    edgeDrawables.forEach(push);

    const mainStroke = edgeDrawables[0] as StrokeDrawable;
    const pts = mainStroke.pts;
    const mid = midway(pts).at;
    anchors[id] = mid;

    if (t.label) {
      const labelId = `t_label_${i}`;
      labels.push(labelBeside(labelId, t.label, mid, labelNormal(pts), id));
      order.push(labelId);
    }
  });

  (params.self_loops ?? []).forEach((entry) => {
    const name = typeof entry === "string" ? entry : entry.state;
    const stayLabel = typeof entry === "string" ? undefined : entry.label;
    const c = positions[name];
    if (!c) return;
    const slug = slugify(name);
    const id = `loop_${slug}`;
    const dir = loopDirFor(incident.get(name) ?? []);
    const { drawables: loopDrawables } = kit.edgeArrow(id, c, c, {
      selfLoop: true,
      loopDir: dir,
      shorten: { ellipse: [rx, ry] },
    });
    loopDrawables.forEach(push);
    const loopPts = (loopDrawables[0] as StrokeDrawable).pts;
    const apex = loopPts.reduce((best, p) =>
      Math.hypot(p[0] - c[0], p[1] - c[1]) > Math.hypot(best[0] - c[0], best[1] - c[1]) ? p : best,
    );
    anchors[id] = apex;
    if (stayLabel) {
      const labelId = `loop_label_${slug}`;
      labels.push(labelBeside(labelId, stayLabel, apex, dir, id));
      order.push(labelId);
    }
  });

  if (params.title) {
    push(kit.text("title", [run && !page ? 250 : 500, 650], params.title, { fontSize: 30 }));
  }

  const groups: Record<string, string[]> = {};
  if (page) page.matrix.draw(push, anchors, groups);
  if (run) traceTable(run, states, params.trace!, push, anchors, groups, page?.table ?? besideFrame(run, states, params.trace!));

  const values = markovValues(states, params, run);
  return {
    drawables,
    labels,
    anchors,
    order,
    ...(Object.keys(groups).length > 0 && { groups }),
    ...(Object.keys(values).length > 0 && { values }),
    ...(page?.world && { world: page.world }),
  };
}

/**
 * The model's numbers for `{markov.<key>}` tokens in a cast's drawn text
 * (SceneLayout.values) — recomputed on every layout, so they follow any
 * change to the params. Only keys meaningful for these params are present:
 *
 *   p_<from>_<to>          each transition's probability (slugs as in the ids)
 *   stay_<s>               a state's stay, 1 − its exits (the matrix diagonal)
 *   utility_<s>, cost_<s>  with trace.utility / trace.cost: a year in state s
 *   qalys_mean, cost_mean  with trace: per person, discounted, lifetime
 *   qalys_total, cost_total                the whole cohort's
 *   compare_p_<from>_<to>, compare_stay_<s>, compare_cost_<s>  with trace.compare
 *   compare_qalys_mean, compare_cost_mean  the second option per person
 *   qalys_gained, cost_added               compare − base, per person
 *   icer                   cost per QALY gained (only when QALYs are gained);
 *                          cost_per_qaly is the same number under its older name
 *
 * The result keys are set last, so a state named "Mean" cannot shadow cost_mean.
 */
function markovValues(states: string[], params: MarkovParams, run: CohortRun | null): Record<string, number> {
  const v: Record<string, number> = {};
  const put = (prefix: string, m: MatrixRead) => {
    params.transitions.forEach((t) => {
      const i = states.indexOf(t.from), j = states.indexOf(t.to);
      if (i >= 0 && j >= 0 && i !== j && m.explicit[i][j]) v[`${prefix}p_${slugify(t.from)}_${slugify(t.to)}`] = m.p[i][j];
    });
    states.forEach((s, i) => (v[`${prefix}stay_${slugify(s)}`] = m.p[i][i]));
  };
  const base = readMatrix(states, params.transitions);
  if (base.bad.length === 0) put("", base);
  const tr = params.trace;
  if (tr) {
    states.forEach((s, i) => {
      if (tr.utility) v[`utility_${slugify(s)}`] = tr.utility[i] ?? 0;
      if (tr.cost) v[`cost_${slugify(s)}`] = tr.cost[i] ?? 0;
    });
    if (tr.compare) {
      const cmp = readMatrix(states, compareTransitions(params.transitions, tr.compare.transitions));
      if (cmp.bad.length === 0) put("compare_", cmp);
      if (tr.compare.cost) states.forEach((s, i) => (v[`compare_cost_${slugify(s)}`] = (tr.cost?.[i] ?? 0) + (tr.compare!.cost![i] ?? 0)));
    }
  }
  if (run) {
    Object.assign(v, { qalys_total: run.total.qalys, cost_total: run.total.cost, qalys_mean: run.mean.qalys, cost_mean: run.mean.cost });
    if (run.compare) {
      const dq = run.compare.mean.qalys - run.mean.qalys, dc = run.compare.mean.cost - run.mean.cost;
      Object.assign(v, { compare_qalys_mean: run.compare.mean.qalys, compare_cost_mean: run.compare.mean.cost, qalys_gained: dq, cost_added: dc });
      if (dq > 0) v.icer = v.cost_per_qaly = dc / dq;
    }
  }
  return v;
}

/** The second option's transitions: the base list, each replaced by compare's entry for the same from/to. */
export function compareTransitions(base: MarkovTransition[], changes: MarkovTransition[] | undefined): MarkovTransition[] {
  return base.map((t) => changes?.find((o) => o.from === t.from && o.to === t.to) ?? t);
}

/**
 * What the author gave that the matrix and the trace cannot use — the
 * template's lint (SceneModule.lint, which layoutSpec reports as
 * `template-params`), errors for what would draw a wrong model, warnings for
 * what is silently left out.
 */
export function lintMarkovModel(raw: MarkovParams): { severity: "error" | "warn"; message: string }[] {
  if (!raw || !Array.isArray(raw.states) || !Array.isArray(raw.transitions)) return [];
  const params = withTextLabels(raw);
  const view = params.view === "matrix" || params.view === "both" ? params.view : "diagram";
  const out: { severity: "error" | "warn"; message: string }[] = [];
  const n = params.states.length;
  if (view !== "matrix" && n > MAX_DIAGRAM_STATES) {
    out.push({ severity: "warn", message: `the diagram draws ${MAX_DIAGRAM_STATES} states and ${n} were given — use view "matrix" for up to ${MAX_MATRIX_STATES}` });
  } else if (n > MAX_MATRIX_STATES) {
    out.push({ severity: "warn", message: `the matrix draws ${MAX_MATRIX_STATES} states and ${n} were given` });
  }
  const tr = params.trace;
  if (tr && view === "diagram" && n > MAX_TRACE_BESIDE) {
    out.push({ severity: "error", message: `trace beside the diagram fits ${MAX_TRACE_BESIDE} states and ${n} were given, so no table is drawn — use view "matrix" (or "both"), where the table runs full width` });
  }
  if (!tr && view === "diagram") return out;
  const states = params.states.slice(0, view === "matrix" ? MAX_MATRIX_STATES : MAX_DIAGRAM_STATES);
  const check = (transitions: MarkovTransition[], who: string) => {
    const m = readMatrix(states, transitions);
    for (const t of m.bad) {
      out.push({ severity: "error", message: `${who}transition ${t.from} → ${t.to} has label ${t.label === undefined ? "(none)" : JSON.stringify(t.label)} — the matrix and trace read labels as probabilities, a number from 0 to 1 like "0.10"` });
    }
    m.exits.forEach((sum, i) => {
      if (sum > 1 + 1e-9) out.push({ severity: "error", message: `${who}the transitions out of ${states[i]} add up to ${+sum.toFixed(4)} — more than 1, so its stay (1 − the rest) would be negative` });
    });
  };
  check(params.transitions, "");
  if (tr?.compare) {
    check(compareTransitions(params.transitions, tr.compare.transitions), `${tr.compare.name}: `);
    for (const c of tr.compare.transitions ?? []) {
      if (!params.transitions.some((t) => t.from === c.from && t.to === c.to)) {
        out.push({ severity: "warn", message: `trace.compare changes ${c.from} → ${c.to}, which is not in transitions — ignored (compare changes an existing transition's label)` });
      }
    }
  }
  for (const k of ["utility", "cost"] as const) {
    const a = tr?.[k];
    if (a && a.length !== n) out.push({ severity: "warn", message: `trace.${k} has ${a.length} entries for ${n} states (one per state, in states order; missing ones count 0)` });
  }
  return out;
}

/** A transition label read as a probability, or null. */
export function prob(label: string | undefined): number | null {
  if (label === undefined || label.trim() === "") return null;
  const v = Number(label.trim().replace(",", "."));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

export interface MatrixRead {
  /** p[i][j]: from state i to state j; the diagonal is 1 − the row's exits (negative when they exceed 1). */
  p: number[][];
  /** The label as the author wrote it, where a transition gives one (off-diagonal only). */
  label: (string | null)[][];
  /** True where a transition names the cell. */
  explicit: boolean[][];
  /** Each row's exits (off-diagonal sum). */
  exits: number[];
  /** Transitions whose label is not a probability. */
  bad: MarkovTransition[];
}

/** The transition matrix as far as it can be read — the lint reports what it cannot. */
export function readMatrix(states: string[], transitions: MarkovTransition[]): MatrixRead {
  const n = states.length;
  const p = states.map(() => states.map(() => 0));
  const label = states.map(() => states.map((): string | null => null));
  const explicit = states.map(() => states.map(() => false));
  const bad: MarkovTransition[] = [];
  for (const t of transitions) {
    const i = states.indexOf(t.from), j = states.indexOf(t.to);
    if (i < 0 || j < 0 || i === j) continue;
    const v = prob(t.label);
    explicit[i][j] = true;
    label[i][j] = t.label ?? null;
    if (v === null) bad.push(t);
    else p[i][j] = v;
  }
  const exits = p.map((row) => row.reduce((a, b) => a + b, 0));
  for (let i = 0; i < n; i++) p[i][i] = 1 - exits[i];
  return { p, label, explicit, exits, bad };
}

interface CohortRun {
  /** Counts per state: row 0 is the start, row k the end of year k. */
  rows: number[][];
  qalys: number[];
  costs: number[];
  total: { qalys: number; cost: number };
  mean: { qalys: number; cost: number };
  compare?: { name: string; mean: { qalys: number; cost: number } };
}

/** The transition matrix, or null when a label is not a probability or a state's arrows leave more than all of it. */
function matrix(states: string[], transitions: MarkovTransition[]): number[][] | null {
  const m = readMatrix(states, transitions);
  return m.bad.length === 0 && m.exits.every((x) => x <= 1 + 1e-9) ? m.p : null;
}

function cohort(states: string[], m: number[][], tr: MarkovTrace, extra: number[] = []): Omit<CohortRun, "compare"> {
  const n0 = tr.start ?? 1000;
  const horizon = Math.min(Math.max(tr.horizon ?? 100, 1), 500);
  const r = tr.discount ?? 0.035;
  const u = states.map((_, i) => tr.utility?.[i] ?? 0);
  const c = states.map((_, i) => (tr.cost?.[i] ?? 0) + (extra[i] ?? 0));
  let x = states.map((_, i) => (i === 0 ? n0 : 0));
  const rows = [x], qalys: number[] = [], costs: number[] = [];
  let tq = 0, tc = 0;
  for (let t = 1; t <= horizon; t++) {
    x = states.map((_, j) => x.reduce((sum, xi, i) => sum + xi * m[i][j], 0));
    const q = x.reduce((sum, xi, i) => sum + xi * u[i], 0);
    const k = x.reduce((sum, xi, i) => sum + xi * c[i], 0);
    // Year 1 undiscounted: the first year's QALYs are the ones the table shows.
    const f = 1 / Math.pow(1 + r, t - 1);
    tq += q * f;
    tc += k * f;
    if (t <= 4) {
      rows.push(x);
      qalys.push(q);
      costs.push(k);
    }
  }
  return { rows, qalys, costs, total: { qalys: tq, cost: tc }, mean: { qalys: tq / n0, cost: tc / n0 } };
}

function runTrace(states: string[], transitions: MarkovTransition[], tr: MarkovTrace, maxStates: number): CohortRun | null {
  if (states.length > maxStates) return null; // beside the diagram, more than four columns of counts do not fit
  const m = matrix(states, transitions);
  if (!m) return null;
  const base = cohort(states, m, tr);
  if (!tr.compare) return base;
  const m2 = matrix(states, compareTransitions(transitions, tr.compare.transitions));
  if (!m2) return base;
  return { ...base, compare: { name: tr.compare.name, mean: cohort(states, m2, tr, tr.compare.cost).mean } };
}

/** Thousands separated; money in the currency, a cohort's millions as "£1.39m". */
function fmtCount(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}
function fmtMoney(v: number, cur: string): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}${cur}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m`;
  if (a >= 1e4) return `${sign}${cur}${(Math.round(a / 100) * 100).toLocaleString("en-GB")}`;
  return `${sign}${cur}${Math.round(a).toLocaleString("en-GB")}`;
}
/** The step fmtMoney rounds an amount of this size to. */
function moneyStep(v: number): number {
  const a = Math.abs(v);
  return a >= 1e7 ? 1e5 : a >= 1e6 ? 1e4 : a >= 1e4 ? 100 : 1;
}
/** A difference written with its sign: "+1.26", "−£3,000". `abs` is the magnitude already written. */
function signed(abs: string, v: number): string {
  return v > 0 ? `+${abs}` : v < 0 ? `−${abs}` : abs;
}

/**
 * The per-person numbers the table WRITES, and the differences between the
 * written numbers — so "+1.26" is exactly 14.69 − 13.43 as printed, and the
 * extra cost exactly the difference of the two printed costs ("13.4 and
 * 14.7" once sat over "1.3 QALYs more", £28,200 and £49,800 over "£21,700",
 * 2026-09-27). QALYs per person to two decimals; both costs to the coarser
 * of their two rounding steps. The cost per QALY is the model's own
 * (unrounded) ratio to the nearest 100 — within rounding of the printed
 * difference over the printed gain.
 */
interface Shown {
  qm: number;
  cm: number;
  cmp: { qc: number; cc: number; dq: number; dc: number; icer: number | null; verdict: string | null } | null;
}
function shown(run: CohortRun): Shown {
  const q2 = (v: number) => Math.round(v * 100) / 100;
  const m = run.mean;
  if (!run.compare) return { qm: q2(m.qalys), cm: m.cost, cmp: null };
  const c = run.compare.mean;
  const step = Math.max(moneyStep(m.cost), moneyStep(c.cost));
  const k = (v: number) => Math.round(v / step) * step;
  const dq = c.qalys - m.qalys, dc = c.cost - m.cost;
  const icer = dq > 0 && dc >= 0 ? Math.round(dc / dq / 100) * 100 : null;
  const verdict =
    icer !== null
      ? null
      : dq > 0
        ? kit.say({ en: "Dominant: more QALYs for less", nb: "Dominerer: flere QALY for mindre" })
        : dc >= 0
          ? kit.say({ en: "Dominated: fewer QALYs for more", nb: "Dominert: færre QALY for mer" })
          : kit.say({ en: "Fewer QALYs for less", nb: "Færre QALY for mindre" });
  return { qm: q2(m.qalys), cm: k(m.cost), cmp: { qc: q2(c.qalys), cc: k(c.cost), dq: q2(q2(c.qalys) - q2(m.qalys)), dc: k(c.cost) - k(m.cost), icer, verdict } };
}

/** Column widths a matrix and a table share when one sits over the other. */
interface Cols {
  /** The row names. */
  labelW: number;
  /** One per state. */
  stateW: number;
  /** Between the states and the values. */
  gapX: number;
  /** The matrix's QALYs/yr over the table's QALYs. */
  qW: number;
  /** Cost/yr over Cost. */
  cW: number;
}
const maxCols = (a: Cols, b: Cols): Cols => ({
  labelW: Math.max(a.labelW, b.labelW),
  stateW: Math.max(a.stateW, b.stateW),
  gapX: Math.max(a.gapX, b.gapX),
  qW: Math.max(a.qW, b.qW),
  cW: Math.max(a.cW, b.cW),
});

/** Where the cohort table goes and the size of its type. */
interface TableFrame extends Omit<Cols, "stateW"> {
  x0: number;
  x1: number;
  /** The first row's centre line. */
  yTop: number;
  FS: number;
  ROW: number;
  /** The utility and cost rows — left out when the matrix shows them as columns. */
  inputs: boolean;
}

/** Floor for any text the matrix or the table shrinks (the lint's FONT_FLOOR). */
const MIN_FS = 14;

/** A font no bigger than `fs` that fits `text` in `w`, floored at MIN_FS. */
function fitFont(text: string, fs: number, w: number): number {
  const tw = kit.textWidth(text, fs);
  return tw <= w ? fs : Math.max(MIN_FS, (fs * w) / tw);
}

/** The words the table writes in its label column (and the tags it puts beside its totals). */
function tableWords(run: CohortRun, tr: MarkovTrace) {
  const r = tr.discount ?? 0.035;
  const pct = kit.num(Number((r * 100).toFixed(2)));
  return {
    start: "Start",
    year: (k: number) => `Year ${k}`,
    lifetime: "Lifetime",
    mean: run.compare ? tr.name ?? kit.say({ en: "Current care", nb: "Dagens behandling" }) : kit.say({ en: "Per person", nb: "Per person" }),
    perPerson: kit.say({ en: "per person", nb: "per person" }),
    discount: r > 0 ? kit.say({ en: `discounted ${pct}%`, nb: `diskontert ${pct} %` }) : kit.say({ en: "undiscounted", nb: "udiskontert" }),
    difference: kit.say({ en: "Difference", nb: "Forskjell" }),
    perQaly: kit.say({ en: "Per QALY gained", nb: "Per vunnet QALY" }),
  };
}

/**
 * The table, one drawable per row so a cast can write it in as it speaks:
 * trace_head, trace_utility, trace_cost (beside the diagram), trace_row_0
 * (the start) … trace_row_<cycles>, trace_gap (⋮ — the years go on),
 * trace_total with its trace_discount tag, trace_mean, and with compare
 * trace_compare, then the differences trace_icer_gain and trace_icer_cost
 * and trace_icer_ratio — grouped as trace_icer. Rules: trace_head_rule,
 * trace_rule_inputs (beside the diagram), trace_rule_total. With the matrix
 * on the page, its columns carry each state's utility and cost, and the
 * table leaves those rows out. Returns the lowest y it inks (a dry run draws
 * nothing: the page plan measures with it).
 */
function traceTable(
  run: CohortRun,
  states: string[],
  tr: MarkovTrace,
  push: (d: Drawable) => void,
  anchors: Record<string, Pt>,
  groups: Record<string, string[]>,
  frame: TableFrame,
): number {
  const { x0, x1, FS, ROW, labelW, gapX, qW, cW, inputs } = frame;
  const n = states.length;
  const cur = tr.currency ?? "£";
  const cycles = Math.min(Math.max(tr.cycles ?? 2, 1), 4);
  const words = tableWords(run, tr);
  const shownNums = shown(run);
  const stateW = (x1 - x0 - labelW - gapX - qW - cW) / n;
  const colX = [...states.map((_, i) => x0 + labelW + stateW * (i + 0.5)), x1 - cW - qW / 2, x1 - cW / 2];
  const LFS = Math.max(MIN_FS, FS - 4);
  const TFS = Math.max(MIN_FS, FS * 0.8);
  /** A small note right-aligned in a row's blank state columns, beside the numbers it qualifies. */
  const tag = (id: string, text: string, at: number) =>
    kit.text(id, [x0 + labelW + n * stateW - 6, at], text, { fontSize: fitFont(text, TFS, n * stateW - 10), anchor: "end", color: COLORS.guide });
  let y = frame.yTop;
  const rowOf = (id: string, label: string, cells: (string | null)[], o: { color?: string; fit?: boolean; extra?: Drawable[] } = {}) => {
    const kids: Drawable[] = [];
    kids.push(kit.text(`${id}__l`, [x0, y], label, { fontSize: LFS, anchor: "start", color: o.color ?? COLORS.guide }));
    cells.forEach((c, i) => {
      // A header's state name shrinks to its column (never the numbers: they are what the columns are sized for).
      const fs = o.fit && i < n ? fitFont(c ?? "", FS, stateW - 6) : FS;
      if (c !== null && c !== "") kids.push(kit.text(`${id}__c${i}`, [colX[i], y], c, { fontSize: fs, color: o.color ?? COLORS.ink }));
    });
    kids.push(...(o.extra ?? []));
    push(kit.group(id, kids));
    anchors[id] = [(x0 + x1) / 2, y];
    y -= ROW;
  };
  const rule = (id: string) => {
    push(kit.stroke(id, [[x0, y + ROW / 2], [x1, y + ROW / 2]], { color: COLORS.guide, strokeWidth: 1.5, ms: SKETCH_MS.guides }));
    anchors[id] = [(x0 + x1) / 2, y + ROW / 2];
    y -= Math.round(ROW * 0.216); // 8 at the table beside the diagram
  };
  const blank = states.map(() => null);

  rowOf("trace_head", "", [...states, "QALYs", "Cost"], { color: COLORS.ink, fit: true });
  rule("trace_head_rule");
  if (inputs) {
    rowOf("trace_utility", "QALYs/yr", [...states.map((_, i) => kit.num(tr.utility?.[i] ?? 0)), null, null], { color: COLORS.supply });
    rowOf("trace_cost", "Cost/yr", [...states.map((_, i) => fmtMoney(tr.cost?.[i] ?? 0, cur)), null, null], { color: COLORS.supply });
    rule("trace_rule_inputs");
    groups.trace_rule_1 = ["trace_rule_inputs"]; // its name before 2026-09-27
  }
  rowOf("trace_row_0", words.start, [...run.rows[0].map(fmtCount), null, null]);
  for (let k = 1; k <= cycles; k++) {
    rowOf(`trace_row_${k}`, words.year(k), [...run.rows[k].map(fmtCount), fmtCount(run.qalys[k - 1]), fmtMoney(run.costs[k - 1], cur)]);
  }
  // ⋮ under every column: the years the table does not show, which the lifetime totals add up.
  const gapH = ROW * 0.6;
  const yg = y + ROW / 2 - gapH / 2;
  const dotR = Math.max(1.5, FS * 0.075);
  push(
    kit.group(
      "trace_gap",
      colX.flatMap((x, i) => [-1, 0, 1].map((k) => kit.area(`trace_gap__${i}_${k + 1}`, kit.circle([x, yg + k * gapH * 0.27], dotR, 10), COLORS.guide, { precise: true }))),
    ),
  );
  anchors.trace_gap = [(x0 + x1) / 2, yg];
  y -= gapH;
  rule("trace_rule_total");
  groups.trace_rule_2 = ["trace_rule_total"]; // its name before 2026-09-27
  const yTotal = y;
  rowOf("trace_total", words.lifetime, [...blank, fmtCount(run.total.qalys), fmtMoney(run.total.cost, cur)]);
  push(tag("trace_discount", words.discount, yTotal));
  anchors.trace_discount = [x0 + labelW + n * stateW - 6, yTotal];
  const s = shownNums;
  const yMean = y;
  rowOf("trace_mean", words.mean, [...blank, kit.num(s.qm, 2), fmtMoney(s.cm, cur)], {
    color: COLORS.ink,
    extra: s.cmp ? [tag("trace_mean__tag", words.perPerson, yMean)] : [],
  });
  let low = y + ROW - FS * 0.6;
  if (run.compare && s.cmp) {
    const c = s.cmp;
    rowOf("trace_compare", run.compare.name, [...blank, kit.num(c.qc, 2), fmtMoney(c.cc, cur)], { color: COLORS.accent });
    const yd = y;
    push(
      kit.group("trace_icer_gain", [
        kit.text("trace_icer_gain__l", [x0, yd], words.difference, { fontSize: LFS, anchor: "start", color: COLORS.guide }),
        kit.text("trace_icer_gain__v", [colX[n], yd], signed(kit.num(Math.abs(c.dq), 2), c.dq), { fontSize: FS }),
      ]),
    );
    anchors.trace_icer_gain = [colX[n], yd];
    push(kit.text("trace_icer_cost", [colX[n + 1], yd], signed(fmtMoney(Math.abs(c.dc), cur), c.dc), { fontSize: FS }));
    anchors.trace_icer_cost = [colX[n + 1], yd];
    y -= ROW;
    const yr = y;
    push(
      kit.group(
        "trace_icer_ratio",
        c.icer !== null
          ? [
              kit.text("trace_icer_ratio__l", [x0, yr], words.perQaly, { fontSize: LFS, anchor: "start", color: COLORS.accent }),
              kit.text("trace_icer_ratio__v", [colX[n + 1], yr], fmtMoney(c.icer, cur), { fontSize: FS, color: COLORS.accent }),
            ]
          : [kit.text("trace_icer_ratio__v", [x0, yr], c.verdict ?? "", { fontSize: LFS, anchor: "start", color: COLORS.accent })],
      ),
    );
    anchors.trace_icer_ratio = c.icer !== null ? [colX[n + 1], yr] : [x0 + kit.textWidth(c.verdict ?? "", LFS) / 2, yr];
    groups.trace_icer = ["trace_icer_gain", "trace_icer_cost", "trace_icer_ratio"];
    anchors.trace_icer = [(x0 + x1) / 2, (yd + yr) / 2];
    low = yr - FS * 0.6;
  }
  return low;
}

/** The table's own column widths at font size FS (label text at FS − 4). */
function tableCols(run: CohortRun, states: string[], tr: MarkovTrace, FS: number, pad: number): Cols {
  const cur = tr.currency ?? "£";
  const w = (t: string, fs = FS) => kit.textWidth(t, fs);
  const words = tableWords(run, tr);
  const s = shown(run);
  const LFS = Math.max(MIN_FS, FS - 4);
  const TFS = Math.max(MIN_FS, FS * 0.8);
  const cycles = Math.min(Math.max(tr.cycles ?? 2, 1), 4);
  // The rows whose state columns hold something: the rest (the second
  // option, the differences) may run their names on into the blank cells.
  const labels = [words.start, words.year(cycles), words.lifetime, words.mean];
  const labelW = Math.max(...labels.map((l) => w(l, LFS))) + 16 * pad;
  // Sized by what the numbers COULD be, not what they are: scrubbing a
  // probability (or a cost) must not move a column — nor, the table's
  // columns being the matrix's, a cell of the matrix under the finger.
  const start = tr.start ?? 1000;
  const r = tr.discount ?? 0.035;
  const years = Math.min(Math.max(tr.horizon ?? 100, 1), 500);
  const lifetime = r > 0 ? (1 - Math.pow(1 + r, -years)) / (1 - 1 / (1 + r)) : years;
  const maxQalys = start * Math.max(1, ...(tr.utility ?? [])) * lifetime;
  const yearCost = Math.max(0, ...states.map((_, i) => Math.abs(tr.cost?.[i] ?? 0) + Math.abs(tr.compare?.cost?.[i] ?? 0)));
  // Every way fmtMoney may write an amount up to `bound` (£999,900 is wider than £1.20m).
  const money = (bound: number, sign = "") => [bound, 9999, 99_900, 999_900].filter((v) => v <= bound).map((v) => sign + fmtMoney(v, cur));
  const qTexts = ["QALYs", fmtCount(maxQalys), "+00.00"];
  const cTexts = ["Cost", ...money(start * yearCost), ...money(start * yearCost * lifetime), ...money(yearCost * lifetime, "+")];
  const qW = Math.max(...qTexts.map((t) => w(t))) + 22 * pad;
  const cW = Math.max(...cTexts.map((t) => w(t))) + 22 * pad;
  const numW = w(fmtCount(start)) + 16 * pad;
  const nameW = Math.max(...states.map((t) => w(t))) + 10 * pad;
  // The tags beside the totals need the state columns' width between them.
  const tagW = Math.max(w(words.discount, TFS), s.cmp ? w(words.perPerson, TFS) : 0) + 16 * pad;
  const stateW = Math.max(numW, Math.min(nameW, numW * 1.5), tagW / states.length);
  return { labelW, stateW, gapX: 16 * pad, qW, cW };
}

/** The table beside the diagram: the geometry `trace` has always had, its label column as wide as its words. */
function besideFrame(run: CohortRun, states: string[], tr: MarkovTrace): TableFrame {
  const own = tableCols(run, states, tr, 24, 0.75);
  return { x0: 420, x1: 990, yTop: 632, FS: 24, ROW: 35, labelW: Math.min(150, Math.max(100, own.labelW)), gapX: 0, qW: 88, cW: 108, inputs: true };
}

/** The table's frame at scale s under or beside a matrix — columns sized to what they hold, or to `force` — and its size. */
function tableFrame(run: CohortRun, states: string[], tr: MarkovTrace, s: number, force?: Cols): { frame: Omit<TableFrame, "x0" | "x1" | "yTop">; cols: Cols; w: number; h: number } {
  const FS = Math.max(MIN_FS + 2, 22 * s);
  const ROW = Math.max(32 * s, FS * 1.5);
  const own = tableCols(run, states, tr, FS, s);
  const c = force ?? own;
  // (A verdict in place of the ratio — "Dominant: …" — runs on across the blank cells.)
  const width = c.labelW + states.length * c.stateW + c.gapX + c.qW + c.cW;
  const frame = { FS, ROW, ...c, inputs: false };
  // Measure by a dry run: the rows the table will draw, from y = 0.
  const low = traceTable(run, states, tr, () => {}, {}, {}, { ...frame, x0: 0, x1: width, yTop: 0 });
  return { frame, cols: own, w: width, h: FS * 0.6 - low };
}

/** Transition-matrix geometry at one scale; `draw` places it with its top-left at (x0, yTop). */
interface MatrixPlan {
  w: number;
  h: number;
  /** Its own column widths (before any `force`). */
  cols: Cols;
  draw: (x0: number, yTop: number, push: (d: Drawable) => void, anchors: Record<string, Pt>, groups: Record<string, string[]>) => void;
}

/**
 * The transition matrix: a row per from-state, a column per to-state, each
 * cell its probability as the author wrote it; the diagonal — the stay — is
 * DERIVED (1 − the row's exits) and drawn so: grey on a light wash. Cells no
 * transition names hold a faint 0. With trace.utility / trace.cost, a column
 * each for what a year in the state is worth and costs. With trace.compare,
 * every cell the second option changes carries its value in the option's
 * colour under the base value (the stay it implies too, and its cost), and
 * the option's name keys that line in the first row it appears in. Every
 * row keeps room for that line, so the grid is evenly spaced before the
 * option is drawn as after.
 *
 * Ids — stable, by state slug, so a later widget can address one cell:
 *   matrix_cell_<from>_<to>, matrix_compare_<from>_<to>,
 *   matrix_head_row_<s>, matrix_head_col_<s>, matrix_utility_<s>,
 *   matrix_cost_<s>, matrix_compare_cost_<s>, matrix_head_utility,
 *   matrix_head_cost, matrix_corner, matrix_rule_head (over the states),
 *   matrix_rule_head_values (over QALYs/yr and Cost/yr), matrix_rule_from,
 *   matrix_rule_values, matrix_compare_name.
 * Sets: matrix (all but the compare layer), matrix_compare, matrix_stay,
 *   matrix_row_<s> (its name and probabilities: the row that sums to 1),
 *   matrix_values_<s> (its QALYs/yr and Cost/yr), matrix_values (both value
 *   columns, heads and rules), matrix_col_<s>.
 */
function planMatrix(states: string[], params: MarkovParams, s: number, force?: Cols): MatrixPlan {
  const n = states.length;
  const tr = params.trace;
  const cur = tr?.currency ?? "£";
  const base = readMatrix(states, params.transitions);
  const cmp = tr?.compare ? readMatrix(states, compareTransitions(params.transitions, tr.compare.transitions)) : null;
  // The stay is written to the precision of the labels it is derived from.
  const allLabels = [...base.label.flat(), ...(cmp?.label.flat() ?? [])].filter((l): l is string => l !== null);
  const decimals = Math.min(4, Math.max(1, ...allLabels.map((l) => (l.trim().split(/[.,]/)[1] ?? "").length)));
  const fmtP = (v: number): string => (Math.abs(v) < 1e-9 ? kit.num(0) : Math.abs(v - 1) < 1e-9 ? kit.num(1) : kit.num(Number(v.toFixed(decimals)), decimals).replace("-", "−"));
  const cellText = (i: number, j: number): string => (i === j ? fmtP(base.p[i][i]) : base.explicit[i][j] ? base.label[i][j] ?? "?" : kit.num(0));
  const cmpText = (i: number, j: number): string | null => {
    if (!cmp) return null;
    if (i === j) return Math.abs(cmp.p[i][i] - base.p[i][i]) > 1e-9 ? fmtP(cmp.p[i][i]) : null;
    return cmp.explicit[i][j] && cmp.label[i][j] !== base.label[i][j] ? cmp.label[i][j] ?? "?" : null;
  };
  const showU = !!tr?.utility;
  const showC = !!(tr?.cost || tr?.compare?.cost);
  const cmpCost = (i: number): string | null => {
    const add = tr?.compare?.cost?.[i] ?? 0;
    return add !== 0 ? fmtMoney((tr?.cost?.[i] ?? 0) + add, cur) : null;
  };
  const cells = states.map((_, i) => states.map((_, j) => cellText(i, j)));
  const cmps = states.map((_, i) => states.map((_, j) => cmpText(i, j)));
  const cmpCosts = states.map((_, i) => cmpCost(i));
  const anyCmp = cmps.flat().some((c) => c !== null) || cmpCosts.some((c) => c !== null);
  const cmpName = anyCmp && tr?.compare ? tr.compare.name : null;

  const FS = Math.max(MIN_FS + 2, 22 * s);
  const HFS = Math.max(MIN_FS + 1, 20 * s);
  const CFS = Math.max(MIN_FS, 19 * s);
  const cmpDrop = (FS + CFS) * 0.75; // clear of each other by the lint's own text boxes (1.25 em tall, 2 apart)
  // With a second option, every row has room for its line under the base
  // values (the pair then needs less air above and below than a lone line).
  const ROW = anyCmp ? Math.max(32 * s, FS * 1.3) : Math.max(40 * s, FS * 1.55);
  const rowH = anyCmp ? ROW + cmpDrop + 2 * s : ROW;
  const gridH = n * rowH;
  const HEAD = Math.max(46 * s, HFS * 1.9, Math.max(MIN_FS, 15 * s) * 2.9);
  const w = (t: string, fs: number) => kit.textWidth(t, fs);
  const headW0 = Math.max(w("from", MIN_FS) + w("to", MIN_FS) + 12, ...states.map((t) => w(t, HFS)), cmpName ? w(cmpName, CFS) : 0) + 24 * s;
  const numW = Math.max(56 * s, ...cells.flat().map((t) => w(t, FS)), ...cmps.flat().map((t) => (t ? w(t, CFS) : 0))) + 22 * s;
  const cellW0 = Math.max(numW, Math.min(Math.max(...states.map((t) => w(t, HFS))) + 12 * s, numW * 1.5));
  const uHead = "QALYs/yr", cHead = "Cost/yr";
  const uTexts = states.map((_, i) => kit.num(tr?.utility?.[i] ?? 0));
  const cTexts = states.map((_, i) => fmtMoney(tr?.cost?.[i] ?? 0, cur));
  const uW0 = showU ? Math.max(w(uHead, HFS), ...uTexts.map((t) => w(t, FS))) + 24 * s : 0;
  const cW0 = showC ? Math.max(w(cHead, HFS), ...cTexts.map((t) => w(t, FS)), ...cmpCosts.map((t) => (t ? w(t, CFS) : 0))) + 24 * s : 0;
  const own: Cols = { labelW: headW0, stateW: cellW0, gapX: showU || showC ? 16 * s : 0, qW: uW0, cW: cW0 };
  const { labelW: headW, stateW: cellW, gapX, qW: uW, cW } = force ?? own;
  const width = headW + n * cellW + gapX + uW + cW;
  const height = HEAD + gridH;

  const draw: MatrixPlan["draw"] = (x0, yTop, push, anchors, groups) => {
    const all: string[] = [];
    const layer: string[] = [];
    const rowSets = states.map((): string[] => []);
    const valueSets = states.map((): string[] => []);
    const colSets = states.map((): string[] => []);
    const values: string[] = [];
    const stay: string[] = [];
    const put = (d: Drawable, at: Pt, into: string[] = all) => {
      push(d);
      anchors[d.id] = at;
      into.push(d.id);
    };
    const gridX = x0 + headW;
    const gridEnd = gridX + n * cellW;
    const valuesX = gridEnd + gapX;
    const bottom = yTop - HEAD - gridH;
    const cx = (j: number) => gridX + cellW * (j + 0.5);
    const rule = (id: string, a: Pt, b: Pt) => put(kit.stroke(id, [a, b], { color: COLORS.guide, strokeWidth: 1.5, ms: SKETCH_MS.guides }), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);

    // The corner: a diagonal, "to" above it (the columns), "from" below (the rows).
    const cfs = Math.max(MIN_FS, 15 * s);
    put(
      kit.group("matrix_corner", [
        kit.stroke("matrix_corner__line", [[x0, yTop], [gridX, yTop - HEAD]], { color: COLORS.guide, strokeWidth: 1.2, ms: SKETCH_MS.guides }),
        kit.text("matrix_corner__to", [gridX - 6 * s, yTop - HEAD * 0.26], "to", { fontSize: cfs, anchor: "end", color: COLORS.guide }),
        kit.text("matrix_corner__from", [x0 + 4 * s, yTop - HEAD * 0.66], "from", { fontSize: cfs, anchor: "start", color: COLORS.guide }),
      ]),
      [x0 + headW / 2, yTop - HEAD / 2],
    );
    states.forEach((name, j) => {
      const id = `matrix_head_col_${slugify(name)}`;
      put(kit.text(id, [cx(j), yTop - HEAD / 2], name, { fontSize: fitFont(name, HFS, cellW - 8 * s) }), [cx(j), yTop - HEAD / 2]);
      colSets[j].push(id);
    });
    const uX = valuesX + uW / 2, cX = valuesX + uW + cW / 2;
    if (showU) {
      put(kit.text("matrix_head_utility", [uX, yTop - HEAD / 2], uHead, { fontSize: HFS }), [uX, yTop - HEAD / 2]);
      values.push("matrix_head_utility");
    }
    if (showC) {
      put(kit.text("matrix_head_cost", [cX, yTop - HEAD / 2], cHead, { fontSize: HFS }), [cX, yTop - HEAD / 2]);
      values.push("matrix_head_cost");
    }
    // The head rule in two: over the states, and over the value columns — drawn with them.
    const valuesOn = showU || showC;
    rule("matrix_rule_head", [x0, yTop - HEAD], [valuesOn ? gridEnd + gapX / 2 : gridEnd, yTop - HEAD]);
    rule("matrix_rule_from", [gridX, yTop], [gridX, bottom]);
    if (valuesOn) {
      rule("matrix_rule_head_values", [gridEnd + gapX / 2, yTop - HEAD], [x0 + width, yTop - HEAD]);
      rule("matrix_rule_values", [gridEnd + gapX / 2, yTop], [gridEnd + gapX / 2, bottom]);
      values.push("matrix_rule_head_values", "matrix_rule_values");
    }

    states.forEach((from, i) => {
      const fs = slugify(from);
      const rowTop = yTop - HEAD - i * rowH;
      const y = rowTop - ROW / 2;
      const yc = rowTop - ROW / 2 - cmpDrop;
      const headId = `matrix_head_row_${fs}`;
      put(kit.text(headId, [x0 + 6 * s, y], from, { fontSize: HFS, anchor: "start" }), [x0 + headW / 2, y]);
      rowSets[i].push(headId);
      states.forEach((to, j) => {
        const id = `matrix_cell_${fs}_${slugify(to)}`;
        const text = cells[i][j];
        if (i === j) {
          const inset = 4 * s;
          const shade = kit.area(`${id}__shade`, kit.rect(cx(j) - cellW / 2 + inset, rowTop - rowH + inset, cellW - 2 * inset, rowH - 2 * inset), COLORS.guide, { opacity: 0.13, precise: true });
          const color = base.p[i][i] < -1e-9 ? COLORS.demand : COLORS.guide;
          put(kit.group(id, [shade, kit.text(`${id}__v`, [cx(j), y], text, { fontSize: FS, color })]), [cx(j), y]);
          stay.push(id);
        } else if (base.explicit[i][j]) {
          const ok = prob(base.label[i][j] ?? undefined) !== null;
          put(kit.text(id, [cx(j), y], text, { fontSize: FS, color: ok ? COLORS.ink : COLORS.demand }), [cx(j), y]);
        } else {
          put(kit.text(id, [cx(j), y], text, { fontSize: FS, opacity: 0.35 }), [cx(j), y]);
        }
        rowSets[i].push(id);
        colSets[j].push(id);
        const c = cmps[i][j];
        if (c !== null) put(kit.text(`matrix_compare_${fs}_${slugify(to)}`, [cx(j), yc], c, { fontSize: CFS, color: COLORS.accent }), [cx(j), yc], layer);
      });
      if (showU) {
        put(kit.text(`matrix_utility_${fs}`, [uX, y], uTexts[i], { fontSize: FS, color: COLORS.supply }), [uX, y]);
        valueSets[i].push(`matrix_utility_${fs}`);
      }
      if (showC) {
        put(kit.text(`matrix_cost_${fs}`, [cX, y], cTexts[i], { fontSize: FS, color: COLORS.supply }), [cX, y]);
        valueSets[i].push(`matrix_cost_${fs}`);
        const c = cmpCosts[i];
        if (c !== null) put(kit.text(`matrix_compare_cost_${fs}`, [cX, yc], c, { fontSize: CFS, color: COLORS.accent }), [cX, yc], layer);
      }
    });
    if (cmpName) {
      // The key: the option's name heads its line of values, in the first row that has one.
      const i0 = states.findIndex((_, i) => cmps[i].some((c) => c !== null) || cmpCosts[i] !== null);
      const y = yTop - HEAD - i0 * rowH - ROW / 2 - cmpDrop;
      put(kit.text("matrix_compare_name", [x0 + 6 * s, y], cmpName, { fontSize: fitFont(cmpName, CFS, headW - 8 * s), anchor: "start", color: COLORS.accent }), [x0 + 6 * s, y], layer);
    }

    groups.matrix = all;
    if (layer.length) groups.matrix_compare = layer;
    groups.matrix_stay = stay;
    if (valuesOn) groups.matrix_values = [...values, ...valueSets.flat()];
    states.forEach((name, i) => {
      groups[`matrix_row_${slugify(name)}`] = rowSets[i];
      if (valueSets[i].length) groups[`matrix_values_${slugify(name)}`] = valueSets[i];
      groups[`matrix_col_${slugify(name)}`] = colSets[i];
    });
  };
  return { w: width, h: height, cols: own, draw };
}


type Box = { x: number; y: number; w: number; h: number };

/** The page with a matrix on it: where the diagram, the matrix and the table go, at one scale that fits them all. */
interface PagePlan {
  diagram: Box | null;
  matrix: { draw: (push: (d: Drawable) => void, anchors: Record<string, Pt>, groups: Record<string, string[]>) => void };
  table?: TableFrame;
  /** Set when the model is too big for the page: the world it is laid out in (SceneLayout.world). */
  world?: Box;
}

/**
 * The page a figure may fill (logical, y-up): clear of the caption band at
 * the bottom and the heading at the top — decision_tree's MARGIN.
 */
const REGION = { left: 50, right: 950, bottom: 150, top: 655 };
/** The least room the diagram gets beside the matrix: a ring of states narrower than this stops reading. */
const MIN_SIDE_DIAGRAM_W = 330;
const MIN_DIAGRAM_H = 260;
const GAP = 34;
/** The largest scale: a matrix alone, or one sharing the page with the diagram (which then gets the rest). */
const S_MAX = 1.45;
const S_MAX_WITH_DIAGRAM = 1.25;
/** The page's smallest scale; below about 0.73 the type is at its floor and only the air between it shrinks. */
const S_MIN = 0.4;
/**
 * A world's scale: the type at its floor (MIN_FS + 2 = 22 × 0.73), so the
 * overview is as large as it can be while the camera reads it close.
 */
const S_WORLD = 0.73;
/** Air round a world's ink, and the caption band's height under it. */
const WORLD_PAD = 30;

/** One way to arrange the page: its size at scale s, and the plan placing it in a region at least that big. */
interface Arrangement {
  size: (s: number) => { w: number; h: number };
  place: (s: number, R: Box) => PagePlan;
}

/**
 * Every arrangement that could take the page, each at the largest scale it
 * fits; the largest scale wins (the first on a tie). With a trace: the
 * matrix over the table, their columns shared (a state's column in the
 * table is its column in the matrix; QALYs under QALYs/yr, Cost under
 * Cost/yr) — beside a diagram, the diagram takes the page's left; or the
 * matrix beside the table, when the page is wider than the pair is tall;
 * or, with a diagram, diagram and matrix over a full-width table.
 *
 * A model the page cannot hold with its type above the floor (a 7-state
 * model with its trace and a second option) is laid out at full size in a
 * world larger than the page — the arrangement whose overview is largest —
 * which the camera walks (`camera: {on: …}`), as decision_tree's "full".
 */
function pagePlan(states: string[], params: MarkovParams, run: CohortRun | null, showDiagram: boolean): PagePlan {
  const top = params.title ? 612 : REGION.top;
  const R: Box = { x: REGION.left, y: REGION.bottom, w: REGION.right - REGION.left, h: top - REGION.bottom };
  const tr = params.trace;
  const mat = (s: number, cols?: Cols) => planMatrix(states, params, s, cols);
  const tbl = (s: number, cols?: Cols) => tableFrame(run!, states, tr!, s, cols);
  const at = (m: MatrixPlan, x0: number, yTop: number): PagePlan["matrix"] => ({ draw: (push, anchors, groups) => m.draw(x0, yTop, push, anchors, groups) });
  const vgap = (s: number) => Math.max(20, 30 * s);
  /** The top of a block of height h centred in R's height. */
  const topOf = (R: Box, h: number) => R.y + R.h - Math.max(0, R.h - h) / 2;
  const sideW = showDiagram ? MIN_SIDE_DIAGRAM_W + GAP : 0;
  const arrangements: Arrangement[] = [];

  if (run) {
    // The matrix over the table, columns shared; a diagram takes the left.
    const stacked = (s: number) => {
      const cols = maxCols(mat(s).cols, tbl(s).cols);
      const m = mat(s, cols), t = tbl(s, cols);
      return { m, t, w: Math.max(m.w, t.w), h: m.h + vgap(s) + t.h };
    };
    arrangements.push({
      size: (s) => {
        const b = stacked(s);
        return { w: b.w + sideW, h: b.h };
      },
      place: (s, R) => {
        const { m, t, w, h } = stacked(s);
        const bx = showDiagram ? R.x + R.w - w : R.x + (R.w - w) / 2;
        const by = topOf(R, h);
        return {
          diagram: showDiagram ? { x: R.x, y: R.y, w: bx - GAP - R.x, h: R.h } : null,
          matrix: at(m, bx, by),
          table: { ...t.frame, x0: bx, x1: bx + t.w, yTop: by - m.h - vgap(s) - t.frame.FS * 0.6 },
        };
      },
    });
    if (!showDiagram) {
      // Side by side, tops level.
      arrangements.push({
        size: (s) => {
          const m = mat(s), t = tbl(s);
          return { w: m.w + GAP + t.w, h: Math.max(m.h, t.h) };
        },
        place: (s, R) => {
          const m = mat(s), t = tbl(s);
          const w = m.w + GAP + t.w, h = Math.max(m.h, t.h);
          const bx = R.x + (R.w - w) / 2, by = topOf(R, h);
          return { diagram: null, matrix: at(m, bx, by), table: { ...t.frame, x0: bx + m.w + GAP, x1: bx + m.w + GAP + t.w, yTop: by - t.frame.FS * 0.6 } };
        },
      });
    } else {
      // Diagram and matrix side by side over a full-width table.
      arrangements.push({
        size: (s) => {
          const m = mat(s), t = tbl(s);
          return { w: Math.max(m.w + sideW, t.w), h: Math.max(m.h, MIN_DIAGRAM_H) + GAP + t.h };
        },
        place: (s, R) => {
          const m = mat(s), t = tbl(s);
          const upperH = Math.max(m.h, MIN_DIAGRAM_H);
          const by = topOf(R, upperH + GAP + t.h);
          const mx = R.x + R.w - m.w;
          return {
            diagram: { x: R.x, y: by - upperH, w: mx - GAP - R.x, h: upperH },
            matrix: at(m, mx, by - (upperH - m.h) / 2),
            table: { ...t.frame, x0: R.x + (R.w - t.w) / 2, x1: R.x + (R.w + t.w) / 2, yTop: by - upperH - GAP - t.frame.FS * 0.6 },
          };
        },
      });
    }
  } else {
    arrangements.push({
      size: (s) => {
        const m = mat(s);
        return { w: m.w + sideW, h: m.h };
      },
      place: (s, R) => {
        const m = mat(s);
        const mx = showDiagram ? R.x + R.w - m.w : R.x + (R.w - m.w) / 2;
        return { diagram: showDiagram ? { x: R.x, y: R.y, w: mx - GAP - R.x, h: R.h } : null, matrix: at(m, mx, topOf(R, m.h)) };
      },
    });
  }

  const sMax = showDiagram ? S_MAX_WITH_DIAGRAM : S_MAX;
  let best: { s: number; a: Arrangement } | null = null;
  for (const a of arrangements) {
    for (let s = sMax; s >= S_MIN - 1e-9; s = Math.round((s - 0.02) * 100) / 100) {
      if (best && s <= best.s + 1e-9) break;
      const z = a.size(s);
      if (z.w <= R.w && z.h <= R.h) {
        best = { s, a };
        break;
      }
    }
  }
  if (best) return best.a.place(best.s, R);

  // A world: at full size, the arrangement whose overview (the world fitted
  // to the page) is largest, its top-left where the page's is; it grows
  // right and down.
  const overview = (z: { w: number; h: number }) => Math.max(z.w / R.w, z.h / R.h);
  const a = arrangements.reduce((p, q) => (overview(q.size(S_WORLD)) < overview(p.size(S_WORLD)) ? q : p));
  const z = a.size(S_WORLD);
  const W: Box = { x: R.x, y: top - Math.max(R.h, z.h), w: Math.max(R.w, z.w), h: Math.max(R.h, z.h) };
  return { ...a.place(S_WORLD, W), world: { x: W.x - WORLD_PAD, y: W.y - REGION.bottom, w: W.w + 2 * WORLD_PAD, h: W.h + REGION.bottom + (kit.CANVAS.h - top) } };
}
