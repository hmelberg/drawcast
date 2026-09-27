// decision_tree's widget body (2026-09-27): while the figure is paused the
// viewer works the tree's NUMBERS where they are drawn, and the fold-back
// follows under the pointer — each node's expected value, the decision's
// pick (highlighter) and the branches it prunes, the strategy table's ICERs.
//
//   a branch's "(p=0.6)"            drag sideways: ±0.01 per step, 0–1
//   a terminal's payoff / its cost  drag sideways: ±~1 % per step; the
//                                   press's x picks which of "9.5, £300"
//   any of them, tapped             a number field over it (type, Enter)
//
// Complements — a chance node's branches keep adding up to 1:
//   two branches     the sibling becomes 1 − p
//   three or more    the OTHER siblings are rescaled in proportion to what
//                    they were (all equal when they were all 0), rounded, the
//                    rounding's remainder to the largest; every sibling gets
//                    an explicit probability (a complement rollback filled in
//                    is written out, since it is no longer the complement of
//                    one number).
//
// Structure-derived: the template simply HAS this; no cast command asks for
// it. Pure like every body (widget-types.ts): it reads the press-time scene
// and returns a whole new `root` as its patch; the host paints it live.
import type { BBox } from "../../layout/geometry";
import { heuristicMeasure } from "../../layout/measure";
import type { Pt } from "../../layout/model";
import { amountScrub, clamp, decimalsOf, probabilityStep, rescaleShares, roundTo, scrubbed } from "../number-scrub";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { layoutDecisionTree, type DecisionTreeParams, type TreeBranch, type TreeNode } from "./layout";
import { fillProbabilities, nodeId } from "./rollback";

/** A number of the tree the viewer can take hold of. */
export type TreeTarget =
  | { kind: "p"; key: string; parentPath: number[]; index: number; value: number; name: string }
  | { kind: "payoff" | "cost"; id: string; path: number[]; value: number; name: string; box?: BBox };

interface TreeIndex {
  /** branchlabel_<key> → the chance branch it labels. */
  branches: Map<string, { key: string; parentPath: number[]; index: number; value: number | undefined; name: string }>;
  /** payoff_<id> → the terminal whose numbers it writes. */
  terminals: Map<string, { id: string; path: number[]; node: TreeNode; branch?: TreeBranch }>;
}

const indexCache = new WeakMap<object, TreeIndex>();

/** Every editable number of the tree at these params (cached per params object). */
export function treeIndex(params: DecisionTreeParams): TreeIndex {
  const hit = indexCache.get(params);
  if (hit) return hit;
  const out: TreeIndex = { branches: new Map(), terminals: new Map() };
  const rollback = params.rollback === true;
  const go = (node: TreeNode, path: number[], branch?: TreeBranch): void => {
    if (!node || typeof node !== "object") return;
    const id = nodeId(node, path);
    if (node.type === "terminal") {
      const payoff = node.payoff ?? branch?.payoff;
      const cost = node.cost ?? branch?.cost;
      if (typeof payoff === "number" || typeof cost === "number") out.terminals.set(`payoff_${id}`, { id, path, node, branch });
    }
    const kids = (node.children ?? []).filter((b) => b && typeof b === "object" && b.node && typeof b.node === "object");
    // A collapsed node's branches are not drawn: nothing there to take hold of.
    if (node.collapsed === true && node.type !== "terminal" && kids.length > 0) return;
    const filled = node.type === "chance" ? fillProbabilities(kids).p : [];
    kids.forEach((b, i) => {
      const childPath = [...path, i];
      if (node.type === "chance") {
        const key = `${id}_${nodeId(b.node, childPath)}`;
        // The label shows a p when the author gave one, or rollback filled it in.
        const value = typeof b.probability === "number" ? b.probability : rollback ? filled[i] : undefined;
        out.branches.set(`branchlabel_${key}`, { key, parentPath: path, index: i, value, name: b.label || b.node.label || key });
      }
      go(b.node, childPath, b);
    });
  };
  if (params.root) go(params.root, [0]);
  indexCache.set(params, out);
  return out;
}

