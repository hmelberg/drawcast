// Deterministic decision-tree layout using d3-hierarchy's tidy tree.
// Health-economics conventions: decision = square, chance = circle,
// terminal = triangle. The LLM never places nodes.

import { hierarchy, tree } from "d3-hierarchy";
import { CANVAS } from "../../layout/canvas";
import { heuristicMeasure } from "../../layout/measure";
import {
  COLORS,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
  type StrokeDrawable,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface TreeNode {
  id?: string;
  type: "decision" | "chance" | "terminal";
  label: string;
  /** Outcome value at a terminal (e.g. QALYs). May also sit on the incoming branch. */
  payoff?: number;
  cost?: number;
  children?: TreeBranch[];
}

export interface TreeBranch {
  label?: string;
  probability?: number;
  cost?: number;
  payoff?: number;
  node: TreeNode;
}

export interface DecisionTreeParams {
  root: TreeNode;
}

interface Wrapped {
  cleanId: string;
  node: TreeNode;
  branch?: TreeBranch;
  children: Wrapped[];
}

const MARGIN = { left: 95, right: 180, top: 65, bottom: 65 };

function wrap(node: TreeNode, path: number[], branch?: TreeBranch): Wrapped {
  return {
    cleanId: node.id ?? path.join("_"),
    node,
    branch,
    children: (node.children ?? []).map((b, i) => wrap(b.node, [...path, i], b)),
  };
}

function nodeRadius(type: TreeNode["type"]): number {
  return type === "decision" ? 34 : type === "chance" ? 30 : 32;
}

export function layoutDecisionTree(params: DecisionTreeParams): SceneLayout & { positions: Record<string, Pt> } {
  const rootWrapped = wrap(params.root, [0]);
  const h = hierarchy(rootWrapped, (d) => d.children);
  const plotW = CANVAS.w - MARGIN.left - MARGIN.right;
  const plotH = CANVAS.h - MARGIN.top - MARGIN.bottom;
  tree<Wrapped>().size([plotH, plotW])(h);

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const positions: Record<string, Pt> = {};
  const order: string[] = [];

  type LaidOut = typeof h & { x: number; y: number };
  const pos = (n: typeof h): Pt => {
    const l = n as LaidOut;
    // d3: x = breadth, y = depth. Horizontal tree: depth → logical x, breadth top-down → logical y.
    return [MARGIN.left + l.y, CANVAS.h - MARGIN.top - l.x];
  };

  // Nodes first (breadth-first, so drawing order reads root → leaves).
  for (const n of h.descendants()) {
    const { cleanId, node } = n.data;
    const c = pos(n);
    positions[cleanId] = c;
    const id = `node_${cleanId}`;
    anchors[id] = c;
    drawables.push(nodeDrawable(id, node.type, c));
    order.push(id);

    // A node's label may sit near the branch that ARRIVES at it — otherwise
    // it drifts sideways to dodge its own incoming edge and lands in the space
    // the branch labels need (the "Medication" label ending up 90 units right
    // of its own circle was what pushed "Symptoms resolve (p=0.7)" off its
    // branch). The node shape itself stays an obstacle: a label allowed to
    // ignore that lands on top of the square.
    const own = n.parent ? [`edge_${n.parent.data.cleanId}_${cleanId}`] : [];
    if (node.type === "terminal") {
      labels.push(labelReq(`label_${cleanId}`, c, "above-right", node.label, 26, COLORS.ink, own));
      order.push(`label_${cleanId}`);
      const b = n.data.branch;
      const payoff = node.payoff ?? b?.payoff;
      const cost = node.cost ?? b?.cost;
      if (payoff !== undefined || cost !== undefined) {
        const parts: string[] = [];
        if (payoff !== undefined) parts.push(String(payoff));
        if (cost !== undefined) parts.push(`cost ${cost}`);
        labels.push(labelReq(`payoff_${cleanId}`, [c[0] + 42, c[1]], "right", parts.join(", "), 26, COLORS.supply, own));
        order.push(`payoff_${cleanId}`);
      }
    } else {
      labels.push(labelReq(`label_${cleanId}`, [c[0], c[1] + nodeRadius(node.type)], "above", node.label, 26, COLORS.ink, own));
      order.push(`label_${cleanId}`);
    }
  }

  // Edges + branch labels.
  for (const n of h.descendants()) {
    const parent = n.parent;
    if (!parent) continue;
    const a = pos(parent);
    const b = pos(n);
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / dist;
    const uy = (b[1] - a[1]) / dist;
    const rA = nodeRadius(parent.data.node.type) + 6;
    const rB = nodeRadius(n.data.node.type) + 6;
    const from: Pt = [a[0] + ux * rA, a[1] + uy * rA];
    const to: Pt = [b[0] - ux * rB, b[1] - uy * rB];
    const id = `edge_${parent.data.cleanId}_${n.data.cleanId}`;
    drawables.push({
      id,
      kind: "stroke",
      pts: [from, to],
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 3 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
    });
    const mid: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    anchors[id] = mid;
    order.push(id);

    const branch = n.data.branch;
    const parts: string[] = [];
    if (branch?.label) parts.push(branch.label);
    if (branch?.probability !== undefined) parts.push(`p=${branch.probability}`);
    if (parts.length > 0) {
      const text = branch?.probability !== undefined && branch.label ? `${branch.label} (p=${branch.probability})` : parts.join(" ");
      const labelId = `branchlabel_${parent.data.cleanId}_${n.data.cleanId}`;
      // Outside the fan, never inside it: an up-going branch takes its label
      // above its edge, a down-going one below. Labelling every branch "above"
      // puts the lower sibling's text in the wedge between the two edges —
      // the tightest space in the whole figure, and about five characters
      // wide before it lands on the other branch. A near-horizontal branch
      // (an only child) has no wedge to avoid, so it keeps "above".
      const diagonal = Math.abs(uy) > HORIZONTAL_UY;
      const side: LabelRequest["side"] = uy < -HORIZONTAL_UY ? "below" : "above";
      // Along the branch, but past its midpoint: at the parent end every
      // sibling branch converges and the parent's own label sits just above
      // the node, so that is the busiest spot in the figure. BRANCH_LABEL_T of
      // the way out, the fan has opened and each label has its own room.
      const at: Pt = [from[0] + (to[0] - from[0]) * BRANCH_LABEL_T, from[1] + (to[1] - from[1]) * BRANCH_LABEL_T];
      // Only a diagonal branch waives its own edge: its bounding box is the
      // whole wedge, a poor stand-in for the thin line. A horizontal branch's
      // box IS the line, so keeping it as an obstacle is what lifts the label
      // clear of it (the middle branch of a three-way fan).
      labels.push(labelReq(labelId, at, side, text, branchFontSize(text, Math.abs(to[0] - from[0])), COLORS.guide, diagonal ? [id] : undefined));
      order.push(labelId);
    }
  }

  return { drawables, labels, anchors, positions, order };
}

/** How far along its branch a label sits (0 = parent end, 1 = child end). */
const BRANCH_LABEL_T = 0.62;

/** Below this |uy| a branch is treated as horizontal — no wedge to stay out of. */
const HORIZONTAL_UY = 0.08;

const BRANCH_FONT = 24;
const BRANCH_FONT_MIN = 15;

/**
 * A branch label lives over its own branch, so the branch's horizontal span is
 * all the room it has: past that it reaches into the next column of nodes.
 * 24 is the ceiling, not the size — long text shrinks to fit (the same bargain
 * phylo_tree strikes with long leaf names) rather than colliding.
 */
function branchFontSize(text: string, span: number): number {
  const room = Math.max(40, span - 24); // clear of the node at each end
  const natural = heuristicMeasure(text, BRANCH_FONT).w;
  if (natural <= room) return BRANCH_FONT;
  return Math.max(BRANCH_FONT_MIN, Math.floor((BRANCH_FONT * room) / natural));
}

function nodeDrawable(id: string, type: TreeNode["type"], c: Pt): StrokeDrawable {
  const style = defaultStyle({ strokeWidth: 3.5, color: type === "decision" ? COLORS.demand : type === "chance" ? COLORS.supply : COLORS.ink });
  const drawOpts = defaultDrawOpts("sketch", SKETCH_MS.node);
  if (type === "decision") {
    const s = 27;
    return {
      id,
      kind: "stroke",
      pts: [
        [c[0] - s, c[1] - s],
        [c[0] + s, c[1] - s],
        [c[0] + s, c[1] + s],
        [c[0] - s, c[1] + s],
      ],
      closed: true,
      shapeHint: { type: "rect", x: c[0] - s, y: c[1] - s, w: 2 * s, h: 2 * s },
      z: Z_STROKE,
      style,
      drawOpts,
    };
  }
  if (type === "chance") {
    return { id, kind: "stroke", pts: [c], shapeHint: { type: "circle", c, r: 28 }, z: Z_STROKE, style, drawOpts };
  }
  const s = 26;
  return {
    id,
    kind: "stroke",
    pts: [
      [c[0] - s, c[1] + s * 0.85],
      [c[0] - s, c[1] - s * 0.85],
      [c[0] + s, c[1]],
    ],
    closed: true,
    z: Z_STROKE,
    style,
    drawOpts,
  };
}

function labelReq(
  id: string,
  anchor: Pt,
  side: LabelRequest["side"],
  text: string,
  fontSize: number,
  color: string = COLORS.ink,
  ignore?: string[],
): LabelRequest {
  return {
    id,
    anchor,
    side,
    text,
    fontSize,
    style: defaultStyle({ color }),
    drawOpts: defaultDrawOpts("instant"),
    ignore,
  };
}
