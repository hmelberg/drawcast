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
}

const BOX = { x: 140, y: 200, w: 720, h: 360 };
const RX = 78;
const RY = 44;
const REVERSE_CURVE = 0.12;
/** Min normalized clearance (1.0 = a state ellipse's own boundary) a transition path must keep from every OTHER state. */
const EDGE_CLEARANCE = 1.12;
/** Perpendicular nudge (px) off an edge's own line, for its label anchor. */
const LABEL_OFFSET = 26;

/** lowercase, every non-alphanumeric character becomes "_" — deterministic element ids from arbitrary state names. */
function slugify(name: string): string {
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

export function layoutMarkovModel(params: MarkovParams): SceneLayout {
  const states = params.states.slice(0, 6);
  const style = params.layout ?? (states.length >= 3 ? "circle" : "chain");
  const positions = kit.layoutNodes(states, params.transitions, { style, ...BOX });

  // Crowded arrangements (a 5–6 state chain or ring) shrink every ellipse
  // together so neighbors keep clear air; roomy ones keep the full size.
  let minDist = Infinity;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = positions[states[i]], b = positions[states[j]];
      if (a && b) minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
  }
  const scale = Math.min(1, (0.44 * minDist) / RX);
  const rx = RX * scale;
  const ry = RY * scale;
  const stateFont = Math.max(20, Math.round(28 * scale));

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
  const incident = new Map<string, Pt[]>();
  for (const t of params.transitions) {
    const a = positions[t.from], b = positions[t.to];
    if (!a || !b || t.from === t.to) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    (incident.get(t.from) ?? incident.set(t.from, []).get(t.from)!).push(u);
    (incident.get(t.to) ?? incident.set(t.to, []).get(t.to)!).push([-u[0], -u[1]]);
  }

  states.forEach((name) => {
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
    const midIdx = Math.floor((pts.length - 1) / 2);
    const mid = pts[midIdx];
    anchors[id] = mid;

    if (t.label) {
      // Nudge the label anchor off the line itself. A bowed edge puts it on
      // the bow's CONVEX side — the concave side is exactly where the state
      // the bow swerved around (or the reverse partner edge) sits. A
      // straight edge nudges perpendicular to its local direction at the
      // midpoint, upward-biased — safe for any edge orientation (a diagonal
      // chord's bounding box would otherwise swallow whatever
      // "above"/"below" offset a fixed compass choice might pick).
      const chordMid: Pt = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
      const bulgeLen = Math.hypot(mid[0] - chordMid[0], mid[1] - chordMid[1]);
      let nx: number;
      let ny: number;
      if (bulgeLen > 4) {
        nx = (mid[0] - chordMid[0]) / bulgeLen;
        ny = (mid[1] - chordMid[1]) / bulgeLen;
      } else {
        const prev = pts[Math.max(0, midIdx - 1)];
        const next = pts[Math.min(pts.length - 1, midIdx + 1)];
        const dx = next[0] - prev[0];
        const dy = next[1] - prev[1];
        const dlen = Math.hypot(dx, dy) || 1;
        nx = -dy / dlen;
        ny = dx / dlen;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      const labelAnchor: Pt = [mid[0] + nx * LABEL_OFFSET, mid[1] + ny * LABEL_OFFSET];
      const labelId = `t_label_${i}`;
      labels.push({
        id: labelId,
        anchor: labelAnchor,
        side: nearestSide(nx, ny),
        text: t.label,
        fontSize: 20,
        style: defaultStyle({ color: COLORS.guide }),
        drawOpts: defaultDrawOpts("instant"),
        ignore: [id],
      });
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
      labels.push({
        id: labelId,
        anchor: [apex[0] + dir[0] * 10, apex[1] + dir[1] * 10],
        side: nearestSide(dir[0], dir[1]),
        text: stayLabel,
        fontSize: 20,
        style: defaultStyle({ color: COLORS.guide }),
        drawOpts: defaultDrawOpts("instant"),
        ignore: [id],
      });
      order.push(labelId);
    }
  });

  if (params.title) {
    push(kit.text("title", [500, 650], params.title, { fontSize: 30 }));
  }

  return { drawables, labels, anchors, order };
}