/** The drawn text of a label part, as the layout wrote it. */
function labelText(params: DecisionTreeParams, id: string): string | null {
  let texts = textCache.get(params);
  if (!texts) {
    try {
      texts = new Map(layoutDecisionTree(params).labels.map((l) => [l.id, l.text]));
    } catch {
      texts = new Map();
    }
    textCache.set(params, texts);
  }
  return texts.get(id) ?? null;
}
const textCache = new WeakMap<object, Map<string, string>>();

/** The stretch of a one-line text's box that holds text[start, end) — by the
 *  heuristic's widths, which share the drawn font's proportions. */
function subBox(box: BBox, text: string, start: number, end: number): BBox {
  const w = (s: string) => heuristicMeasure(s, 20).w;
  const all = w(text) || 1;
  const x0 = box.x + (box.w * w(text.slice(0, start))) / all;
  const x1 = box.x + (box.w * w(text.slice(0, end))) / all;
  return { x: x0, y: box.y, w: Math.max(x1 - x0, 1), h: box.h };
}

/** What a press on part `id` at `point` takes hold of, or null. */
export function treeTarget(id: string, point: Pt, scene: WidgetScene): TreeTarget | null {
  const params = scene.params as unknown as DecisionTreeParams;
  const idx = treeIndex(params);
  const br = idx.branches.get(id);
  if (br) return br.value === undefined ? null : { kind: "p", key: br.key, parentPath: br.parentPath, index: br.index, value: br.value, name: br.name };
  const t = idx.terminals.get(id);
  if (!t) return null;
  const payoff = t.node.payoff ?? t.branch?.payoff;
  const cost = t.node.cost ?? t.branch?.cost;
  const name = t.node.label || t.id;
  const box = scene.boxes.get(id);
  const one = (kind: "payoff" | "cost", value: number, b?: BBox): TreeTarget => ({ kind, id: t.id, path: t.path, value, name, ...(b ? { box: b } : {}) });
  if (typeof payoff !== "number") return typeof cost === "number" ? one("cost", cost, box) : null;
  if (typeof cost !== "number") return one("payoff", payoff, box);
  // "9.5, £300" (or "9.5, cost 300"): the payoff is before the comma, the
  // cost after it — the press's x says which one the viewer meant.
  const text = labelText(params, id);
  const cut = text ? text.indexOf(", ") : -1;
  if (!box || !text || cut < 0) return one("payoff", payoff, box);
  const left = subBox(box, text, 0, cut);
  const right = subBox(box, text, cut + 2, text.length);
  const split = (left.x + left.w + right.x) / 2;
  return point[0] < split ? one("payoff", payoff, left) : one("cost", cost, right);
}

