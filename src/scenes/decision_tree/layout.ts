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
import { wrapText, type LabelCorridor, type LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface TreeNode {
  id?: string;
  type: "decision" | "chance" | "terminal";
  label: string;
  /** Outcome value at a terminal (e.g. QALYs). May also sit on the incoming branch. */
  payoff?: number;
  cost?: number;
  /** Folded-back value at a chance or decision node ("EV 11.6 y"), drawn as value_<id>. */
  value?: string;
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

// top 95 clears the card heading (y > 690); bottom 150 clears the narration band,
// which covers the bottom ~15% of the stage while a line is spoken (2026-09-25).
// right 230 holds a terminal's label and payoff ("Complication", 9) with room
// to spare: at 180 they ran to the canvas edge while the left sat empty
// (Hans, 2026-09-26: "very close to the right edge … just have some slightly
// shorter arrows").
const MARGIN = { left: 85, right: 230, top: 95, bottom: 150 };

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
  const terminalNames: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const positions: Record<string, Pt> = {};
  const order: string[] = [];
  const attached: Record<string, string[]> = {};

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
      const nameReq = labelReq(`label_${cleanId}`, c, "above-right", node.label, LABEL_FONT, COLORS.ink, own);
      // Never left of its own triangle: crowded out of its corner, a
      // terminal's name (or payoff) drifted onto the branches and read as a
      // branch label, in the middle of the tree (2026-09-27).
      nameReq.minX = c[0] - TERMINAL_HALF;
      order.push(`label_${cleanId}`);
      attached[id] = [...(attached[id] ?? []), `label_${cleanId}`];
      const b = n.data.branch;
      const payoff = node.payoff ?? b?.payoff;
      const cost = node.cost ?? b?.cost;
      if (payoff !== undefined || cost !== undefined) {
        const parts: string[] = [];
        if (payoff !== undefined) parts.push(String(payoff));
        if (cost !== undefined) parts.push(`cost ${cost}`);
        // The payoff is placed before the name: it is the number the tree
        // folds back, and the name can move where the number cannot (a
        // crowded pair of terminals pushed "6" onto its own triangle).
        const payoffReq = labelReq(`payoff_${cleanId}`, [c[0] + 42, c[1]], "right", parts.join(", "), LABEL_FONT, COLORS.supply, own);
        payoffReq.minX = c[0] + TERMINAL_HALF;
        labels.push(payoffReq);
        order.push(`payoff_${cleanId}`);
        attached[id] = [...(attached[id] ?? []), `payoff_${cleanId}`];
      }
      // Solved after the branch labels: a name can take any corner right of
      // its triangle, a branch label has one strip.
      terminalNames.push(nameReq);
    } else {
      labels.push(labelReq(`label_${cleanId}`, [c[0], c[1] + nodeRadius(node.type)], "above", node.label, LABEL_FONT, COLORS.ink, own));
      order.push(`label_${cleanId}`);
      attached[id] = [...(attached[id] ?? []), `label_${cleanId}`];
      // The folded-back value, under the node it summarises and in the same
      // size as its name: models otherwise put "EV 11.6 y" on a scratch card,
      // off the tree, where the comparison can no longer be seen (2026-09-27).
      if (node.value !== undefined && node.value !== "") {
        const valueId = `value_${cleanId}`;
        labels.push(labelReq(valueId, [c[0], c[1] - nodeRadius(node.type)], "below", String(node.value), LABEL_FONT, COLORS.supply));
        order.push(valueId);
        attached[id] = [...(attached[id] ?? []), valueId];
      }
    }
  }

  // Edges + branch labels. Labels are collected per column (all edges leaving
  // one depth) and given their side together, below.
  const branchLabels: BranchLabel[] = [];
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
    // 1/3 prints as 0.3333333333333333 — a token too long to wrap. Three
    // decimals is all a tree's reader uses.
    const p = branch?.probability !== undefined ? Number(branch.probability.toFixed(3)) : undefined;
    if (p !== undefined) parts.push(`p=${p}`);
    const text = parts.length === 0 ? undefined : p !== undefined && branch?.label ? `${branch.label} (p=${p})` : parts.join(" ");
    const siblings = parent.children ?? [];
    branchLabels.push({
      edgeId: id,
      labelId: `branchlabel_${parent.data.cleanId}_${n.data.cleanId}`,
      text,
      depth: parent.depth,
      from,
      to,
      uy,
      ux,
      // Where it sits in its own fan: the first child is the top one.
      rank: siblings.length <= 1 ? 0 : siblings.indexOf(n) / (siblings.length - 1) - 0.5,
    });
  }

  for (const req of branchLabelRequests(branchLabels, Object.values(positions))) {
    labels.push(req);
    order.push(req.id);
    const edgeId = branchLabels.find((b) => b.labelId === req.id)!.edgeId;
    attached[edgeId] = [...(attached[edgeId] ?? []), req.id];
  }
  labels.push(...terminalNames);

  return { drawables, labels, anchors, positions, order, attached };
}

