// Deterministic decision-tree layout using d3-hierarchy's tidy tree.
// Health-economics conventions: decision = square, chance = circle,
// terminal = triangle. The LLM never places nodes.

import { hierarchy, tree, type HierarchyNode } from "d3-hierarchy";
import { CANVAS } from "../../layout/canvas";
import { heuristicMeasure } from "../../layout/measure";
import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type StrokeDrawable,
} from "../../layout/model";
import { preferredLabelBox, wrapText, type LabelCorridor, type LabelRequest } from "../../layout/labels";
import { unionBBoxForId, unionBoxes } from "../../layout/boxes";
import type { SceneLayout } from "../types";
import type { BBox } from "../../layout/geometry";
import { fitRegion, isFitName } from "../../layout/regions";
import { fitSceneLayout } from "../../layout/template-fit";
import { FONT_FLOOR } from "../../lint/lint";
import { kit } from "../kit";
import { nodeId, rollback, strategyTable, type Rolled, type StrategyRow } from "./rollback";

export interface TreeNode {
  id?: string;
  type: "decision" | "chance" | "terminal";
  label: string;
  /** Outcome value at a terminal (e.g. QALYs). May also sit on the incoming branch. */
  payoff?: number;
  cost?: number;
  /** Folded-back value at a chance or decision node ("EV 11.6 y"), drawn as value_<id>. Overrides the computed one. */
  value?: string;
  /** Drawn as a leaf with a fan of stubs (collapsed_<id>): its subtree is not laid out, but still folded back. */
  collapsed?: boolean;
  /** A terminal's working, shown under a wrong payoff/cost blank ("12 × £300"). */
  work?: string;
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
  /** Fold the tree back: every chance and decision node gets its computed value, each decision its chosen branch. */
  rollback?: boolean;
  /** Willingness to pay per unit of payoff: decisions then maximise payoff·wtp − cost. */
  wtp?: number;
  /** Money prefix for costs ("£", "$", "kr "). */
  currency?: string;
  /** The payoff's unit ("QALYs", "years"): the table's effect column, and after node values. */
  unit?: string;
  /** Decimals for payoffs (default 2). */
  decimals?: number;
  /** false hides the strategy table that a rolled-back tree with costs draws. */
  table?: boolean;
  /**
   * How a tree too big for the page is drawn. "page": its words shrink (to
   * the lint's floor) until it fits one page. "full": its words stay full
   * size and the tree is laid out at the spacing they need, larger than the
   * page — a world (SceneLayout.world) the camera walks through. Unset: the
   * page, unless the page would need its words below the floor (they would
   * collide), then full.
   */
  size?: "page" | "full";
  /** The region the tree fills: {x, y, w, h} (layout.ts resolves a region name before the template sees it). */
  box?: unknown;
  /**
   * Internal (tree blanks): part id → the text drawn for that number
   * ("?", or the viewer's answer). value_<id>, effect_<id>, cost_<id>
   * replace the whole text; branchlabel_<p>_<c> only its probability (the
   * branch keeps its name). The fold-back itself is unchanged.
   */
  answers?: Record<string, string>;
}

interface Wrapped {
  cleanId: string;
  node: TreeNode;
  /** The incoming branch — with a missing probability filled in, under rollback. */
  branch?: TreeBranch;
  children: Wrapped[];
  /** Drawn as a leaf: its children are hidden. */
  collapsed: boolean;
  /** The text under a chance/decision node: its `value`, else under rollback the computed one. */
  value?: string;
  /** A terminal's numbers: its payoff (effect_<id>) and its cost (cost_<id>), as drawn. */
  effect?: string;
  cost?: string;
  /** The incoming branch's label text (branchText). */
  branchLabel?: string;
}

// top 95 clears the card heading (y > 690); bottom 150 clears the narration band,
// which covers the bottom ~15% of the stage while a line is spoken (2026-09-25).
// right 230 holds a terminal's label and payoff ("Complication", 9) with room
// to spare: at 180 they ran to the canvas edge while the left sat empty
// (Hans, 2026-09-26: "very close to the right edge … just have some slightly
// shorter arrows").
const MARGIN = { left: 85, right: 230, top: 95, bottom: 150 };

/** How a tree's numbers are written; under rollback, what it computed. */
interface WrapCtx {
  rolled: Rolled | null;
  fmt: Format;
  /** DecisionTreeParams.answers: drawn in place of the numbers they name. */
  answers: Record<string, string>;
}

function wrap(node: TreeNode, path: number[], ctx: WrapCtx, branch?: TreeBranch, parentId?: string): Wrapped {
  const cleanId = nodeId(node, path);
  const kids = node.children ?? [];
  const collapsed = node.collapsed === true && node.type !== "terminal" && kids.length > 0;
  const { rolled, fmt, answers } = ctx;
  const child = (b: TreeBranch, i: number): Wrapped => {
    const key = `${cleanId}_${nodeId(b.node, [...path, i])}`;
    const filled = rolled?.filled.has(key) ? { ...b, probability: rolled.p[key] } : b;
    return wrap(b.node, [...path, i], ctx, filled, cleanId);
  };
  let value = node.value != null && node.value !== "" ? String(node.value) : undefined;
  // `value: ""` draws none: the root decision's value repeats its pick's, and
  // a cast that says so aloud may leave it off (it is drawn at the end
  // otherwise, as every id the cast never names is).
  if (node.value == null && rolled && node.type !== "terminal") value = nodeValueText(rolled, cleanId, fmt);
  const over = answers[`value_${cleanId}`];
  if (over !== undefined) value = over;
  return {
    cleanId,
    node,
    branch,
    collapsed,
    children: collapsed ? [] : kids.map(child),
    value,
    ...(node.type === "terminal" ? terminalTexts(node, cleanId, branch, fmt, rolled !== null, answers) : {}),
    branchLabel: branchText(
      branch,
      node.type !== "terminal" && kids.length > 0 && typeof branch?.cost === "number" && Number.isFinite(branch.cost) ? fmt.cost(branch.cost) : undefined,
      parentId !== undefined ? answers[`branchlabel_${parentId}_${cleanId}`] : undefined,
    ),
  };
}

/**
 * A terminal's two numbers, each its own text: the payoff ("12.4"; under
 * rollback in the tree's decimals and locale) and the cost ("£300", or
 * "2,300" with no currency — its column's heading says what it is). They
 * were one text, "9.5, $150,000", and a payoff and a cost that close read as
 * one number (Hans, 2026-09-27: "so close it is confusing"). An answer
 * (effect_<id>, cost_<id>) is drawn in a number's place.
 */
function terminalTexts(node: TreeNode, id: string, branch: TreeBranch | undefined, fmt: Format, rolled: boolean, answers: Record<string, string>): { effect?: string; cost?: string } {
  const payoff = node.payoff ?? branch?.payoff;
  const cost = node.cost ?? branch?.cost;
  return {
    ...(typeof payoff === "number" && { effect: answers[`effect_${id}`] ?? (rolled ? fmt.num(payoff) : String(payoff)) }),
    ...(typeof cost === "number" && { cost: answers[`cost_${id}`] ?? fmt.money(cost) }),
  };
}

/**
 * A folded-back node's text: "8.95", "8.95 QALYs", or its effect and its
 * cost set apart by a dot, "7.1 · $78,000" ("7.1, $78,000" read as one
 * number, Hans 2026-09-27) — or nothing where a number below is missing.
 * Not "7.1 QALYs · $78,000", nor the two on two lines: a value is centred
 * under its node, where the fan's branches leave and come in, and each
 * version pushed a branch label off its branch (the appendicitis and the
 * screening trees, 2026-09-27). The money sign, or "cost", says which is
 * which.
 */
function nodeValueText(rolled: Rolled, id: string, fmt: Format): string | undefined {
  const e = rolled.ev[id];
  const c = rolled.cost[id];
  if (e !== undefined && c !== undefined) return `${fmt.num(e)} · ${fmt.cost(c)}`;
  if (e !== undefined) return fmt.unit ? `${fmt.num(e)} ${fmt.unit}` : fmt.num(e);
  return c !== undefined ? fmt.cost(c) : undefined;
}

interface Format {
  num(v: number): string;
  /** Money, currency prefixed; bare numbers in the table's cost columns. */
  money(v: number): string;
  /** A cost beside a payoff: money, or "cost 2,300" with no currency to say what it is. */
  cost(v: number): string;
  /** The number `money` shows (to the 100 from 10,000, to 0.01m from a million). */
  moneyRound(v: number): number;
  /** The number `num` shows. */
  round(v: number): number;
  unit?: string;
}

