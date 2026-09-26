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
}

const BOX = { x: 140, y: 200, w: 720, h: 360 };
const RX = 78;
const RY = 44;
const REVERSE_CURVE = 0.18; // was 0.12: with edges now attaching where their own curve arrives, a little more bow gives a reverse pair air between the lines too (arrow round 2, 2026-09-17)
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

/** The diagram's box when a trace table takes the right of the canvas. */
const TRACED_BOX = { x: 80, y: 250, w: 280, h: 300 };

export function layoutMarkovModel(params: MarkovParams): SceneLayout {
  const states = params.states.slice(0, 6);
  const style = params.layout ?? (states.length >= 3 ? "circle" : "chain");
  const run = params.trace ? runTrace(states, params.transitions, params.trace) : null;
  const positions = kit.layoutNodes(states, params.transitions, { style, ...(run ? TRACED_BOX : BOX) });

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
    push(kit.text("title", [run ? 250 : 500, 650], params.title, { fontSize: 30 }));
  }

  if (run) traceTable(run, states, params.trace!, push, anchors);

  return { drawables, labels, anchors, order, ...(run && { values: traceValues(run) }) };
}

/** The run's results for `{markov.<key>}` tokens in a cast's drawn text. */
function traceValues(run: CohortRun): Record<string, number> {
  const v: Record<string, number> = { qalys_total: run.total.qalys, cost_total: run.total.cost, qalys_mean: run.mean.qalys, cost_mean: run.mean.cost };
  if (run.compare) {
    const dq = run.compare.mean.qalys - run.mean.qalys, dc = run.compare.mean.cost - run.mean.cost;
    Object.assign(v, { compare_qalys_mean: run.compare.mean.qalys, compare_cost_mean: run.compare.mean.cost, qalys_gained: dq, cost_added: dc });
    if (dq > 0) v.cost_per_qaly = dc / dq;
  }
  return v;
}

/** A transition label read as a probability, or null. */
function prob(label: string | undefined): number | null {
  if (label === undefined) return null;
  const v = Number(label.trim().replace(",", "."));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
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
  const m = states.map(() => states.map(() => 0));
  for (const t of transitions) {
    const i = states.indexOf(t.from), j = states.indexOf(t.to);
    const p = prob(t.label);
    if (i < 0 || j < 0 || i === j) continue;
    if (p === null) return null;
    m[i][j] = p;
  }
  for (let i = 0; i < states.length; i++) {
    const out = m[i].reduce((a, b) => a + b, 0);
    if (out > 1 + 1e-9) return null;
    m[i][i] = 1 - out;
  }
  return m;
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

function runTrace(states: string[], transitions: MarkovTransition[], tr: MarkovTrace): CohortRun | null {
  if (states.length > 4) return null; // six columns of counts do not fit beside the diagram
  const m = matrix(states, transitions);
  if (!m) return null;
  const base = cohort(states, m, tr);
  if (!tr.compare) return base;
  const changed = transitions.map((t) => tr.compare!.transitions?.find((o) => o.from === t.from && o.to === t.to) ?? t);
  const m2 = matrix(states, changed);
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

/**
 * The table, one drawable per row so a cast can write it in as it speaks:
 * trace_head, trace_utility, trace_cost, trace_row_0 (the start) …
 * trace_row_<cycles>, trace_total, trace_mean, and with compare
 * trace_compare and trace_icer.
 */
function traceTable(run: CohortRun, states: string[], tr: MarkovTrace, push: (d: Drawable) => void, anchors: Record<string, Pt>): void {
  const cur = tr.currency ?? "£";
  const cycles = Math.min(Math.max(tr.cycles ?? 2, 1), 4);
  const FS = 24;
  const x0 = 420, x1 = 990;
  const labelW = 100, qW = 88, cW = 108;
  const stateW = (x1 - x0 - labelW - qW - cW) / states.length;
  const colX = [...states.map((_, i) => x0 + labelW + stateW * (i + 0.5)), x1 - cW - qW / 2, x1 - cW / 2];
  const ROW = 37;
  let y = 632;
  const rowOf = (id: string, label: string, cells: (string | null)[], o: { color?: string; bold?: boolean } = {}) => {
    const kids: Drawable[] = [kit.text(`${id}__l`, [x0, y], label, { fontSize: FS - 4, anchor: "start", color: o.color ?? COLORS.guide })];
    cells.forEach((c, i) => {
      if (c !== null && c !== "") kids.push(kit.text(`${id}__c${i}`, [colX[i], y], c, { fontSize: FS, color: o.color ?? COLORS.ink }));
    });
    push(kit.group(id, kids));
    anchors[id] = [(x0 + x1) / 2, y];
    y -= ROW;
  };
  const rule = (id: string) => {
    push(kit.stroke(id, [[x0, y + ROW / 2], [x1, y + ROW / 2]], { color: COLORS.guide, strokeWidth: 1.5, ms: SKETCH_MS.guides }));
    y -= 8;
  };
  const blank = states.map(() => null);

  rowOf("trace_head", "", [...states, "QALYs", "Cost"], { color: COLORS.ink });
  rule("trace_head_rule");
  rowOf("trace_utility", "QALYs/yr", [...states.map((_, i) => kit.num(tr.utility?.[i] ?? 0)), null, null], { color: COLORS.supply });
  rowOf("trace_cost", "Cost/yr", [...states.map((_, i) => fmtMoney(tr.cost?.[i] ?? 0, cur)), null, null], { color: COLORS.supply });
  rule("trace_rule_1");
  rowOf("trace_row_0", "Start", [...run.rows[0].map(fmtCount), null, null]);
  for (let k = 1; k <= cycles; k++) {
    rowOf(`trace_row_${k}`, `Year ${k}`, [...run.rows[k].map(fmtCount), fmtCount(run.qalys[k - 1]), fmtMoney(run.costs[k - 1], cur)]);
  }
  rule("trace_rule_2");
  rowOf("trace_total", "Lifetime", [...blank, fmtCount(run.total.qalys), fmtMoney(run.total.cost, cur)]);
  rowOf("trace_mean", "Per person", [...blank, run.mean.qalys.toFixed(1), fmtMoney(run.mean.cost, cur)], { color: COLORS.demand });
  if (run.compare) {
    const c = run.compare;
    rowOf("trace_compare", c.name, [...blank, c.mean.qalys.toFixed(1), fmtMoney(c.mean.cost, cur)], { color: COLORS.accent });
    const dq = c.mean.qalys - run.mean.qalys, dc = c.mean.cost - run.mean.cost;
    y -= 10;
    const text =
      dq > 0
        ? `${dq.toFixed(1)} QALYs more for ${fmtMoney(dc, cur)}: ${fmtMoney(Math.round(dc / dq / 100) * 100, cur)} per QALY`
        : `${Math.abs(dq).toFixed(1)} QALYs ${dq < 0 ? "fewer" : "more"}, ${fmtMoney(dc, cur)} in cost`;
    push(kit.text("trace_icer", [(x0 + x1) / 2, y], text, { fontSize: FS, color: COLORS.accent }));
    anchors.trace_icer = [(x0 + x1) / 2, y];
  }
}