/** The number field a tap on the target opens. */
export function treeField(t: TreeTarget, scene: WidgetScene, id: string): EditField {
  if (t.kind === "p") {
    // Over the number itself when the label is "Grows (p=0.53)".
    const box = scene.boxes.get(id);
    const text = labelText(scene.params as unknown as DecisionTreeParams, id);
    const at = text ? text.lastIndexOf("p=") : -1;
    const numBox = box && text && at >= 0 ? subBox(box, text, at + 2, text.replace(/\)$/, "").length) : undefined;
    return { value: t.value, label: `Probability of ${t.name}`, min: 0, max: 1, step: 0.01, ...(numBox ? { box: numBox } : {}) };
  }
  const floor = t.value < 0 ? {} : { min: 0 };
  return {
    value: t.value,
    label: `${t.kind === "cost" ? "Cost" : "Payoff"} of ${t.name}`,
    ...(t.kind === "cost" ? floor : {}),
    step: amountScrub(t.value, t.kind === "cost" ? 1 : 0.1).step,
    ...(t.box ? { box: t.box } : {}),
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function nodeAt(root: TreeNode, path: number[]): TreeNode {
  let n = root;
  for (const k of path.slice(1)) n = n.children![k].node;
  return n;
}

/** A new root with one chance branch at p and its siblings keeping the sum at 1. */
export function withProbability(root: TreeNode, parentPath: number[], index: number, p: number): TreeNode {
  const out = clone(root);
  const parent = nodeAt(out, parentPath);
  const kids = parent.children ?? [];
  const given = fillProbabilities(kids).p;
  // Decimals: 2, or more where the author (or the viewer) wrote more.
  const places = Math.min(4, Math.max(2, decimalsOf(roundTo(p, 6)), ...given.map((v) => (v === undefined ? 0 : decimalsOf(roundTo(v, 6))))));
  const q = roundTo(clamp(p, 0, 1), places);
  const others = kids.map((_, i) => i).filter((i) => i !== index);
  // The others as they stand; two or more missing share what is left.
  const missing = others.filter((i) => given[i] === undefined);
  const known = others.reduce((a, i) => a + (given[i] ?? 0), 0);
  const share = missing.length > 0 ? Math.max(0, 1 - (given[index] ?? 0) - known) / missing.length : 0;
  const now = others.map((i) => given[i] ?? share);
  const next = others.length === 1 ? [roundTo(1 - q, places)] : rescaleShares(now, 1 - q, places);
  kids[index].probability = q;
  others.forEach((i, k) => (kids[i].probability = next[k]));
  return out;
}

/** A new root with a terminal's payoff or cost at v — on the node (the
 *  layout reads the node's first), unless the author put that number only on
 *  the branch coming in: then there, where it lives. */
export function withAmount(root: TreeNode, path: number[], kind: "payoff" | "cost", v: number): TreeNode {
  const out = clone(root);
  const node = nodeAt(out, path);
  const branch = path.length > 1 ? nodeAt(out, path.slice(0, -1)).children![path[path.length - 1]] : undefined;
  if (node[kind] === undefined && branch && branch[kind] !== undefined) branch[kind] = v;
  else node[kind] = v;
  return out;
}

/** The patch that puts the target at v. */
export function treePatch(t: TreeTarget, v: number, params: DecisionTreeParams): Record<string, unknown> {
  return { root: t.kind === "p" ? withProbability(params.root, t.parentPath, t.index, v) : withAmount(params.root, t.path, t.kind, v) };
}

/** The value a sideways drag of dx sets, from the target's value at the press. */
export function treeScrub(t: TreeTarget, dx: number): number {
  if (t.kind === "p") return scrubbed(t.value, dx, probabilityStep(t.value), 0, 1);
  const { step, min } = amountScrub(t.value, t.kind === "cost" ? 1 : 0.1);
  return scrubbed(t.value, dx, step, min);
}

/** Every part that holds a number the viewer may change. */
export function treeParts(scene: WidgetScene): string[] {
  const idx = treeIndex(scene.params as unknown as DecisionTreeParams);
  return [...[...idx.branches].filter(([, b]) => b.value !== undefined).map(([id]) => id), ...idx.terminals.keys()];
}

export function decisionTreeWidget(): WidgetBody {
  return {
    live: true,
    parts: treeParts,
    editable(id, point, scene) {
      const t = treeTarget(id, point, scene);
      return t ? treeField(t, scene, id) : null;
    },
    init: () => ({}),
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      const params = scene.params as unknown as DecisionTreeParams;
      if (event.type === "input") {
        const t = treeTarget(event.id, event.point, scene);
        return { state, effects: t ? [{ patch: treePatch(t, event.value, params) }] : [] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return { state, effects: [] };
      if (!event.from) return { state, effects: [] };
      const t = treeTarget(event.id, event.from, scene);
      if (!t) return { state, effects: [] };
      return { state, effects: [{ patch: treePatch(t, treeScrub(t, event.point[0] - event.from[0]), params) }] };
    },
  };
}