interface BranchLabel {
  edgeId: string;
  labelId: string;
  /** Undefined for a branch with nothing to say — it still bounds its neighbours' corridors. */
  text?: string;
  /** The parent's depth: every edge of one column spans the same x-range. */
  depth: number;
  from: Pt;
  to: Pt;
  ux: number;
  uy: number;
  /** −0.5 = top of its fan, +0.5 = bottom, 0 = middle or only child. */
  rank: number;
}

type Gap = "above" | "below";

/**
 * Each branch label gets a CORRIDOR: the strip between its own branch and
 * the next branch of the column on the side it takes (or open sky, for the
 * outermost). Where two labels must share a strip — the bottom of one fan
 * and the top of the next both want the gap between the fans — each gets
 * the part next to its own branch. Branch labels are placed in the tree's
 * own terms — which strip, how far along, how wide — and the solver only
 * chooses among spots inside that strip.
 *
 * Before (2026-09-27) each label took "above" or "below" from its own slope
 * alone, with the neighbour branch only a soft cost. In a three-way fan the
 * middle label saw both wedges as costly, and the soft-penalty tie-break sent
 * it into the neighbour's wedge — "Grows (p=0.53)" read as the label of the
 * edge to "Never operated". Now a label leaves its strip only when it cannot
 * fit in it, and then far, with a leader to its own branch.
 */
