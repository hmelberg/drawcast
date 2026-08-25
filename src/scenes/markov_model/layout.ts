// Deterministic layout for the markov_model scene: states as ellipses laid
// out by kit.layoutNodes (a ring for 3+ states, a horizontal pair for
// exactly 2), transition arrows (bowed only when a reverse edge between the
// same pair exists, so the two never overlap), self-loops for states that
// also "stay", and an accent-tinted halo behind one optionally highlighted
// state. Absorbing states — no outgoing transition — render in plain ink
// instead of the normal accent stroke, the same "dead end" convention every
// health-econ Markov diagram leans on (transient states are colored, the
// terminal state fades to ink).

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

export interface MarkovParams {
  /** 2–6 state names, in the order they should be laid out. */
  states: string[];
  transitions: MarkovTransition[];
  /** States that also have a "stay" probability — drawn with a small loop. */
  self_loops?: string[];
  /** Node arrangement; default: "circle" for 3+ states, "chain" for exactly 2. */
  layout?: "circle" | "chain";
  /** One state name to highlight with a tinted halo. */
  highlight_state?: string;
  title?: string;
}

const BOX = { x: 140, y: 200, w: 720, h: 360 };
const RX = 78;
const RY = 44;
const SHORTEN = 80;
const REVERSE_CURVE = 0.18;
/** Perpendicular nudge (px) off an edge's own line, for its label anchor or a self-loop's own anchor point. */
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

export function layoutMarkovModel(params: MarkovParams): SceneLayout {
  const states = params.states.slice(0, 6);
  const style = params.layout ?? (states.length >= 3 ? "circle" : "chain");
  const positions = kit.layoutNodes(states, params.transitions, { style, ...BOX });

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

  states.forEach((name) => {
    const c = positions[name];
    if (!c) return;
    const slug = slugify(name);
    const stateId = `state_${slug}`;
    anchors[stateId] = c;

    if (params.highlight_state === name) {
      const hlId = `hl_${slug}`;
      push(kit.area(hlId, kit.ellipse(c, RX + 16, RY + 16), COLORS.accent));
      anchors[hlId] = c;
    }

    const absorbing = !outgoing.has(name);
    push(
      kit.stroke(stateId, kit.ellipse(c, RX, RY), {
        closed: true,
        color: absorbing ? COLORS.ink : COLORS.accent,
        strokeWidth: 3.5,
        ms: SKETCH_MS.node,
      }),
    );
    push(kit.text(`state_label_${slug}`, c, name, { fontSize: 22 }));
  });

  params.transitions.forEach((t, i) => {
    const from = positions[t.from];
    const to = positions[t.to];
    if (!from || !to) return;
    const hasReverse = params.transitions.some((o) => o.from === t.to && o.to === t.from);
    const id = `t_${i}`;
    const { drawables: edgeDrawables } = kit.edgeArrow(id, from, to, {
      shorten: SHORTEN,
      curve: hasReverse ? REVERSE_CURVE : 0,
    });
    edgeDrawables.forEach(push);

    const mainStroke = edgeDrawables[0] as StrokeDrawable;
    const pts = mainStroke.pts;
    const midIdx = Math.floor((pts.length - 1) / 2);
    const mid = pts[midIdx];
    anchors[id] = mid;

    if (t.label) {
      // Nudge the label anchor off the line itself, perpendicular to its
      // local direction at the midpoint — safe for any edge orientation
      // (a diagonal chord's bounding box would otherwise swallow whatever
      // "above"/"below" offset a fixed compass choice might pick).
      const prev = pts[Math.max(0, midIdx - 1)];
      const next = pts[Math.min(pts.length - 1, midIdx + 1)];
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const dlen = Math.hypot(dx, dy) || 1;
      let nx = -dy / dlen;
      let ny = dx / dlen;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
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

  (params.self_loops ?? []).forEach((name) => {
    const c = positions[name];
    if (!c) return;
    const slug = slugify(name);
    const id = `loop_${slug}`;
    // Anchor the loop at the ellipse's TOP EDGE, not its center — selfLoop
    // draws an arc that dips back down to touch `from` exactly, and the
    // center is where the state's own name sits (kit.text, drawn on top).
    const top: Pt = [c[0], c[1] + RY];
    const { drawables: loopDrawables } = kit.edgeArrow(id, top, top, { selfLoop: true });
    loopDrawables.forEach(push);
    anchors[id] = [top[0], top[1] + LABEL_OFFSET];
  });

  if (params.title) {
    push(kit.text("title", [500, 650], params.title, { fontSize: 30 }));
  }

  return { drawables, labels, anchors, order };
}