function formatOf(params: DecisionTreeParams): Format {
  const decimals = Math.min(Math.max(Math.round(typeof params.decimals === "number" ? params.decimals : 2), 0), 6);
  const cur = typeof params.currency === "string" ? params.currency : "";
  // The figure's locale (kit.num): 8,95 and 12 000 in a Norwegian cast.
  const comma = kit.num(0.5) !== "0.5";
  const thousands = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, comma ? " " : ",");
  const money = (v: number) => {
    const a = Math.abs(v);
    const sign = v < -1e-9 ? "−" : "";
    const body = a >= 1e6 ? `${kit.num(Number((a / 1e6).toFixed(a >= 1e7 ? 1 : 2)))}m` : a >= 1e4 ? thousands(Math.round(a / 100) * 100) : thousands(a);
    return `${sign}${cur}${body}`;
  };
  const moneyRound = (v: number) => {
    const a = Math.abs(v);
    const r = a >= 1e6 ? Math.round(Number((a / 1e6).toFixed(a >= 1e7 ? 1 : 2)) * 1e6) : a >= 1e4 ? Math.round(a / 100) * 100 : Math.round(a);
    return v < 0 ? -r : r;
  };
  return {
    num: (v) => kit.num(Number(v.toFixed(decimals))),
    money,
    moneyRound,
    round: (v) => Number(v.toFixed(decimals)),
    cost: (v) => (cur ? money(v) : `cost ${money(v)}`),
    unit: typeof params.unit === "string" && params.unit.trim() ? params.unit.trim() : undefined,
  };
}

/**
 * A tree number as the tree draws it, for what is said about it (a tree
 * ask's stored variables): a value or payoff in the tree's decimals and
 * locale ("7", not "7.0"), a cost as money, a probability as a branch label
 * shows it (up to three decimals).
 */
export function treeNumberText(params: DecisionTreeParams): (v: number, kind: "value" | "effect" | "cost" | "probability") => string {
  const f = formatOf(params);
  return (v, kind) => (kind === "probability" ? String(Number(v.toFixed(3))) : kind === "cost" ? f.money(v) : f.num(v));
}

/** Whether a terminal has numbers to draw. */
function hasNumbers(w: Wrapped): boolean {
  return w.effect !== undefined || w.cost !== undefined;
}

function nodeRadius(type: TreeNode["type"]): number {
  return type === "decision" ? 34 : type === "chance" ? 30 : 32;
}

type TreeLayout = SceneLayout & { positions: Record<string, Pt>; scale: number; textSize: number };

export function layoutDecisionTree(params: DecisionTreeParams & { box?: unknown }): TreeLayout {
  if (params.size === "full") return layoutTree(params, true);
  const page = layoutTree(params, false);
  // Scaled onto the page past the floor, its words are held at the floor
  // while the tree shrinks under them: they collide (twenty terminals: a
  // dozen overlaps and leader lines everywhere). Full size, in a world, they
  // do not.
  if (params.size === "page" || page.scale >= 1 || MIN_FONT * page.scale >= FONT_FLOOR - 1e-9) return page;
  return layoutTree(params, true);
}