function branchLabelRequests(branches: BranchLabel[], nodes: Pt[]): LabelRequest[] {
  const out: LabelRequest[] = [];
  const depths = [...new Set(branches.map((b) => b.depth))].sort((a, b) => a - b);
  for (const depth of depths) {
    // Top to bottom (logical y is up). A tidy tree never crosses its edges,
    // so this order holds along the whole column.
    const column = branches.filter((b) => b.depth === depth).sort((a, b) => b.to[1] + b.from[1] - (a.to[1] + a.from[1]));
    const strips = assignStrips(column, nodes);
    column.forEach((b, i) => {
      if (b.text === undefined) return;
      const { gap, share, width } = strips[i];
      const neighbour = column[gap === "above" ? i - 1 : i + 1];
      const own: [Pt, Pt] = [b.from, b.to];
      const other: [Pt, Pt] | undefined = neighbour && [lerp(b.from, neighbour.from, share), lerp(b.to, neighbour.to, share)];
      const wall: [Pt, Pt] | undefined = neighbour && [neighbour.from, neighbour.to];
      const strip = (outer: [Pt, Pt] | undefined, xMin: number, xMax: number): LabelCorridor =>
        gap === "above" ? { xMin, xMax, floor: own, ceiling: outer, hug: "floor" } : { xMin, xMax, floor: outer, ceiling: own, hug: "ceiling" };
      // For the ordinary search, should every corridor fail: lean away from
      // where the line closes in — above a rising branch the box sits back
      // toward the parent, above a falling one out toward the child — and
      // mirrored below.
      const flat = Math.abs(b.uy) <= HORIZONTAL_UY;
      const rising = b.uy > 0;
      const lean: LabelRequest["side"] = flat ? gap : gap === "above" ? (rising ? "above-left" : "above-right") : rising ? "below-right" : "below-left";
      // Past the midpoint: at the parent end every sibling branch converges
      // and the parent's own label sits just above the node. The solver
      // slides the label along its branch from here to wherever it fits.
      const t = BRANCH_LABEL_T;
      const at: Pt = [b.from[0] + (b.to[0] - b.from[0]) * t, b.from[1] + (b.to[1] - b.from[1]) * t];
      // Its own branch is the corridor's wall, exactly; as obstacle boxes a
      // diagonal would only blur it. The neighbour stays an obstacle, for the
      // looser corridors.
      const req = labelReq(b.labelId, at, lean, b.text, LABEL_FONT, COLORS.guide, [b.edgeId]);
      req.maxWidth = width;
      req.sides = [...new Set<LabelRequest["side"]>([lean, gap, gap === "above" ? "above-left" : "below-left", gap === "above" ? "above-right" : "below-right"])];
      // Its own part of the strip; failing that (a label too long for the
      // tree), the whole strip up to the neighbour branch; failing that,
      // grazing the neighbour branch with a corner — or, outside the fan,
      // reaching back under (or over) its parent node, where the old solve
      // put it. A label that fits none of them is exiled with a leader to its
      // branch (labels.ts).
      const [x0, x1] = [b.from[0], b.to[0]];
      const whole = strip(wall, x0, x1);
      const last: LabelCorridor = wall ? { ...whole, give: LABEL_FONT } : strip(undefined, x0 - (x1 - x0) / 2, x1);
      req.corridors = [strip(other, x0, x1), ...(share < 1 ? [whole] : []), last];
      out.push(req);
    });
  }
  return out;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

interface Strip {
  gap: Gap;
  /** The part of the strip that is this label's, from its own branch out: 1
   *  unless the neighbour's label shares the strip, which then gets the rest
   *  (split by the two labels' heights). */
  share: number;
  /** The wrap width that fits the strip best. */
  width: number;
}

/**
 * Above or below its branch, for every label in a column. Prefers the
 * outside of the label's own fan (top branch above, bottom branch below — away
 * from its siblings), a strip the label fits, a strip of its own over a
 * shared one, and, where all else is equal, the roomier strip. A small
 * dynamic programme over the column.
 */
function assignStrips(column: BranchLabel[], nodes: Pt[]): Strip[] {
  const n = column.length;
  /** Each label's height, wrapped to its branch, with clearance. */
  const natural = column.map((b) => (b.text === undefined ? 0 : wrapText(b.text, LABEL_FONT, wrapWidth(b), heuristicMeasure).length * LABEL_FONT * 1.25 + 12));
  /** Label i's part of the strip it shares with label j. */
  const part = (i: number, j: number) => natural[i] / (natural[i] + natural[j]);
  /** How the label best fits a strip: the widest wrap that fits, else the least-bad one. */
  const fit = (i: number, gap: Gap, shared: boolean): { slack: number; width: number } => {
    const b = column[i];
    const widest = wrapWidth(b);
    const j = gap === "above" ? i - 1 : i + 1;
    if (j < 0 || j >= n) {
      // Outside the column there is no neighbour branch, but there may be a
      // node of another depth — a terminal straight off the root, with its
      // name and payoff — under (or over) this branch. A label squeezed in
      // beside that node's words reads as one of them.
      const up = gap === "above" ? 1 : -1;
      // A node's name sits above it, its payoff beside it: its words reach
      // further up than down.
      const reach = gap === "above" ? NODE_WORDS_BELOW : NODE_WORDS_ABOVE;
      const room = Math.min(
        OPEN_ROOM,
        ...nodes
          .filter((p) => p[0] >= b.from[0] - 60 && p[0] <= b.to[0] + 10)
          .filter((p) => Math.hypot(p[0] - b.from[0], p[1] - b.from[1]) > 50 && Math.hypot(p[0] - b.to[0], p[1] - b.to[1]) > 50)
          .map((p) => up * (p[1] - lineY(b.from, b.to, Math.min(Math.max(p[0], b.from[0]), b.to[0]))) - reach)
          .filter((r) => r > -reach),
      );
      return { slack: room - natural[i], width: widest };
    }
    const other = column[j];
    let best = { slack: -Infinity, width: widest };
    const longestWord = Math.max(...b.text!.split(/\s+/).map((w) => heuristicMeasure(w, LABEL_FONT).w));
    for (let W = widest; ; W = Math.max(longestWord, W - 20)) {
      const lines = wrapText(b.text!, LABEL_FONT, W, heuristicMeasure);
      const w = Math.max(...lines.map((l) => heuristicMeasure(l, LABEL_FONT).w));
      const h = lines.length * LABEL_FONT * 1.25;
      // The strip's height across the box, wherever along the branch the
      // box finds most: from the own branch's far side of the box to the
      // nearer point of the strip's outer edge (the neighbour branch, or the
      // line that divides a shared strip).
      const k = shared ? part(i, j) : 1;
      const o = (x: number) => lineY(b.from, b.to, x);
      const d = (x: number) => o(x) + k * (lineY(other.from, other.to, x) - o(x));
      const up = gap === "above" ? 1 : -1;
      let room = -Infinity;
      for (let s = 0; s <= 4; s++) {
        const x0 = b.from[0] + 8 + ((b.to[0] - b.from[0] - 16 - w) * s) / 4;
        const x1 = x0 + w;
        room = Math.max(room, Math.min(up * d(x0), up * d(x1)) - Math.max(up * o(x0), up * o(x1)));
      }
      const slack = room - (h + 12);
      if (slack >= 0) return { slack, width: W };
      if (slack > best.slack) best = { slack, width: W };
      if (W <= longestWord) return best;
    }
  };
  const cost = (i: number, gap: Gap, shared: boolean): number => {
    const b = column[i];
    if (b.text === undefined) return 0;
    const { slack } = fit(i, gap, shared);
    // Graded, so two labels each a little short of a shared strip beat one
    // label far short of a wedge.
    let c = slack < 0 ? 50 - 10 * slack : 0;
    const outward: Gap = b.rank <= 0 ? "above" : "below";
    if (gap !== outward) c += b.rank === 0 ? 1 : 10;
    if (shared) c += 2;
    return c - Math.min(slack, OPEN_ROOM) / 1000; // roomier wins a tie
  };
  // best[i][g]: least cost for labels 0..i with label i taking gap g.
  // Label i−1 below and label i above share one strip: each is then costed
  // with its part of it (the i−1 term is re-costed on the transition).
  const gapsOf: Gap[] = ["above", "below"];
  const shares = (i: number, pg: Gap, g: Gap) => i > 0 && pg === "below" && g === "above" && column[i - 1].text !== undefined && column[i].text !== undefined;
  const best: { cost: number; prev: Gap | null }[][] = [];
  for (let i = 0; i < n; i++) {
    best.push(
      gapsOf.map((g) => {
        if (i === 0) return { cost: cost(0, g, false), prev: null };
        let pick: { cost: number; prev: Gap | null } = { cost: Infinity, prev: null };
        for (const pg of gapsOf) {
          const share = shares(i, pg, g);
          const redo = share ? cost(i - 1, "below", true) - cost(i - 1, "below", false) : 0;
          const c = best[i - 1][gapsOf.indexOf(pg)].cost + redo + cost(i, g, share);
          if (c < pick.cost) pick = { cost: c, prev: pg };
        }
        return pick;
      }),
    );
  }
  const gaps: Gap[] = new Array(n);
  let g: Gap = best[n - 1][0].cost <= best[n - 1][1].cost ? "above" : "below";
  for (let i = n - 1; i >= 0; i--) {
    gaps[i] = g;
    g = best[i][gapsOf.indexOf(g)].prev ?? g;
  }
  return gaps.map((gap, i) => {
    if (column[i].text === undefined) return { gap, share: 1, width: 0 };
    const shared = gap === "above" ? shares(i, gaps[i - 1], gap) : i + 1 < n && shares(i + 1, gap, gaps[i + 1]);
    return { gap, share: shared ? part(i, gap === "above" ? i - 1 : i + 1) : 1, width: fit(i, gap, shared).width };
  });
}

function lineY(a: Pt, b: Pt, x: number): number {
  return b[0] === a[0] ? a[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

function wrapWidth(b: BranchLabel): number {
  return branchLabelWidth(b.text!, Math.abs(b.to[0] - b.from[0]), Math.abs(b.uy) <= HORIZONTAL_UY ? 0 : Math.abs(b.uy / b.ux));
}

/** Where along its branch a label is wanted (0 = parent end, 1 = child end). */
const BRANCH_LABEL_T = 0.6;
/** How far a node's own words (name, payoff) reach above and below its centre. */
const NODE_WORDS_ABOVE = 55;
const NODE_WORDS_BELOW = 25;
/** An outermost strip has no neighbour to measure against. */
const OPEN_ROOM = 400;

/** Below this |uy| a branch is treated as horizontal — no wedge to stay out of. */
const HORIZONTAL_UY = 0.08;

/** Half the width of a terminal's triangle. */
const TERMINAL_HALF = 26;

/** Node names, payoffs, values and branch labels all share one size. */
const LABEL_FONT = 26;

/**
 * A branch label lives over its own branch, so the branch's horizontal span is
 * all the room it has: past that it reaches into the next column of nodes.
 * Long text WRAPS to that width ("Symptoms persist / or worsen / (p=0.12)")
 * instead of shrinking: the probability is the number the argument rests on,
 * and at 15 it was the smallest text on the page (2026-09-27). No line is cut
 * narrower than its longest word.
 */
function branchLabelWidth(text: string, span: number, slope: number): number {
  let room = Math.max(40, span - 24); // clear of the node at each end
  // A box centred over a steep branch is crossed by it wherever the line has
  // dropped more than the label's offset: keep half the width inside that.
  if (slope > 0) room = Math.min(room, (1.3 * (10 + LABEL_FONT * 0.55)) / slope * 2);
  const longestWord = Math.max(...text.split(/\s+/).map((w) => heuristicMeasure(w, LABEL_FONT).w));
  return Math.max(room, longestWord);
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
  const s = TERMINAL_HALF;
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
