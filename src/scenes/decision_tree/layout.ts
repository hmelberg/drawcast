// Deterministic decision-tree layout using d3-hierarchy's tidy tree.
// Health-economics conventions: decision = square, chance = circle,
// terminal = triangle. The LLM never places nodes.

import { hierarchy, tree, type HierarchyNode } from "d3-hierarchy";
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
import type { BBox } from "../../layout/geometry";
import { fitRegion, isFitName } from "../../layout/regions";

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

/** A terminal's payoff text ("12.4", "12.4, cost 300"), or nothing. */
function payoffOf(w: Wrapped): string | undefined {
  const payoff = w.node.payoff ?? w.branch?.payoff;
  const cost = w.node.cost ?? w.branch?.cost;
  if (payoff === undefined && cost === undefined) return undefined;
  const parts: string[] = [];
  if (payoff !== undefined) parts.push(String(payoff));
  if (cost !== undefined) parts.push(`cost ${cost}`);
  return parts.join(", ");
}

function nodeRadius(type: TreeNode["type"]): number {
  return type === "decision" ? 34 : type === "chance" ? 30 : 32;
}

export function layoutDecisionTree(params: DecisionTreeParams & { box?: unknown }): SceneLayout & { positions: Record<string, Pt> } {
  const rootWrapped = wrap(params.root, [0]);
  const h = hierarchy(rootWrapped, (d) => d.children);
  const box = boxOf(params.box);
  let placed = placeNodes(h, box, 1);
  // A box shorter than the tree's budget scales the whole tree down, and a
  // tree scaled by its height leaves the box's width unused. Laid out wider,
  // its fans' wedges open sooner and it needs less height: spread it toward
  // where its width and its height ask the same scale of the box, and keep
  // the spread that is shrunk least (a wrap can change on the way, so the
  // height need is not monotone in the width).
  if (box) {
    const room = box.h - 2 * BOX_PAD;
    const shrink = (g: number, p: typeof placed) => Math.max(g, p.extent / room);
    let best = { g: 1, placed, cost: shrink(1, placed) };
    let g = 1;
    for (let i = 0; i < 4; i++) {
      const want = placed.extent / room;
      if (want <= g * 1.02) break;
      g = (g + want) / 2;
      placed = placeNodes(h, box, g);
      if (shrink(g, placed) < best.cost - 0.01) best = { g, placed, cost: shrink(g, placed) };
    }
    placed = best.placed;
  }
  const placedAt = placed.at;

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const terminalNames: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const positions: Record<string, Pt> = {};
  const order: string[] = [];
  const attached: Record<string, string[]> = {};
  /** Where a non-terminal's name and value end on the right. */
  const words = new Map<string, { nameRight: number; valueRight?: number }>();

  const pos = (n: typeof h): Pt => placedAt.get(n)!;

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
      const payoffText = payoffOf(n.data);
      if (payoffText !== undefined) {
        // The payoff is placed before the name: it is the number the tree
        // folds back, and the name can move where the number cannot (a
        // crowded pair of terminals pushed "6" onto its own triangle).
        const payoffReq = labelReq(`payoff_${cleanId}`, [c[0] + PAYOFF_DX, c[1]], "right", payoffText, LABEL_FONT, COLORS.supply, own);
        payoffReq.minX = c[0] + TERMINAL_HALF;
        labels.push(payoffReq);
        order.push(`payoff_${cleanId}`);
        attached[id] = [...(attached[id] ?? []), `payoff_${cleanId}`];
      }
      // Solved after the branch labels: a name can take any corner right of
      // its triangle, a branch label has one strip.
      terminalNames.push(nameReq);
    } else {
      // Centred over the node, unless the branch coming in climbs through
      // the name's left end ("Watch with scans" struck through by the edge
      // from the decision above it): then as far right as that takes, short
      // of the node's own top branch.
      const nameW = textBox(node.label, NODE_LABEL_WIDTH).w;
      const nameDx = clearShift(n, nameW, "above", pos);
      words.set(cleanId, { nameRight: c[0] + nameDx + nameW / 2 });
      labels.push(labelReq(`label_${cleanId}`, [c[0] + nameDx, c[1] + nodeRadius(node.type)], "above", node.label, LABEL_FONT, COLORS.ink, own));
      order.push(`label_${cleanId}`);
      attached[id] = [...(attached[id] ?? []), `label_${cleanId}`];
      // The folded-back value, under the node it summarises and in the same
      // size as its name: models otherwise put "EV 11.6 y" on a scratch card,
      // off the tree, where the comparison can no longer be seen (2026-09-27).
      if (node.value !== undefined && node.value !== "") {
        const valueId = `value_${cleanId}`;
        // Likewise clear of a branch coming in from below.
        const valueW = textBox(String(node.value), NODE_LABEL_WIDTH).w;
        const valueDx = clearShift(n, valueW, "below", pos);
        words.get(cleanId)!.valueRight = c[0] + valueDx + valueW / 2;
        labels.push(labelReq(valueId, [c[0] + valueDx, c[1] - nodeRadius(node.type)], "below", String(node.value), LABEL_FONT, COLORS.supply));
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

    const siblings = parent.children ?? [];
    branchLabels.push({
      edgeId: id,
      labelId: `branchlabel_${parent.data.cleanId}_${n.data.cleanId}`,
      text: branchText(n.data.branch),
      // What the parent says under and over itself, which the fan's outer
      // labels must not slide into (see branchLabelRequests).
      parentWords: words.get(parent.data.cleanId)!,
      depth: parent.depth,
      from,
      to,
      uy,
      ux,
      // Where it sits in its own fan: the first child is the top one.
      rank: siblings.length <= 1 ? 0 : siblings.indexOf(n) / (siblings.length - 1) - 0.5,
      first: siblings.indexOf(n) === 0,
      last: siblings.indexOf(n) === siblings.length - 1,
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

/** A branch's label text: "Grows (p=0.53)", "p=0.2", "Watch", or nothing. */
function branchText(branch: TreeBranch | undefined): string | undefined {
  const parts: string[] = [];
  if (branch?.label) parts.push(branch.label);
  // 1/3 prints as 0.3333333333333333 — a token too long to wrap. Three
  // decimals is all a tree's reader uses.
  const p = branch?.probability !== undefined ? Number(branch.probability.toFixed(3)) : undefined;
  if (p !== undefined) parts.push(`p=${p}`);
  return parts.length === 0 ? undefined : p !== undefined && branch?.label ? `${branch.label} (p=${p})` : parts.join(" ");
}

/**
 * How far right of its node to centre a name (above it) or a value (below
 * it) of width w so the branch coming in — from the parent, up-left or
 * down-left — passes clear of the text's near corner. Bounded by the node's
 * own outer branch on that side, which leaves toward the right; where the
 * two cannot both be cleared, halfway.
 */
function clearShift(n: HierarchyNode<Wrapped>, w: number, side: "above" | "below", pos: (n: HierarchyNode<Wrapped>) => Pt): number {
  if (!n.parent) return 0;
  const c = pos(n);
  const p = pos(n.parent);
  const s = side === "above" ? 1 : -1;
  // The text's near edge stands this far from the centre; keep the line
  // this much short of it.
  const reach = nodeRadius(n.data.node.type) + LABEL_R - 8;
  const half = w / 2 + 4;
  const rise = s * (p[1] - c[1]);
  if (rise <= 0 || c[0] <= p[0]) return 0;
  const need = half - (reach * (c[0] - p[0])) / rise;
  if (need <= 0) return 0;
  const kids = n.children ?? [];
  const outer = side === "above" ? kids[0] : kids[kids.length - 1];
  if (outer) {
    const o = pos(outer);
    const riseO = s * (o[1] - c[1]);
    if (riseO > 0) {
      const room = (reach * (o[0] - c[0])) / riseO - half;
      if (room < need) return Math.max(0, (need + room) / 2);
    }
  }
  return need;
}

interface BranchLabel {
  edgeId: string;
  labelId: string;
  /** Undefined for a branch with nothing to say — it still bounds its neighbours' corridors. */
  text?: string;
  parentWords: { nameRight: number; valueRight?: number };
  /** The parent's depth: every edge of one column spans the same x-range. */
  depth: number;
  from: Pt;
  to: Pt;
  ux: number;
  uy: number;
  /** −0.5 = top of its fan, +0.5 = bottom, 0 = middle or only child. */
  rank: number;
  /** The top (first) and bottom (last) branch of its fan; an only child is both. */
  first: boolean;
  last: boolean;
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
      // The parent's value sits under it and its name over it. The fan's
      // bottom label, below its branch, slid back toward the parent under the
      // value ("Stays small (p=0.68)" into "EV 97.5", 2026-09-27); the top
      // label likewise into the name. Where the strip leaves room past them,
      // the label starts past them.
      const words = gap === "below" && b.last ? b.parentWords.valueRight : gap === "above" && b.first ? b.parentWords.nameRight : undefined;
      if (words !== undefined) {
        const xMin = words + 10;
        const w = Math.max(...wrapText(b.text, LABEL_FONT, width, heuristicMeasure).map((l) => heuristicMeasure(l, LABEL_FONT).w));
        if (x1 - xMin >= w + 8) req.corridors = req.corridors.map((c) => ({ ...c, xMin: Math.max(c.xMin, xMin) }));
      }
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
/** A label's line height, as the solver stacks lines (labels.ts LINE_HEIGHT). */
const LINE = LABEL_FONT * 1.25;
/** The widest a node's name runs before it wraps (labels.ts MAX_LABEL_WIDTH). */
const NODE_LABEL_WIDTH = 280;

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

/** Where a terminal's payoff is anchored, right of its centre. */
const PAYOFF_DX = 42;
/** The solver's first-ring offset for a label at LABEL_FONT (labels.ts: 10 + 0.55 × font). */
const LABEL_R = 10 + LABEL_FONT * 0.55;
/** A column never narrower than this, whatever its labels. */
const COLUMN_MIN = 230;
/** A column's room besides its label: the two nodes' radii, their clearances, some air. */
const COLUMN_ENDS = 100;
/** Past this a branch label wraps rather than widening its column. */
const COLUMN_LABEL_MAX = 300;
/** Clearance a label keeps from each line that bounds it (labels.ts CORRIDOR_CLEAR), plus air. */
const STRIP_CLEAR = 9;
/** Measured text runs up to this much wider in a browser than heuristically (the tests use ×1.15). */
const TEXT_SLACK = 1.15;
/** Room over the top node and under the bottom one, before a box is full. */
const BOX_PAD = 8;

type Node = HierarchyNode<Wrapped>;

/** A label's box at LABEL_FONT, wrapped at maxWidth. */
function textBox(text: string, maxWidth: number): { w: number; h: number } {
  const lines = wrapText(text, LABEL_FONT, maxWidth, heuristicMeasure);
  return { w: Math.max(...lines.map((l) => heuristicMeasure(l, LABEL_FONT).w)), h: lines.length * LINE };
}

function boxOf(v: unknown): BBox | null {
  if (isFitName(v)) return fitRegion(v);
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  if (!["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k]))) return null;
  const r = b as unknown as BBox;
  return r.w > 0 && r.h > 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}

/**
 * Where every node goes. The tidy tree used to hand each leaf the same slot
 * and stretch the tree to the page, so a three-way fan got the spacing of a
 * two-way one and its middle label had no wedge to sit in (the aneurysm
 * tree: "Grows (p=0.3)" exiled under the fan, "Stays small (p=0.68)" on
 * "EV 97.5", 2026-09-27). Now the room is budgeted from what must fit:
 *
 * - each column is as wide as its longest branch label asks, so a column of
 *   bare edges (a decision's unlabelled options) gives its width to the
 *   column that talks;
 * - two neighbouring nodes are as far apart as their words (name above,
 *   value or payoff below) and the branch labels between them need — for two
 *   branches of one fan that is the WEDGE, which opens from nothing at the
 *   parent, so the label that sits in it asks for the spacing that opens it
 *   wide enough where the label starts;
 * - with a box the tree is laid out in the box itself, at label size, instead
 *   of on the whole canvas and shrunk into it.
 */
function placeNodes(h: Node, boxParam: BBox | null, widen: number): { at: Map<Node, Pt>; extent: number } {
  const nodes = h.descendants();
  const order = new Map(nodes.map((n, i) => [n, i] as const)); // breadth-first: within a depth, top to bottom
  const depth = h.height;
  const node = (n: Node) => n.data.node;

  // Horizontal: the root's name overhangs it on the left, the terminals'
  // names and payoffs on the right.
  const rootHalf = Math.max(textBox(node(h).label, NODE_LABEL_WIDTH).w, node(h).value ? textBox(String(node(h).value), NODE_LABEL_WIDTH).w : 0) / 2;
  const rightWords = Math.max(
    0,
    ...nodes
      .filter((n) => node(n).type === "terminal")
      .map((n) => {
        const pay = payoffOf(n.data);
        return Math.max(LABEL_R + textBox(node(n).label, NODE_LABEL_WIDTH).w, pay === undefined ? 0 : PAYOFF_DX + LABEL_R + textBox(pay, NODE_LABEL_WIDTH).w);
      }),
  );
  const [x0, x1] = boxParam
    ? [boxParam.x + Math.min(Math.max(rootHalf + 10, 45), 160), boxParam.x + boxParam.w * widen - Math.min(Math.max(rightWords * TEXT_SLACK + 10, 120), 320)]
    : [MARGIN.left, CANVAS.w - MARGIN.right];

  const need = new Array<number>(depth).fill(COLUMN_MIN);
  for (const n of nodes) {
    const t = n.parent && branchText(n.data.branch);
    if (t) need[n.parent!.depth] = Math.max(need[n.parent!.depth], Math.min(textBox(t, Infinity).w * TEXT_SLACK, COLUMN_LABEL_MAX) + COLUMN_ENDS);
  }
  const total = need.reduce((a, b) => a + b, 0);
  const col = need.map((v) => (v * (x1 - x0)) / (total || 1));
  const xAt = (d: number) => x0 + col.slice(0, d).reduce((a, b) => a + b, 0);

  // Vertical: what each node's words take above and below its centre.
  const above = (n: Node): number => {
    const nameH = textBox(node(n).label, NODE_LABEL_WIDTH).h;
    return node(n).type === "terminal" ? LABEL_R + nameH : nodeRadius(node(n).type) + LABEL_R + nameH;
  };
  const below = (n: Node): number => {
    const v = node(n).value;
    if (node(n).type === "terminal") return payoffOf(n.data) !== undefined ? LINE / 2 + 2 : TERMINAL_HALF;
    return v !== undefined && v !== "" ? nodeRadius(node(n).type) + LABEL_R + textBox(String(v), NODE_LABEL_WIDTH).h : nodeRadius(node(n).type) + 6;
  };
  // Which side of its branch a label will take (assignStrips decides; this
  // is its first choice): outside its fan for the outer two, and for a middle
  // one the wedge on its outward side.
  const gapOf = (n: Node): Gap => {
    const sibs = n.parent!.children!;
    const i = sibs.indexOf(n);
    if (sibs.length === 1 || i === 0) return "above";
    if (i === sibs.length - 1) return "below";
    return i / (sibs.length - 1) - 0.5 <= 0 ? "above" : "below";
  };
  // A label wraps at its column's room less the widest a browser's text runs.
  const labelWidth = (n: Node) => Math.max(60, (col[n.parent!.depth] - COLUMN_ENDS) / TEXT_SLACK);
  const labelOn = (n: Node, gap: Gap) => {
    const t = n.parent ? branchText(n.data.branch) : undefined;
    return t !== undefined && gapOf(n) === gap ? t : undefined;
  };
  /** What a node and the branch label on each side of it take, above and below its centre. */
  const up = (n: Node) => {
    const t = labelOn(n, "above");
    return Math.max(above(n), t === undefined ? 0 : textBox(t, labelWidth(n)).h + 2 * STRIP_CLEAR);
  };
  const down = (n: Node) => {
    const t = labelOn(n, "below");
    return Math.max(below(n), t === undefined ? 0 : textBox(t, labelWidth(n)).h + 2 * STRIP_CLEAR);
  };
  /** The spacing that opens a fan's wedge enough for `text` near the child end. */
  const wedge = (text: string, c: number): number => {
    let best = Infinity;
    const words = text.split(/\s+/).length;
    for (let W = (c - COLUMN_ENDS) / TEXT_SLACK, k = 0; k < words && W > 0; k++) {
      const { w, h } = textBox(text, W);
      const f = (c - nodeRadius("terminal") - 8 - w * TEXT_SLACK) / c;
      if (f > 0.12) best = Math.min(best, (h + 2 * STRIP_CLEAR) / f);
      W = w - 1;
    }
    return Number.isFinite(best) ? best : (textBox(text, 0).h + 2 * STRIP_CLEAR) / 0.12;
  };
  // A terminal short of the last column has its name and payoff out in the
  // next column, where the tidy tree, which only compares nodes of one
  // depth, never looks: a neighbouring subtree's leaves came down onto them
  // (the few-shot's "Complication (p=0.15)" over "No operation"). Its
  // neighbour subtree's full reach is measured in a first pass.
  const reach = new Map<Node, { up: number; down: number }>();
  const shallowTerminal = (n: Node) => node(n).type === "terminal" && n.depth < depth;
  const sep = (a: Node, b: Node): number => {
    const [u, l] = order.get(a)! < order.get(b)! ? [a, b] : [b, a];
    let d = below(u) + above(l) + 8;
    const uLabel = labelOn(u, "below");
    const lLabel = labelOn(l, "above");
    if (u.parent && u.parent === l.parent) {
      const t = uLabel ?? lLabel;
      if (t) d = Math.max(d, wedge(t, col[u.parent.depth]));
    } else {
      // The strip between two fans holds the bottom label of one and the
      // top label of the other; the nodes' own words are further right.
      d = Math.max(d, (uLabel ? down(u) : 0) + (lLabel ? up(l) : 0) + 6);
    }
    if (shallowTerminal(l) && reach.has(u)) d = Math.max(d, reach.get(u)!.down + up(l) + 8);
    if (shallowTerminal(u) && reach.has(l)) d = Math.max(d, down(u) + reach.get(l)!.up + 8);
    return d;
  };
  const bx = (n: Node) => (n as Node & { x: number }).x;
  const layout = tree<Wrapped>().nodeSize([1, 1]).separation(sep);
  layout(h);
  if (nodes.some(shallowTerminal)) {
    for (const n of nodes) {
      if (!n.children) continue;
      const sub = n.descendants().slice(1);
      reach.set(n, {
        up: Math.max(...sub.map((m) => bx(n) - bx(m) + up(m))),
        down: Math.max(...sub.map((m) => bx(m) - bx(n) + down(m))),
      });
    }
    layout(h);
  }

  // d3's x is breadth, top down. Logical y is up.
  const lo = Math.min(...nodes.map(bx));
  const hi = Math.max(...nodes.map(bx));
  const out = new Map<Node, Pt>();
  if (!boxParam) {
    // On the bare canvas the nodes fill the plot band, as they always have.
    const plotH = CANVAS.h - MARGIN.top - MARGIN.bottom;
    const k = hi > lo ? plotH / (hi - lo) : 0;
    for (const n of nodes) out.set(n, [xAt(n.depth), hi > lo ? CANVAS.h - MARGIN.top - (bx(n) - lo) * k : MARGIN.bottom + plotH / 2]);
    return { at: out, extent: plotH };
  }
  // In a box: at the spacing budgeted, centred, words and outer labels
  // included. A box too small overflows here, and the template fit then
  // scales the whole tree, words and all, into it — the budget holds.
  const top = Math.max(...nodes.map((n) => -bx(n) + up(n)));
  const bottom = Math.min(...nodes.map((n) => -bx(n) - down(n)));
  const room = boxParam.h - 2 * BOX_PAD;
  const k = hi > lo ? Math.max(1, Math.min(BOX_STRETCH, 1 + (room - (top - bottom)) / (hi - lo))) : 1;
  const mid = boxParam.y + boxParam.h / 2;
  // Stretched by k, the words' extent is [bottom', top'] about the nodes.
  const yOf = (n: Node) => -bx(n) * k;
  const topK = Math.max(...nodes.map((n) => yOf(n) + up(n)));
  const bottomK = Math.min(...nodes.map((n) => yOf(n) - down(n)));
  const shift = mid - (topK + bottomK) / 2;
  for (const n of nodes) out.set(n, [xAt(n.depth) - (boxParam.w * (widen - 1)) / 2, yOf(n) + shift]);
  return { at: out, extent: topK - bottomK };
}

/** How much a box may spread the tree past its budget, to fill the box. */
const BOX_STRETCH = 1.3;

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
