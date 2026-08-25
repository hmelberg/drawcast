// Deterministic layout for the cost_effectiveness_plane scene: incremental
// effect (x) vs incremental cost (y), both axes through the origin at the
// same fixed canvas point (500, 400) regardless of the data's own scale, a
// dashed willingness-to-pay line through the origin when a threshold is
// given, and up to 6 points whose halo (cost-effective vs not) depends on
// which side of that line they fall.

import { linearScale } from "../../layout/canvas";
import {
  COLORS,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest, Side } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { kit } from "../kit";

export interface CEPoint {
  label: string;
  /** Incremental effect, e.g. QALYs gained. */
  effect: number;
  /** Incremental cost. */
  cost: number;
  emphasize?: boolean;
}

export interface CEParams {
  x_label?: string;
  y_label?: string;
  /** Willingness-to-pay slope, cost per unit effect (e.g. 30000 per QALY). Drawn only when given. */
  wtp_threshold?: number;
  /** 1–6 intervention points. */
  points: CEPoint[];
  /** Small guide captions in each quadrant corner. Default true. */
  quadrant_labels?: boolean;
  title?: string;
}

const CX = 500;
const CY = 400;
const HALF_W = 380;
const HALF_H = 260;
const AXIS_PAD = 24;

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
  let best: Side = "above-right";
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

/** Clip the line y = slope*x to the box [-xMax,xMax] x [-yMax,yMax] (world coords). */
function clipWtpLine(slope: number, xMax: number, yMax: number): [Pt, Pt] {
  const clampY = (x: number, y: number): Pt => {
    if (y > yMax) return [yMax / slope, yMax];
    if (y < -yMax) return [-yMax / slope, -yMax];
    return [x, y];
  };
  const a = clampY(-xMax, slope * -xMax);
  const b = clampY(xMax, slope * xMax);
  return [a, b];
}

export function layoutCostEffectivenessPlane(params: CEParams): SceneLayout {
  const points = params.points.slice(0, 6);
  const xMaxRaw = Math.max(0, ...points.map((p) => Math.abs(p.effect)));
  const yMaxRaw = Math.max(0, ...points.map((p) => Math.abs(p.cost)));
  const xMax = xMaxRaw > 0 ? xMaxRaw * 1.2 : 1;
  const yMax = yMaxRaw > 0 ? yMaxRaw * 1.2 : 1;
  const sx = linearScale([-xMax, xMax], [CX - HALF_W, CX + HALF_W]);
  const sy = linearScale([-yMax, yMax], [CY - HALF_H, CY + HALF_H]);

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };

  const xLabel = params.x_label ?? "Incremental effect (QALYs)";
  const yLabel = params.y_label ?? "Incremental cost";

  push(
    kit.group("x_axis", [
      kit.stroke(
        "x_axis__line",
        [
          [CX - HALF_W - AXIS_PAD, CY],
          [CX + HALF_W + AXIS_PAD, CY],
        ],
        { arrowhead: "both", strokeWidth: 4, ms: SKETCH_MS.axis },
      ),
      kit.text("x_axis__label", [CX + HALF_W + AXIS_PAD - 10, CY - 30], xLabel, { fontSize: 22, anchor: "end" }),
    ]),
  );
  anchors["x_axis"] = [CX, CY];

  push(
    kit.group("y_axis", [
      kit.stroke(
        "y_axis__line",
        [
          [CX, CY - HALF_H - AXIS_PAD],
          [CX, CY + HALF_H + AXIS_PAD],
        ],
        { arrowhead: "both", strokeWidth: 4, ms: SKETCH_MS.axis },
      ),
      kit.text("y_axis__label", [CX + 14, CY + HALF_H * 0.55], yLabel, { fontSize: 22, anchor: "start" }),
    ]),
  );
  anchors["y_axis"] = [CX, CY];

  if (params.quadrant_labels !== false) {
    const inset = 14;
    push(kit.text("q_ne", [CX + HALF_W - inset, CY + HALF_H - 22], "More costly, more effective", { fontSize: 16, color: COLORS.guide, anchor: "end" }));
    push(kit.text("q_nw", [CX - HALF_W + inset, CY + HALF_H - 22], "More costly, less effective", { fontSize: 16, color: COLORS.guide }));
    push(kit.text("q_se", [CX + HALF_W - inset, CY - HALF_H + 16], "Less costly, more effective", { fontSize: 16, color: COLORS.guide, anchor: "end" }));
    push(kit.text("q_sw", [CX - HALF_W + inset, CY - HALF_H + 16], "Less costly, less effective", { fontSize: 16, color: COLORS.guide }));
  }

  const threshold = params.wtp_threshold;
  if (threshold !== undefined) {
    const [w0, w1] = clipWtpLine(threshold, xMax, yMax);
    const c0: Pt = [sx(w0[0]), sy(w0[1])];
    const c1: Pt = [sx(w1[0]), sy(w1[1])];
    push(kit.stroke("wtp_line", [c0, c1], { color: COLORS.accent, dash: true, strokeWidth: 3, ms: SKETCH_MS.guides }));
    anchors["wtp_line"] = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2];

    const dx = c1[0] - c0[0];
    const dy = c1[1] - c0[1];
    const dlen = Math.hypot(dx, dy) || 1;
    let nx = -dy / dlen;
    let ny = dx / dlen;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const OFFSET = 20;
    const labelAnchor: Pt = [c1[0] + nx * OFFSET, c1[1] + ny * OFFSET];
    labels.push({
      id: "wtp_label",
      anchor: labelAnchor,
      side: nearestSide(nx, ny),
      text: "WTP threshold",
      fontSize: 20,
      style: defaultStyle({ color: COLORS.accent }),
      drawOpts: defaultDrawOpts("instant"),
      ignore: ["wtp_line"],
    });
    order.push("wtp_label");
  }

  points.forEach((p, i) => {
    const c: Pt = [sx(p.effect), sy(p.cost)];
    const r = p.emphasize ? 11 : 8;
    const color = p.emphasize ? COLORS.accent : COLORS.ink;
    const dotId = `pt_${i}`;
    const children: Drawable[] = [];

    if (threshold !== undefined) {
      const below = p.cost <= threshold * p.effect;
      children.push(kit.area(`${dotId}__halo`, kit.ellipse(c, r + 14, r + 14), below ? COLORS.region2 : COLORS.regionLoss));
    }
    children.push(kit.stroke(`${dotId}__dot`, kit.polygon(c, r, 8), { closed: true, color, fill: color, strokeWidth: 2.5, ms: SKETCH_MS.dot }));
    push(kit.group(dotId, children));
    anchors[dotId] = c;

    const side: Side = i % 2 === 0 ? "above-right" : "below-right";
    const labelId = `pt_label_${i}`;
    labels.push({
      id: labelId,
      anchor: c,
      side,
      text: p.label,
      fontSize: p.emphasize ? 24 : 21,
      style: defaultStyle({ color }),
      drawOpts: defaultDrawOpts("instant"),
      ignore: [dotId],
    });
    order.push(labelId);
  });

  if (params.title) {
    push(kit.text("title", [CX, CY + HALF_H + 40], params.title, { fontSize: 30 }));
  }

  return { drawables, labels, anchors, order };
}