/** The tree on one page, or with `full` at full size in a world larger than the page when the page cannot hold it at full size. */
function layoutTree(params: DecisionTreeParams & { box?: unknown }, full: boolean): TreeLayout {
  const rolled = params.rollback === true && params.root ? rollback(params.root, { wtp: params.wtp }) : null;
  const fmt = formatOf(params);
  const rootWrapped = wrap(params.root, [0], { rolled, fmt, answers: params.answers ?? {} });
  const h = hierarchy(rootWrapped, (d) => d.children);

  // The strategy table takes the bottom of the page (or of the box), and the
  // tree the rest. On the page its bottom stands on the narration band (it
  // was drawn from BIG_REGION's bottom, under two-line captions, 2026-09-27).
  let table = rolled && params.table !== false ? tableOf(params, rolled, fmt) : null;
  let reserve = table ? table.h + TABLE_GAP : 0;
  const outer = boxOf(params.box);
  let box: BBox | null = outer && reserve > 0 ? { ...outer, y: outer.y + reserve, h: Math.max(outer.h - reserve, outer.h * 0.4) } : outer;
  // A tree whose words need more height than the page has (nine terminals
  // and up) was squeezed to the plot band at full text size, its labels on
  // top of each other. Its words get smaller first, down to MIN_FONT; past
  // that it is laid out at the spacing its words need and the whole figure,
  // words and all, scaled onto the page, the text held at the lint's floor
  // (template-fit.ts). "Squeezed" = the band gives the nodes less than the
  // spacing their words were budgeted (k < 1), so every tree that fits is
  // laid out exactly as it always was.
  useFont(BASE_FONT);
  // A terminal's numbers stand in columns with a heading — the payoff (its
  // unit, or "Payoff") and the cost — whenever there is more than a bare
  // payoff to show: under rollback, with costs, or with a unit to name. A
  // tree of bare payoffs keeps each by its terminal, as it always was.
  const ends = h.leaves().filter((n) => n.data.node.type === "terminal");
  const anyCost = ends.some((n) => n.data.cost !== undefined);
  const anyEffect = ends.some((n) => n.data.effect !== undefined);
  HEADS = rolled !== null || anyCost || (fmt.unit !== undefined && anyEffect) ? { effect: anyEffect ? fmt.unit ?? kit.say(anyCost ? { en: "Effect", nb: "Effekt" } : { en: "Payoff", nb: "Utfall" }) : undefined, cost: anyCost ? kit.say({ en: "Cost", nb: "Kostnad" }) : undefined } : null;
  INLINE_TERMINALS = HEADS !== null;
  // The ends of one depth share a pair of columns, headed over the topmost
  // of them: the first of its depth breadth-first (a tidy tree keeps the
  // order within a depth, top down).
  HEAD_OVER = new Set();
  if (HEADS) {
    const seen = new Set<number>();
    for (const n of h.descendants()) {
      if (n.data.node.type !== "terminal" || !hasNumbers(n.data) || seen.has(n.depth)) continue;
      seen.add(n.depth);
      HEAD_OVER.add(n.data);
    }
  }
  let squeeze: BBox | null = null;
  /** Laid out at full size in a world larger than the page (`size: "full"`). */
  let spread = false;
  // The band's bottom holds the nodes; the words under the lowest node (a
  // chance node's value, its bottom branch's label) hang below it, toward
  // the table: the table's reserve takes them too, at the words' size.
  const tableReserve = (): number => {
    const base = table!.h + TABLE_GAP;
    const low = placeNodes(h, null, 1, base).low;
    return base + Math.max(0, Math.ceil(MARGIN.bottom + table!.h + WORDS_GAP - low));
  };
  if (!box && table) reserve = tableReserve();
  if (!box) {
    let { k } = placeNodes(h, null, 1, reserve);
    // A rolled-back tree is new, so it may ask more of its budget (0.9: its
    // ends carry long numbers; every tree before it keeps the 0.8 it was drawn with).
    const K = rolled && !table ? 0.9 : SQUEEZE_K;
    if (k > 0 && k < K && full) {
      spread = true;
      // Its ends in one line each, name then numbers — as a rolled-back
      // tree's are: a name over its payoff took half as much height again,
      // and a world's height is what its overview shrinks by.
      INLINE_TERMINALS = true;
    }
    else if (k > 0 && k < K) {
      for (let f = BASE_FONT - 1; f >= MIN_FONT && k < K; f--) {
        useFont(f);
        if (table) {
          table = tableOf(params, rolled!, fmt, SMALL);
          reserve = tableReserve();
        }
        k = placeNodes(h, null, 1, reserve).k;
      }
      if (k < K) {
        // Scaled into the page over the table (its words padded in by the fit).
        const bottom = table ? MARGIN.bottom + table.h + TABLE_GAP : BIG_REGION.y;
        box = squeeze = table ? { ...BIG_REGION, y: bottom, h: BIG_REGION.y + BIG_REGION.h - bottom } : { ...BIG_REGION, y: BIG_REGION.y + reserve, h: BIG_REGION.h - reserve };
      }
    }
  }
  // A box shorter than the tree's budget scales the whole tree down, and a
  // tree scaled by its height leaves the box's width unused. Laid out wider,
  // its fans' wedges open sooner and it needs less height: spread it toward
  // where its width and its height ask the same scale of the box, and keep
  // the spread that is shrunk least (a wrap can change on the way, so the
  // height need is not monotone in the width).
  const widened = (region: BBox, fillIt: boolean) => {
    const room = region.h - 2 * BOX_PAD;
    const shrink = (g: number, p: ReturnType<typeof placeNodes>) => Math.max(g, p.extent / room);
    let p = placeNodes(h, region, 1, reserve, false, fillIt);
    let best = { placed: p, cost: shrink(1, p) };
    let g = 1;
    for (let i = 0; i < 4; i++) {
      const want = p.extent / room;
      if (want <= g * 1.02) break;
      g = (g + want) / 2;
      p = placeNodes(h, region, g, reserve, false, fillIt);
      if (shrink(g, p) < best.cost - 0.01) best = { placed: p, cost: shrink(g, p) };
    }
    return best;
  };
  /** The author's box, which the tree fills (not the page's squeeze region). */
  const fill = box !== null && squeeze === null;
  if (fill) {
    // In a box the tree takes the largest words it fits at — up to
    // BOX_FONT_MAX in a roomy box (it was laid out at label size and then
    // fitted again, smaller, by the page: 940 × 490 drew it smaller than
    // the bare page, 2026-09-27), down to MIN_FONT in a narrow one. Where
    // the box is short, laying it out wider at label size and scaling it
    // into the box (words and all) may keep its words larger than any size
    // it fits at: then that. Bigger than label size, it keeps some air.
    const room = box!.h - 2 * BOX_PAD;
    const fits = (p: ReturnType<typeof placeNodes>, f: number) => (f > BASE_FONT ? p.extent * BOX_AIR <= room && p.wFit >= BOX_AIR : p.extent <= room && p.wFit >= 1);
    let fitsAt = 0;
    for (let f = BOX_FONT_MAX; f >= MIN_FONT && fitsAt === 0; f--) {
      useFont(f);
      if (fits(placeNodes(h, box, 1, reserve, false, true), f)) fitsAt = f;
    }
    if (fitsAt < BASE_FONT) {
      useFont(BASE_FONT);
      // The fit pads the ink (FIT_PAD) and the words overhang the nodes' extent: a little under 1 / cost.
      const scaled = (BASE_FONT * 0.92) / widened(box!, true).cost;
      if (scaled > fitsAt) squeeze = box;
      else useFont(fitsAt);
    }
  }
  let placed = squeeze ? widened(squeeze, fill).placed : placeNodes(h, box, 1, spread ? 0 : reserve, spread, fill);
  if (spread) {
    // A world is seen whole at rest, fitted to 4 : 3: a tree ten pages tall
    // and one wide is a thread. Wider columns open the fans' wedges sooner
    // and the tree needs less height: take the widening whose world the rest
    // view shrinks least.
    const shrink = (p: typeof placed) => Math.max(p.w / CANVAS.w, p.h / CANVAS.h);
    let best = { placed, cost: shrink(placed) };
    for (const g of WORLD_WIDEN) {
      const p = placeNodes(h, null, g, 0, true);
      if (shrink(p) < best.cost - 0.02) best = { placed: p, cost: shrink(p) };
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
  const groups: Record<string, string[]> = {};
  const drawnWith: Record<string, string[]> = {};
  /** Where a non-terminal's name and value end on the right. */
  const words = new Map<string, { nameRight: number; valueRight?: number }>();
  /** The terminals whose numbers stand in the columns. */
  const rows: { n: typeof h; c: Pt }[] = [];

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
    if (n.data.collapsed) {
      // A fan of stubs where its branches would leave: "more tree here".
      const stubs = collapsedStubs(`collapsed_${cleanId}`, node.type, c);
      drawables.push(stubs);
      order.push(stubs.id);
      attached[id] = [...(attached[id] ?? []), stubs.id];
    }

    // A node's label may sit near the branch that ARRIVES at it — otherwise
    // it drifts sideways to dodge its own incoming edge and lands in the space
    // the branch labels need (the "Medication" label ending up 90 units right
    // of its own circle was what pushed "Symptoms resolve (p=0.7)" off its
    // branch). The node shape itself stays an obstacle: a label allowed to
    // ignore that lands on top of the square.
    const own = n.parent ? [`edge_${n.parent.data.cleanId}_${cleanId}`] : [];
    if (n.parent && rolled?.bestId[n.parent.data.cleanId] === cleanId && n.parent.data.node.type === "decision") own.push(`best_${n.parent.data.cleanId}_${cleanId}`);
    if (node.type === "terminal" && INLINE_TERMINALS) {
      // The ends read as a table's rows: name, then its numbers, on one line
      // right of the triangle — half the height of a name over the numbers,
      // which a tree with costs (long numbers, a table under it) cannot
      // spare. The numbers go in columns once every node is placed (below).
      const nameX = c[0] + TERMINAL_HALF + 8;
      const nameReq = labelReq(`label_${cleanId}`, [nameX - LABEL_R, c[1]], "right", node.label, LABEL_FONT, COLORS.ink, own);
      nameReq.minX = c[0] + TERMINAL_HALF;
      nameReq.sides = ["right"];
      labels.push(nameReq);
      order.push(nameReq.id);
      attached[id] = [...(attached[id] ?? []), nameReq.id];
      if (hasNumbers(n.data)) {
        rows.push({ n, c });
        // Its numbers' ids, in the order a draw reads them (filled below).
        order.push(`payoff_${cleanId}`);
      }
    } else if (node.type === "terminal") {
      const nameReq = labelReq(`label_${cleanId}`, c, "above-right", node.label, LABEL_FONT, COLORS.ink, own);
      // Never left of its own triangle: crowded out of its corner, a
      // terminal's name (or payoff) drifted onto the branches and read as a
      // branch label, in the middle of the tree (2026-09-27).
      nameReq.minX = c[0] - TERMINAL_HALF;
      order.push(`label_${cleanId}`);
      attached[id] = [...(attached[id] ?? []), `label_${cleanId}`];
      const payoffText = n.data.effect;
      if (payoffText !== undefined) {
        // The payoff is placed before the name: it is the number the tree
        // folds back, and the name can move where the number cannot (a
        // crowded pair of terminals pushed "6" onto its own triangle).
        const payoffReq = labelReq(`effect_${cleanId}`, [c[0] + PAYOFF_DX, c[1]], "right", payoffText, SMALL, COLORS.supply, own);
        payoffReq.minX = c[0] + TERMINAL_HALF;
        labels.push(payoffReq);
        order.push(payoffReq.id);
        attached[id] = [...(attached[id] ?? []), payoffReq.id];
        groups[`payoff_${cleanId}`] = [payoffReq.id];
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
      // In a world the branch coming in is an obstacle too: unsqueezed, a
      // branch falls steeply into a big subtree's node, and a name free to
      // sit on it slid back along it ("Knee replacement", 2026-09-27). A
      // world has the room to look further.
      labels.push(labelReq(`label_${cleanId}`, [c[0] + nameDx, c[1] + nodeRadius(node.type)], "above", node.label, LABEL_FONT, COLORS.ink, spread ? [] : own));
      order.push(`label_${cleanId}`);
      attached[id] = [...(attached[id] ?? []), `label_${cleanId}`];
      // The folded-back value, under the node it summarises, in the numbers'
      // size: models otherwise put "EV 11.6 y" on a scratch card,
      // off the tree, where the comparison can no longer be seen (2026-09-27).
      const value = n.data.value;
      if (value !== undefined) {
        const valueId = `value_${cleanId}`;
        // Likewise clear of a branch coming in from below.
        const valueW = textBox(value, NODE_LABEL_WIDTH, SMALL).w;
        const valueDx = clearShift(n, valueW, "below", pos);
        words.get(cleanId)!.valueRight = c[0] + valueDx + valueW / 2;
        labels.push(labelReq(valueId, [c[0] + valueDx, c[1] - nodeRadius(node.type)], "below", value, SMALL, COLORS.supply));
        order.push(valueId);
        attached[id] = [...(attached[id] ?? []), valueId];
      }
    }
  }

  if (rows.length > 0) {
    const depths = [...new Set(rows.map((r) => r.n.depth))];
    const heads: { effect: string[]; cost: string[] } = { effect: [], cost: [] };
    for (const d of depths) {
      const group = rows.filter((r) => r.n.depth === d).map(({ n, c }) => ({ w: n.data, c }));
      const made = numberColumns(group, depths.length > 1 ? `_${group[0].w.cleanId}` : "", { drawables, anchors, order, attached, groups, drawnWith });
      if (made.effect) heads.effect.push(made.effect);
      if (made.cost) heads.cost.push(made.cost);
    }
    // Several depths' columns: payoff_head and cost_head name all their headings.
    if (depths.length > 1) {
      if (heads.effect.length > 0) groups.payoff_head = heads.effect;
      if (heads.cost.length > 0) groups.cost_head = heads.cost;
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

    // Folded back, a decision shows its pick: the chosen branch under a
    // highlighter stroke, every other one cut with the double hash of a
    // pruned branch.
    const pick = rolled?.bestId[parent.data.cleanId];
    if (pick !== undefined && parent.data.node.type === "decision") {
      const pair = `${parent.data.cleanId}_${n.data.cleanId}`;
      const mark = pick === n.data.cleanId ? bestMark(`best_${pair}`, from, to) : pruneMark(`prune_${pair}`, from, to);
      drawables.push(mark);
      anchors[mark.id] = mid;
      order.push(mark.id);
      attached[id] = [...(attached[id] ?? []), mark.id];
      (groups[pick === n.data.cleanId ? "best" : "pruned"] ??= []).push(mark.id);
    }

    const siblings = parent.children ?? [];
    branchLabels.push({
      edgeId: id,
      // The highlighter under the chosen branch is the branch.
      ignore: pick !== undefined && pick === n.data.cleanId ? [id, `best_${parent.data.cleanId}_${n.data.cleanId}`] : [id],
      labelId: `branchlabel_${parent.data.cleanId}_${n.data.cleanId}`,
      text: n.data.branchLabel,
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

  const out = { drawables, labels, anchors, positions, order, attached, groups, drawnWith, scale: 1, textSize: LABEL_FONT, ...(rolled && { values: valuesOf(rolled, rootWrapped.cleanId, table, typeof params.wtp === "number" && Number.isFinite(params.wtp) ? params.wtp : undefined) }) };
  if (squeeze) {
    // Squeezed past its least words, the tree shrinks words and all to the
    // lint's floor (FONT_FLOOR), not the readable one (W30): laid out at the
    // spacing its words need, it cannot hold them at TEXT_MIN at a smaller
    // scale without collisions — past that floor it goes to a world (above).
    const f = fitSceneLayout(out, squeeze, heuristicMeasure, FONT_FLOOR);
    if (f) {
      out.scale = f.s;
      out.textSize = Math.max(LABEL_FONT * f.s, FONT_FLOOR);
      for (const k of Object.keys(positions)) positions[k] = [positions[k][0] * f.s + f.dx, positions[k][1] * f.s + f.dy];
    }
  }
  // In a world the table goes under the tree's lowest words, centred on it,
  // with more air than on a page: it is framed on its own, and its header
  // read as a line of the node over it.
  const ink = spread ? inkBox(out) : null;
  // (On whole units: its rows stand exactly one line apart, and at a fraction
  // the overlap lint's 2-unit pad could read two of them as touching.)
  if (table && ink) drawTable(table, [Math.round(ink.x + ink.w / 2), Math.round(ink.y - 2 * TABLE_GAP)], out, rolled!.bestId[rootWrapped.cleanId]);
  else if (table) {
    // Under the tree: the box's bottom strip, or on the page just over the
    // narration band (MARGIN.bottom).
    const at: Pt = outer ? [outer.x + outer.w / 2, outer.y + table.h] : [BIG_REGION.x + BIG_REGION.w / 2, MARGIN.bottom + table.h];
    drawTable(table, at, out, rolled!.bestId[rootWrapped.cleanId]);
  }
  if (spread) {
    // The ink with the table, and room for the solver to move a label.
    const all = inkBox(out)!;
    (out as TreeLayout).world = { x: all.x - WORLD_PAD, y: all.y - WORLD_PAD, w: all.w + 2 * WORLD_PAD, h: all.h + 2 * WORLD_PAD };
  }
  if (Object.keys(groups).length === 0) delete (out as Partial<typeof out>).groups;
  if (Object.keys(drawnWith).length === 0) delete (out as Partial<typeof out>).drawnWith;
  return out;
}

/** The drawables' ink and the labels at their preferred spots. */
function inkBox(l: { drawables: Drawable[]; labels: LabelRequest[] }): BBox | null {
  const ids = [...new Set(l.drawables.map((d) => d.id))];
  const labelBoxes = l.labels.filter((x) => x.text.trim() !== "").map((x) => preferredLabelBox(x, heuristicMeasure));
  return unionBoxes([...ids.map((id) => unionBBoxForId(l.drawables, id, heuristicMeasure)), ...labelBoxes]);
}

/**
 * A world's spacing over its budget. A page stretches a tree that fits to
 * its plot band, so a page tree always had slack; a world at the budget
 * exactly had none, and a five-way fan's middle labels sat on their
 * branches. 1.15 (with WEDGE_AIR) kept every sampled tree — 20 terminals,
 * fans of three to six, rolled back or not, collapsed arms — lint-clean;
 * 1 and 1.05 did not.
 */
const WORLD_STRETCH = 1.15;
/** In a world, the air a wedge's label asks over its clearances. */
const WEDGE_AIR = 4;
/**
 * The column widenings a world tries (placeNodes' `widen`, on top of its
 * budget). Up to 3 made the knee tree's overview 4 : 3 but its columns so
 * wide that a camera on one fan hardly zoomed in (a fan spans a column and
 * its ends' words); without any, the same tree stood four pages tall.
 */
const WORLD_WIDEN = [1.25, 1.5];

/** Room round a world's ink: a label the solver moves off its preferred spot stays inside. */
const WORLD_PAD = 40;

/** Where the whole figure goes when it must be scaled onto the page: under the card heading, over the narration band. */
const BIG_REGION: BBox = { x: 20, y: 118, w: 960, h: 572 };
/** Below this share of its budgeted spacing a tree on the bare canvas gives up text size (the budget has slack: 0.8 kept every sampled tree lint-clean, 0.97 cost a nine-terminal tree 5 points of text for nothing). */
const SQUEEZE_K = 0.8;
/** Between the table and the tree's lowest nodes… */
const TABLE_GAP = 26;
/** …and its lowest words. */
const WORDS_GAP = 16;

const TABLE_FONT = 20;
/** With a net-benefit and a "vs" column a table has eight columns: it may shrink this far to fit its width. */
const TABLE_FONT_MIN = 15;
/**
 * Row pitch, in fonts. At 1.35 two rows' measured boxes (1.25 em each) stood
 * 0.1 em apart — under the overlap lint's 2-unit pad once the font dropped
 * below 20 — and an underline or a pointer's sweep under one row landed on
 * the next (2026-09-27). 1.5 leaves a quarter em.
 */
const TABLE_ROW = 1.5;
const TABLE_COL_GAP = 22;
/** Half the height of a row's pointing box (a part's GroupDrawable.box), in fonts: the glyphs, not the line's leading. */
const ROW_HALF = 0.4;

/** Which addressable part of a row a column's cell belongs to. */
type Part = "base" | "delta" | "icer" | "nmb";

interface Table {
  rows: StrategyRow[];
  /** The header's cells, one per column. */
  head: string[];
  /** One line per row (in `rows` order), a cell per column; "" is an empty cell. */
  cells: string[][];
  /** The part each column belongs to: name, cost, effect | vs, Δ cost, Δ effect | ICER | net benefit. */
  parts: Part[];
  /** Columns written from the left (names); the rest are numbers, right-aligned. */
  left: boolean[];
  colW: number[];
  font: number;
  w: number;
  h: number;
  /** "At $30,000 per QALY": the willingness to pay the pick was made at,
   *  under the rows (strategy_wtp) — drawn so the viewer can take hold of it. */
  wtp?: string;
  /** Each row's increments and ICER as the table shows them (for `{tree.<key>}`). */
  shown: Record<string, { dCost?: number; dEffect?: number; icer?: number }>;
}

/**
 * The root decision's options as a cost-effectiveness table: by cost, each
 * against the cheaper option on the frontier (named in the "vs" column), with
 * its ICER or why it has none, and with a willingness to pay each option's
 * net benefit. Null unless the root is a decision whose options all have a
 * payoff and a cost.
 *
 * The increments are the differences of the numbers AS SHOWN, and the ICER
 * their ratio: a reader checks a table by eye, and "$10,200 − $7,668 =
 * +$2,547" (the unrounded difference) does not check. Dominance is still
 * judged on the unrounded numbers.
 */
function tableOf(params: DecisionTreeParams & { box?: unknown }, rolled: Rolled, fmt: Format, maxFont = TABLE_FONT): Table | null {
  const root = params.root;
  if (root.type !== "decision" || !rolled.hasCost || !rolled.hasPayoff) return null;
  const options = (root.children ?? []).map((b, i) => {
    const id = nodeId(b.node, [0, i]);
    return { id, label: b.label || b.node.label, cost: rolled.cost[id], effect: rolled.ev[id] };
  });
  if (options.length < 2 || options.some((o) => o.cost === undefined || o.effect === undefined)) return null;
  const rows = strategyTable(options as { id: string; label: string; cost: number; effect: number }[]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const say = (en: string, nb: string) => kit.say({ en, nb });
  const eff = fmt.unit ?? say("Effect", "Effekt");
  const signed = (v: number, f: (v: number) => string) => (v > 1e-9 ? `+${f(v)}` : f(v));
  const wtp = typeof params.wtp === "number" && Number.isFinite(params.wtp) ? params.wtp : undefined;
  const shown: Table["shown"] = {};
  const head = ["", say("Cost", "Kostnad"), eff, say("vs", "mot"), `Δ ${say("cost", "kostnad")}`, `Δ ${eff}`, say("ICER", "IKER"), ...(wtp !== undefined ? [say("Net benefit", "Netto nytte")] : [])];
  const cells = rows.map((r) => {
    const vs = r.vs !== undefined ? byId.get(r.vs) : undefined;
    let dCost: number | undefined;
    let dEffect: number | undefined;
    let icer: number | undefined;
    if (vs) {
      dCost = fmt.moneyRound(r.cost) - fmt.moneyRound(vs.cost);
      dEffect = fmt.round(fmt.round(r.effect) - fmt.round(vs.effect));
      if (r.icer !== undefined) icer = Math.abs(dEffect) > 1e-9 ? dCost / dEffect : r.icer;
    }
    shown[r.id] = { ...(dCost !== undefined && { dCost }), ...(dEffect !== undefined && { dEffect }), ...(icer !== undefined && { icer }) };
    const verdict = r.status === "dominated" ? say("dominated", "dominert") : r.status === "ext_dominated" ? say("ext. dominated", "utv. dominert") : icer !== undefined ? fmt.money(icer) : "";
    return [
      r.label,
      fmt.money(r.cost),
      fmt.num(r.effect),
      vs ? vs.label : "",
      dCost === undefined ? "" : signed(dCost, fmt.money),
      dEffect === undefined ? "" : signed(dEffect, fmt.num),
      verdict,
      ...(wtp !== undefined ? [fmt.money(r.effect * wtp - r.cost)] : []),
    ];
  });
  const parts: Part[] = ["base", "base", "base", "delta", "delta", "delta", "icer", ...(wtp !== undefined ? ["nmb" as const] : [])];
  const left = parts.map((_, j) => j === 0 || j === 3);
  // Two options: the second is against the first, as anyone sees — no "vs".
  const keep = (_: unknown, j: number) => rows.length > 2 || j !== 3;
  const table = { head: head.filter(keep), cells: cells.map((c) => c.filter(keep)), parts: parts.filter(keep), left: left.filter(keep) };
  const room = (boxOf(params.box)?.w ?? BIG_REGION.w) - 20;
  const all = [table.head, ...table.cells];
  const measure = (font: number) => {
    const colW = table.head.map((_, j) => Math.ceil(Math.max(...all.map((row) => heuristicMeasure(row[j], font).w))));
    return { colW, w: colW.reduce((a, b) => a + b, 0) + TABLE_COL_GAP * (colW.length - 1) };
  };
  // Never larger than the tree's own numbers (a tree that gave up size for
  // room gives its table's rows that room too).
  const top = Math.min(TABLE_FONT, Math.max(TABLE_FONT_MIN, maxFont));
  let font = top;
  let m = measure(font);
  if (m.w > room) {
    font = Math.max(TABLE_FONT_MIN, Math.floor((top * room) / m.w));
    m = measure(font);
  }
  const wtpLine = wtp !== undefined ? `${say("At", "Ved")} ${fmt.money(wtp)} ${say("per", "per")} ${perUnit(fmt.unit) ?? say("unit", "enhet")}` : undefined;
  const lines = 1 + rows.length + (wtpLine ? 1 : 0);
  // Header centre 0.9 em under the top, 6 more under the rule, a pitch a
  // line, and the last line's lower half.
  const h = Math.ceil(Math.round(font * 0.9) + 6 + Math.round(font * TABLE_ROW) * (lines - 1) + 0.65 * font);
  return { rows, ...table, colW: m.colW, font, w: m.w, h, shown, ...(wtpLine ? { wtp: wtpLine } : {}) };
}

/** "per QALY", not "per QALYs": the unit a column names in the plural, one of it. */
function perUnit(unit: string | undefined): string | undefined {
  return unit && /^[A-Za-z]{2,}s$/.test(unit) ? unit.slice(0, -1) : unit;
}

/**
 * The table, top edge centred at `at`, on whole units (its rows stand exactly
 * a pitch apart; at a fraction the overlap lint's pad could read two as
 * touching). Each row is addressable whole or in parts, so a cast can draw
 * the rows first and argue the verdicts on a later beat:
 *
 *   strategy_row_<id>    the group of the row's parts below (all of the row)
 *   strategy_base_<id>   name, cost, effect
 *   strategy_delta_<id>  vs (the option it is compared with), Δ cost, Δ effect — not on the cheapest row
 *   strategy_icer_<id>   the ICER, or "dominated" / "ext. dominated" — not on the cheapest row
 *   strategy_nmb_<id>    with wtp: its net benefit; the group strategy_nmb is the whole column
 *
 * strategy_head, strategy_rule and strategy_wtp; the group strategy_table
 * names them all. Each part carries a box of its glyphs' band (not the
 * line's leading): a pointer's underline sweep under a row stays off the
 * next one. A dominated option's verdict is grey; the option the decision
 * takes is in the chosen branch's colour — its net benefit with a wtp, its
 * name without.
 */
function drawTable(t: Table, at: Pt, out: { drawables: Drawable[]; anchors: Record<string, Pt>; order: string[]; groups: Record<string, string[]> }, pick: string | undefined): void {
  const x0 = Math.round(at[0] - t.w / 2);
  const top = Math.round(at[1]);
  const pitch = Math.round(t.font * TABLE_ROW);
  const colLeft = t.colW.map((_, j) => x0 + t.colW.slice(0, j).reduce((a, b) => a + b, 0) + TABLE_COL_GAP * j);
  const colRight = colLeft.map((x, j) => x + t.colW[j]);
  const members: string[] = [];
  const nmbColumn: string[] = [];
  /** One part: its cells as a group with a box, or nothing when every cell is empty. */
  const part = (id: string, cells: string[], cols: number[], y: number, color: (j: number) => string): string | null => {
    const used = cols.filter((j) => cells[j] !== "");
    if (used.length === 0) return null;
    const kids = used.map((j) => kit.text(`${id}__c${j}`, [t.left[j] ? colLeft[j] : colRight[j], y], cells[j], { fontSize: t.font, anchor: t.left[j] ? "start" : "end", color: color(j) }));
    const g = kit.group(id, kids);
    const bx0 = Math.min(...used.map((j) => colLeft[j]));
    const bx1 = Math.max(...used.map((j) => colRight[j]));
    g.box = { x: bx0, y: y - ROW_HALF * t.font, w: bx1 - bx0, h: 2 * ROW_HALF * t.font };
    out.drawables.push(g);
    out.anchors[id] = [(bx0 + bx1) / 2, y];
    out.order.push(id);
    return id;
  };
  const colsOf = (p: Part) => t.parts.flatMap((q, j) => (q === p ? [j] : []));
  const nonNmb = t.parts.flatMap((q, j) => (q === "nmb" ? [] : [j]));
  let y = top - Math.round(t.font * 0.9);
  const guide = () => COLORS.guide;
  if (part("strategy_head", t.head, nonNmb, y, guide)) members.push("strategy_head");
  const nmbHead = part("strategy_nmb_head", t.head, colsOf("nmb"), y, guide);
  if (nmbHead) {
    members.push(nmbHead);
    nmbColumn.push(nmbHead);
  }
  const ruleY = y - Math.round(t.font * 0.85);
  const rule = kit.stroke("strategy_rule", [[x0, ruleY], [x0 + t.w, ruleY]], { color: COLORS.guide, strokeWidth: 1.5, ms: SKETCH_MS.guides });
  out.drawables.push(rule);
  out.anchors.strategy_rule = [x0 + t.w / 2, ruleY];
  out.order.push("strategy_rule");
  members.push("strategy_rule");
  y -= pitch + 6;
  const hasNmb = t.parts.includes("nmb");
  t.rows.forEach((r, i) => {
    const cells = t.cells[i];
    const beaten = r.status === "dominated" || r.status === "ext_dominated";
    const picked = r.id === pick;
    const color = (j: number) =>
      picked && ((hasNmb && t.parts[j] === "nmb") || (!hasNmb && j === 0)) ? COLORS.accent : beaten && t.parts[j] === "icer" ? COLORS.guide : COLORS.ink;
    const row = (["base", "delta", "icer"] as const).flatMap((p) => part(`strategy_${p}_${r.id}`, cells, colsOf(p), y, color) ?? []);
    out.groups[`strategy_row_${r.id}`] = row;
    out.anchors[`strategy_row_${r.id}`] = [x0 + t.w / 2, y];
    members.push(`strategy_row_${r.id}`);
    const nmb = part(`strategy_nmb_${r.id}`, cells, colsOf("nmb"), y, color);
    if (nmb) {
      members.push(nmb);
      nmbColumn.push(nmb);
    }
    y -= pitch;
  });
  if (nmbColumn.length > 0) out.groups.strategy_nmb = nmbColumn;
  if (t.wtp) {
    out.drawables.push(kit.text("strategy_wtp", [x0, y], t.wtp, { fontSize: t.font, anchor: "start", color: COLORS.guide }));
    out.anchors.strategy_wtp = [x0 + heuristicMeasure(t.wtp, t.font).w / 2, y];
    out.order.push("strategy_wtp");
    members.push("strategy_wtp");
  }
  out.groups.strategy_table = members;
}

/** A highlighter stroke under the chosen branch. */
function bestMark(id: string, from: Pt, to: Pt): StrokeDrawable {
  return {
    id,
    kind: "stroke",
    pts: [from, to],
    z: Z_AREA,
    style: defaultStyle({ color: COLORS.accent, strokeWidth: 12, opacity: 0.4, roughness: 0.8 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
  };
}

/** The pruned-branch mark: two short strokes across the branch, a third of the way along. */
function pruneMark(id: string, from: Pt, to: Pt): GroupDrawable {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const u: Pt = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
  const nrm: Pt = [-u[1], u[0]];
  const at = Math.min(0.35 * len, 90);
  const slash = (k: number): Pt[] => {
    const c: Pt = [from[0] + u[0] * (at + k * 9), from[1] + u[1] * (at + k * 9)];
    // Leaning along the branch, like a hand's //.
    const d: Pt = [nrm[0] * 12 + u[0] * 5, nrm[1] * 12 + u[1] * 5];
    return [[c[0] - d[0], c[1] - d[1]], [c[0] + d[0], c[1] + d[1]]];
  };
  const opts = { color: COLORS.ink, strokeWidth: 3, ms: SKETCH_MS.guides };
  return kit.group(id, [kit.stroke(`${id}__a`, slash(-0.5), opts), kit.stroke(`${id}__b`, slash(0.5), opts)]);
}

/** A collapsed node's mark: three stubs fanning out to the right, where its branches would go. */
function collapsedStubs(id: string, type: TreeNode["type"], c: Pt): GroupDrawable {
  const r = nodeRadius(type) + 4;
  const opts = { color: COLORS.ink, strokeWidth: 3, ms: SKETCH_MS.guides };
  return kit.group(
    id,
    [-1, 0, 1].map((k, i) => kit.stroke(`${id}__${i}`, [[c[0] + r, c[1] + k * 7], [c[0] + r + STUB_LEN, c[1] + k * 20]], opts)),
  );
}

/** How far a collapsed node's stubs reach past its shape. */
const STUB_LEN = 30;

/** The numbers, for `{tree.<key>}` tokens (layout.ts TEMPLATE_VALUES_NAME). */
function valuesOf(rolled: Rolled, rootId: string, table: Table | null, wtp: number | undefined): Record<string, number> {
  const v: Record<string, number> = {};
  for (const [id, e] of Object.entries(rolled.ev)) v[`ev_${id}`] = e;
  for (const [id, c] of Object.entries(rolled.cost)) v[`cost_${id}`] = c;
  for (const [id, x] of Object.entries(rolled.nmb)) v[`nmb_${id}`] = x;
  for (const [key, p] of Object.entries(rolled.p)) v[`p_${key}`] = p;
  for (const [id, k] of Object.entries(rolled.best)) v[`best_${id}`] = k;
  // The root decision's pick, as the index of its option.
  if (rolled.best[rootId] !== undefined) v.best = rolled.best[rootId];
  // As the table shows them: the differences of its rounded numbers.
  for (const [id, r] of Object.entries(table?.shown ?? {})) {
    if (r.icer !== undefined) v[`icer_${id}`] = r.icer;
    if (r.dCost !== undefined) v[`dcost_${id}`] = r.dCost;
    if (r.dEffect !== undefined) v[`deffect_${id}`] = r.dEffect;
  }
  // The willingness to pay itself, so drawn text follows an animate of it.
  if (wtp !== undefined) v.wtp = wtp;
  return v;
}

/**
 * A branch's label text: "Grows (p=0.53)", "p=0.2", "Watch", or nothing —
 * with a cost paid on a branch into a subtree after its name ("Screen,
 * $300", "Test, $300 (p=0.4)"): the fold-back counts it, so the tree shows
 * it (2026-09-27: a $300 screening branch was in the pick and nowhere on the
 * page). On a branch into a terminal the cost is the terminal's own, drawn
 * with its payoff. `pText`, an answer, is drawn in the probability's place.
 */
function branchText(branch: TreeBranch | undefined, cost?: string, pText?: string): string | undefined {
  const name = [branch?.label || undefined, cost].filter((x): x is string => x !== undefined).join(", ") || undefined;
  // 1/3 prints as 0.3333333333333333 — a token too long to wrap. Three
  // decimals is all a tree's reader uses.
  const p = branch?.probability !== undefined ? Number(branch.probability.toFixed(3)) : undefined;
  if (p === undefined && pText === undefined) return name;
  const shown = pText ?? p;
  return name !== undefined ? `${name} (p=${shown})` : `p=${shown}`;
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
  /** What the label may sit against: its edge, and the edge's highlighter. */
  ignore: string[];
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
      const req = labelReq(b.labelId, at, lean, b.text, SMALL, COLORS.guide, b.ignore);
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
      const last: LabelCorridor = wall ? { ...whole, give: SMALL } : strip(undefined, x0 - (x1 - x0) / 2, x1);
      req.corridors = [strip(other, x0, x1), ...(share < 1 ? [whole] : []), last];
      // The parent's value sits under it and its name over it. The fan's
      // bottom label, below its branch, slid back toward the parent under the
      // value ("Stays small (p=0.68)" into "EV 97.5", 2026-09-27); the top
      // label likewise into the name. Where the strip leaves room past them,
      // the label starts past them.
      const words = gap === "below" && b.last ? b.parentWords.valueRight : gap === "above" && b.first ? b.parentWords.nameRight : undefined;
      if (words !== undefined) {
        const xMin = words + 10;
        const w = Math.max(...wrapText(b.text, SMALL, width, heuristicMeasure).map((l) => heuristicMeasure(l, SMALL).w));
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
  const natural = column.map((b) => (b.text === undefined ? 0 : wrapText(b.text, SMALL, wrapWidth(b), heuristicMeasure).length * SMALL * 1.25 + 12));
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
    const longestWord = Math.max(...b.text!.split(/\s+/).map((w) => heuristicMeasure(w, SMALL).w));
    for (let W = widest; ; W = Math.max(longestWord, W - 20)) {
      const lines = wrapText(b.text!, SMALL, W, heuristicMeasure);
      const w = Math.max(...lines.map((l) => heuristicMeasure(l, SMALL).w));
      const h = lines.length * SMALL * 1.25;
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

/** The names' size (payoffs, values and branch labels take SMALL, a size under it)… */
const BASE_FONT = 26;
/** …which a tree too tall for the page at BASE_FONT gives up, down to this, before it is scaled (layoutDecisionTree). */
const MIN_FONT = 16;
// The size of THIS layout: set by useFont at the start of each call (layout
// is synchronous, so a module variable is one call's), read everywhere below.
let LABEL_FONT = BASE_FONT;
/** A label's line height, as the solver stacks lines (labels.ts LINE_HEIGHT). */
let LINE = LABEL_FONT * 1.25;
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
  if (slope > 0) room = Math.min(room, (1.3 * (10 + SMALL * 0.55)) / slope * 2);
  const longestWord = Math.max(...text.split(/\s+/).map((w) => heuristicMeasure(w, SMALL).w));
  return Math.max(room, longestWord);
}

/** Where a terminal's payoff is anchored, right of its centre. */
const PAYOFF_DX = 42;
/** A terminal's name and numbers share its line, the numbers in columns (layoutDecisionTree sets this per call)… */
let INLINE_TERMINALS = false;
/** …the columns' headings, when they have them (the payoff's unit or "Payoff", and "Cost")… */
let HEADS: { effect?: string; cost?: string } | null = null;
/** …over these terminals, the topmost of each depth's ends… */
let HEAD_OVER = new Set<Wrapped>();
/** …the numbers this far right of the longest name… */
const INLINE_GAP = 12;
/** …and the payoff column this far from the cost column, in fonts of the numbers: two numbers side by side must read as two. */
const COLUMN_GAP = 1.6;
/** The widest terminal name at a depth: the numbers after them start in one column. */
function inlineNameW(h: HierarchyNode<Wrapped>, depth: number): number {
  return Math.max(0, ...h.descendants().filter((m) => m.depth === depth && m.data.node.type === "terminal").map((m) => textBox(m.data.node.label, NODE_LABEL_WIDTH).w));
}
/** A terminal takes this much above and below its centre… */
const INLINE_HALF = () => Math.max(TERMINAL_HALF * 0.85, LINE / 2) + 5;
/** …and its columns' heading stands this far over its numbers' centre. */
const HEAD_DY = () => SMALL * 0.625 + 6 + HEAD_FONT * 0.625;
/** What the terminal under the headings takes above its centre. */
const HEAD_ABOVE = () => Math.max(INLINE_HALF(), HEAD_DY() + HEAD_FONT * 0.625 + 4);
/** The solver's first-ring offset for a label at LABEL_FONT (labels.ts: 10 + 0.55 × font). */
let LABEL_R = 10 + LABEL_FONT * 0.55;
/**
 * The numbers and the branch labels — a terminal's payoff and cost, a node's
 * value, "Grows (p=0.53)" — a size under the names: at one size with them
 * the tree read as a wall of words (Hans, 2026-09-27: "labels and numbers
 * can have a slightly smaller font size inside a diagram like this").
 */
const SMALL_RATIO = 0.85;
let SMALL = Math.max(FONT_FLOOR, Math.round(LABEL_FONT * SMALL_RATIO));
/** The number columns' headings, a size smaller again (the strategy table's header size at full size). */
let HEAD_FONT = Math.max(FONT_FLOOR, Math.round(LABEL_FONT * 0.75));

function useFont(f: number): void {
  LABEL_FONT = f;
  LINE = f * 1.25;
  LABEL_R = 10 + f * 0.55;
  SMALL = Math.max(FONT_FLOOR, Math.round(f * SMALL_RATIO));
  HEAD_FONT = Math.max(FONT_FLOOR, Math.round(f * 0.75));
}

/**
 * One depth's terminals' numbers as a table's columns: the payoffs
 * right-aligned in one column, the costs in the next, a clear gap between,
 * right of the depth's longest name; over them, once, at the topmost
 * terminal, each column's heading in the guide colour (as the strategy
 * table's). Ids:
 *
 *   effect_<id>   a terminal's payoff        cost_<id>   its cost
 *   payoff_<id>   the group of the two: "this terminal's numbers"
 *   payoff_head   the payoff column's heading (the unit, or "Payoff" / "Effect")
 *   cost_head     the cost column's heading
 *
 * With ends at several depths each depth has its own columns, and its
 * headings are payoff_head_<id> / cost_head_<id> (<id> its topmost end);
 * payoff_head and cost_head are then the groups of them.
 *
 * A heading is drawn with the first number of its column that a cast draws
 * (SceneLayout.drawnWith): drawing payoff_<id>, or effect_<id>, brings it.
 */
function numberColumns(
  rows: { w: Wrapped; c: Pt }[],
  suffix: string,
  out: { drawables: Drawable[]; anchors: Record<string, Pt>; order: string[]; attached: Record<string, string[]>; groups: Record<string, string[]>; drawnWith: Record<string, string[]> },
): { effect?: string; cost?: string } {
  const width = (t: string | undefined, f: number) => (t === undefined ? 0 : heuristicMeasure(t, f).w);
  const nameEnd = Math.max(...rows.map(({ w, c }) => c[0] + TERMINAL_HALF + 8 + textBox(w.node.label, NODE_LABEL_WIDTH).w * TEXT_SLACK));
  const anyEffect = rows.some((r) => r.w.effect !== undefined);
  const anyCost = rows.some((r) => r.w.cost !== undefined);
  const heads = HEADS ?? {};
  const effW = anyEffect ? Math.max(...rows.map((r) => width(r.w.effect, SMALL)), width(heads.effect, HEAD_FONT)) * TEXT_SLACK : 0;
  const costW = anyCost ? Math.max(...rows.map((r) => width(r.w.cost, SMALL)), width(heads.cost, HEAD_FONT)) * TEXT_SLACK : 0;
  const effR = Math.round(nameEnd + INLINE_GAP + effW);
  const costR = Math.round((anyEffect ? effR + COLUMN_GAP * SMALL : nameEnd + INLINE_GAP) + costW);
  const text = (id: string, x: number, y: number, t: string, f: number, color: string): string => {
    out.drawables.push(kit.text(id, [x, y], t, { fontSize: f, anchor: "end", color }));
    out.anchors[id] = [x - heuristicMeasure(t, f).w / 2, y];
    return id;
  };
  const headIds: { effect?: string; cost?: string } = {};
  if (HEADS) {
    const y = Math.round(Math.max(...rows.map((r) => r.c[1])) + HEAD_DY());
    if (anyEffect && heads.effect) headIds.effect = text(`payoff_head${suffix}`, effR, y, heads.effect, HEAD_FONT, COLORS.guide);
    if (anyCost && heads.cost) headIds.cost = text(`cost_head${suffix}`, costR, y, heads.cost, HEAD_FONT, COLORS.guide);
  }
  let first = true;
  for (const { w, c } of rows) {
    const ids: string[] = [];
    if (w.effect !== undefined) {
      ids.push(text(`effect_${w.cleanId}`, effR, c[1], w.effect, SMALL, COLORS.supply));
      if (headIds.effect) out.drawnWith[`effect_${w.cleanId}`] = [headIds.effect];
    }
    if (w.cost !== undefined) {
      ids.push(text(`cost_${w.cleanId}`, costR, c[1], w.cost, SMALL, COLORS.supply));
      if (headIds.cost) out.drawnWith[`cost_${w.cleanId}`] = [headIds.cost];
    }
    const node = `node_${w.cleanId}`;
    out.attached[node] = [...(out.attached[node] ?? []), ...ids];
    out.groups[`payoff_${w.cleanId}`] = ids;
    // In the natural order, where layoutTree held the terminal's place: the
    // headings before the first numbers.
    const at = out.order.indexOf(`payoff_${w.cleanId}`);
    const lead = first ? [headIds.effect, headIds.cost].filter((x): x is string => x !== undefined) : [];
    out.order.splice(at, 1, ...lead, ...ids);
    first = false;
  }
  return headIds;
}
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

/** A label's box at LABEL_FONT (or `font`), wrapped at maxWidth. */
function textBox(text: string, maxWidth: number, font = LABEL_FONT): { w: number; h: number } {
  const lines = wrapText(text, font, maxWidth, heuristicMeasure);
  return { w: Math.max(...lines.map((l) => heuristicMeasure(l, font).w)), h: lines.length * font * 1.25 };
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
function placeNodes(
  h: Node,
  boxParam: BBox | null,
  widen: number,
  reserve = 0,
  spread = false,
  fill = false,
): { at: Map<Node, Pt>; extent: number; k: number; w: number; h: number; low: number; wFit: number } {
  const nodes = h.descendants();
  const order = new Map(nodes.map((n, i) => [n, i] as const)); // breadth-first: within a depth, top to bottom
  const depth = h.height;
  const node = (n: Node) => n.data.node;

  // The number columns' width, headings included (numberColumns).
  const colOf = (pick: (w: Wrapped) => string | undefined, head: string | undefined) => {
    const ts = nodes.map((n) => pick(n.data)).filter((t): t is string => t !== undefined);
    return ts.length === 0 ? 0 : Math.max(...ts.map((t) => heuristicMeasure(t, SMALL).w), head ? heuristicMeasure(head, HEAD_FONT).w : 0);
  };
  const effW = colOf((w) => w.effect, HEADS?.effect);
  const costW = colOf((w) => w.cost, HEADS?.cost);
  const numbersW = effW + costW + (effW > 0 && costW > 0 ? COLUMN_GAP * SMALL : 0);
  // Horizontal: the root's name overhangs it on the left, the terminals'
  // names and payoffs on the right (a collapsed node's name and value are
  // centred on it, past its stubs).
  const rootHalf = Math.max(textBox(node(h).label, NODE_LABEL_WIDTH).w, h.data.value ? textBox(h.data.value, NODE_LABEL_WIDTH, SMALL).w : 0) / 2;
  const rightWords = Math.max(
    0,
    ...nodes
      .filter((n) => node(n).type === "terminal" || n.data.collapsed)
      .map((n) => {
        if (n.data.collapsed) {
          const words = Math.max(textBox(node(n).label, NODE_LABEL_WIDTH).w, n.data.value ? textBox(n.data.value, NODE_LABEL_WIDTH, SMALL).w : 0) / 2;
          return Math.max(nodeRadius(node(n).type) + 4 + STUB_LEN, words);
        }
        const pay = n.data.effect;
        if (INLINE_TERMINALS) return TERMINAL_HALF + 8 + inlineNameW(h, n.depth) + (numbersW > 0 ? INLINE_GAP + numbersW : 0);
        return Math.max(LABEL_R + textBox(node(n).label, NODE_LABEL_WIDTH).w, pay === undefined ? 0 : PAYOFF_DX + LABEL_R + textBox(pay, NODE_LABEL_WIDTH, SMALL).w);
      }),
  );
  const [x0, x1] = boxParam
    ? [boxParam.x + Math.min(Math.max(rootHalf + 10, 45), 160), boxParam.x + boxParam.w * widen - Math.min(Math.max(rightWords * TEXT_SLACK + 10, 120), INLINE_TERMINALS ? 460 : 320)]
    : [MARGIN.left, CANVAS.w - (INLINE_TERMINALS ? Math.min(Math.max(rightWords * TEXT_SLACK + 16, 150), 460) : MARGIN.right)];

  // In an author's box a column's floor goes with the words: at 16 a column
  // of 230 took half a 600-wide box and squeezed its neighbour's labels out
  // onto leaders (2026-09-27).
  const need = new Array<number>(depth).fill(fill ? COLUMN_MIN * Math.min(1, LABEL_FONT / BASE_FONT) : COLUMN_MIN);
  for (const n of nodes) {
    const t = n.parent && n.data.branchLabel;
    if (t) need[n.parent!.depth] = Math.max(need[n.parent!.depth], Math.min(textBox(t, Infinity, SMALL).w * TEXT_SLACK, COLUMN_LABEL_MAX) + COLUMN_ENDS);
  }
  const total = need.reduce((a, b) => a + b, 0);
  /** How much of the columns' budget the width holds (≥ 1: every column gets its labels' room). */
  const wFit = (x1 - x0) / (total || 1);
  // Spread (a world), a column is never narrower than its budget: the tree
  // grows right past the page instead.
  const col = need.map((v) => (spread ? v * Math.max(1, (x1 - x0) / (total || 1)) * widen : (v * (x1 - x0)) / (total || 1)));
  const xAt = (d: number) => x0 + col.slice(0, d).reduce((a, b) => a + b, 0);

  // Vertical: what each node's words take above and below its centre.
  const above = (n: Node): number => {
    const nameH = textBox(node(n).label, NODE_LABEL_WIDTH).h;
    if (node(n).type === "terminal" && INLINE_TERMINALS) return HEAD_OVER.has(n.data) ? HEAD_ABOVE() : INLINE_HALF();
    return node(n).type === "terminal" ? LABEL_R + nameH : nodeRadius(node(n).type) + LABEL_R + nameH;
  };
  const below = (n: Node): number => {
    const v = n.data.value;
    if (node(n).type === "terminal" && INLINE_TERMINALS) return INLINE_HALF();
    // A world is laid out at exactly this budget (a page stretches it), so
    // there the triangle counts too: at the payoff's half line alone, the
    // name of the terminal under it met the triangle and every name down
    // the column slid one place (a 3 × 3 tree, 2026-09-27).
    if (node(n).type === "terminal") return hasNumbers(n.data) ? Math.max(LINE / 2 + 2, spread ? TERMINAL_HALF + 6 : 0) : TERMINAL_HALF;
    return v !== undefined ? nodeRadius(node(n).type) + LABEL_R + textBox(v, NODE_LABEL_WIDTH, SMALL).h : nodeRadius(node(n).type) + 6;
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
    const t = n.parent ? n.data.branchLabel : undefined;
    return t !== undefined && gapOf(n) === gap ? t : undefined;
  };
  /** What a node and the branch label on each side of it take, above and below its centre. */
  const up = (n: Node) => {
    const t = labelOn(n, "above");
    return Math.max(above(n), t === undefined ? 0 : textBox(t, labelWidth(n), SMALL).h + 2 * STRIP_CLEAR);
  };
  const down = (n: Node) => {
    const t = labelOn(n, "below");
    return Math.max(below(n), t === undefined ? 0 : textBox(t, labelWidth(n), SMALL).h + 2 * STRIP_CLEAR);
  };
  /** The spacing that opens a fan's wedge enough for `text` near the child end. */
  const wedge = (text: string, c: number): number => {
    let best = Infinity;
    const words = text.split(/\s+/).length;
    for (let W = (c - COLUMN_ENDS) / TEXT_SLACK, k = 0; k < words && W > 0; k++) {
      const { w, h } = textBox(text, W, SMALL);
      const f = (c - nodeRadius("terminal") - 8 - w * TEXT_SLACK) / c;
      if (f > 0.12) best = Math.min(best, (h + 2 * STRIP_CLEAR + (spread ? WEDGE_AIR : 0)) / f);
      W = w - 1;
    }
    return Number.isFinite(best) ? best : (textBox(text, 0, SMALL).h + 2 * STRIP_CLEAR) / 0.12;
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
  /** On the page and in a world the top node stands at a fixed height: the number columns' headings over it take this much off the top. */
  const headPad = () => {
    const lo = Math.min(...nodes.map(bx));
    return nodes.some((m) => HEAD_OVER.has(m.data) && bx(m) <= lo + 1e-6) ? HEAD_ABOVE() - INLINE_HALF() : 0;
  };
  /** The lowest the nodes' words reach, placed. */
  const lowest = (at: Map<Node, Pt>) => Math.min(...nodes.map((n) => at.get(n)![1] - down(n)));
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
  if (!boxParam && spread) {
    // A world: at the spacing budgeted, with some slack (stretched to the
    // plot band if that is taller), the top node where the page's top node
    // goes, growing down.
    const plotH = CANVAS.h - MARGIN.top - MARGIN.bottom;
    const k = hi > lo ? Math.max(WORLD_STRETCH, plotH / (hi - lo)) : 1;
    const top = CANVAS.h - MARGIN.top - headPad();
    for (const n of nodes) out.set(n, [xAt(n.depth), top - (bx(n) - lo) * k]);
    // Its size, roughly: the page's margins round the nodes.
    return { at: out, extent: (hi - lo) * k, k, w: xAt(depth) + CANVAS.w - x1, h: (hi - lo) * k + MARGIN.top + MARGIN.bottom, low: lowest(out), wFit };
  }
  if (!boxParam) {
    // On the bare canvas the nodes fill the plot band, as they always have.
    // (A strategy table under the tree takes `reserve` off the band's bottom.)
    const pad = headPad();
    const plotH = CANVAS.h - MARGIN.top - MARGIN.bottom - reserve - pad;
    const k = hi > lo ? plotH / (hi - lo) : 0;
    for (const n of nodes) out.set(n, [xAt(n.depth), hi > lo ? CANVAS.h - MARGIN.top - pad - (bx(n) - lo) * k : MARGIN.bottom + reserve + plotH / 2]);
    return { at: out, extent: plotH, k, w: CANVAS.w, h: CANVAS.h, low: lowest(out), wFit };
  }
  // In a box: at the spacing budgeted, centred, words and outer labels
  // included. A box too small overflows here, and the template fit then
  // scales the whole tree, words and all, into it — the budget holds.
  const top = Math.max(...nodes.map((n) => -bx(n) + up(n)));
  const bottom = Math.min(...nodes.map((n) => -bx(n) - down(n)));
  const room = boxParam.h - 2 * BOX_PAD;
  const k = hi > lo ? Math.max(1, Math.min(fill ? BOX_FILL_STRETCH : BOX_STRETCH, 1 + (room - (top - bottom)) / (hi - lo))) : 1;
  const mid = boxParam.y + boxParam.h / 2;
  // Stretched by k, the words' extent is [bottom', top'] about the nodes.
  const yOf = (n: Node) => -bx(n) * k;
  const topK = Math.max(...nodes.map((n) => yOf(n) + up(n)));
  const bottomK = Math.min(...nodes.map((n) => yOf(n) - down(n)));
  const shift = mid - (topK + bottomK) / 2;
  for (const n of nodes) out.set(n, [xAt(n.depth) - (boxParam.w * (widen - 1)) / 2, yOf(n) + shift]);
  return { at: out, extent: topK - bottomK, k, w: boxParam.w, h: boxParam.h, low: bottomK + shift, wFit };
}

/** How much the page's squeeze region may spread the tree past its budget… */
const BOX_STRETCH = 1.3;
/** …and an author's box, which the tree fills as it fills the page (whose stretch is not capped). */
const BOX_FILL_STRETCH = 2;
/** The largest words a tree takes in a roomy box (BASE_FONT on the page)… */
const BOX_FONT_MAX = 30;
/** …with this much air, in height and width, over what the words need. */
const BOX_AIR = 1.1;

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
