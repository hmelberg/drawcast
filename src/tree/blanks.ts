// Tree blanks (spec 2026-10-03 §4): the numbers of a decision tree the
// viewer fills in, and the best branch they pick. Pure: the truths come
// from the tree's own rollback (or, for a terminal, the number the author
// wrote), the working lines from the same rollback, so they always agree.
import { rollback, walkTree } from "../scenes/decision_tree/rollback";
import type { DecisionTreeParams, TreeNode } from "../scenes/decision_tree/layout";

export type BlankKind = "value" | "probability" | "effect" | "cost";
export interface TreeBlank {
  /** As written in the ask. */
  part: string;
  kind: BlankKind;
  /** The node id (for branchlabel_…: the child). */
  node: string;
  truth: number;
  /** "Expected value of Treat", "Probability of Cured", "Payoff of Wait", "Cost of Wait". */
  label: string;
  /** "0.3 × 10 + 0.7 × 4 = 5.8", a terminal's authored work, or null. */
  work: string | null;
  /** For the right-to-left reveal: deepest first. */
  depth: number;
}
export interface TreePick {
  node: string;
  options: { id: string; label: string; edge: string }[];
  best: string;
  /** Each option's number as rollback compared it: its net benefit (under a
   *  wtp), its expected value, or — a tree of costs alone — its cost. */
  values: Record<string, number>;
  /** Which of those `values` are: a cost is better LOWER. */
  measure: "value" | "nmb" | "cost";
}

const PROB_TOLERANCE = 0.01;

/** Short numbers for working lines: up to 3 significant decimals, no float dust. */
function n(v: number): string {
  return String(Number(v.toFixed(3)));
}

interface Info { node: TreeNode; id: string; parent?: string; branchLabel?: string; depth: number; payoff?: number; cost?: number }

/** Every node by id, in walk order (so a node's children come in their order). */
function index(root: TreeNode): Map<string, Info> {
  const out = new Map<string, Info>();
  walkTree(root, (node, id, branch, parentId) => {
    const depth = parentId === undefined ? 0 : (out.get(parentId)?.depth ?? 0) + 1;
    out.set(id, { node, id, parent: parentId, branchLabel: branch?.label, depth, payoff: node.payoff ?? branch?.payoff, cost: node.cost ?? branch?.cost });
  });
  return out;
}

function childrenOf(nodes: Map<string, Info>, id: string): Info[] {
  return [...nodes.values()].filter((x) => x.parent === id);
}

function rolledOf(params: DecisionTreeParams) {
  return rollback(params.root, params.wtp !== undefined ? { wtp: params.wtp } : {});
}

export function treeBlanks(params: DecisionTreeParams, parts: string[]): { blanks: TreeBlank[]; issues: string[] } {
  const issues: string[] = [];
  const blanks: TreeBlank[] = [];
  const nodes = index(params.root);
  const rolled = rolledOf(params);
  const name = (id: string): string => nodes.get(id)?.branchLabel || nodes.get(id)?.node.label || id;
  for (const part of parts) {
    let m: RegExpExecArray | null;
    if ((m = /^value_(.+)$/.exec(part))) {
      const id = m[1];
      const info = nodes.get(id);
      if (!info || info.node.type === "terminal") { issues.push(`blank "${part}": no chance or decision node "${id}"`); continue; }
      if (params.rollback !== true) { issues.push(`blank "${part}": a value blank needs rollback: true`); continue; }
      const ev = rolled.ev[id];
      if (ev === undefined) { issues.push(`blank "${part}": rollback computes no value here (a payoff below is missing)`); continue; }
      const kids = childrenOf(nodes, id);
      const work = info.node.type === "chance"
        ? `${kids.map((k) => `${n(rolled.p[`${id}_${k.id}`] ?? 0)} × ${n(rolled.ev[k.id] ?? 0)}`).join(" + ")} = ${n(ev)}`
        // Under a wtp the decision picks by net benefit, not by the largest
        // value, so the line lists the net benefits it compared.
        : params.wtp !== undefined && kids.every((k) => rolled.nmb[k.id] !== undefined)
          ? `best net benefit of ${kids.map((k) => n(rolled.nmb[k.id])).join(", ")} → ${n(ev)}`
          : `best of ${kids.map((k) => n(rolled.ev[k.id] ?? 0)).join(", ")} = ${n(ev)}`;
      blanks.push({ part, kind: "value", node: id, truth: ev, label: `Expected value of ${name(id)}`, work, depth: info.depth });
    } else if ((m = /^branchlabel_(.+)$/.exec(part))) {
      const key = m[1];
      const p = rolled.p[key];
      const child = [...nodes.values()].find((x) => x.parent !== undefined && `${x.parent}_${x.id}` === key);
      if (p === undefined || !child) { issues.push(`blank "${part}": no chance branch "${key}" with a probability`); continue; }
      // The complement the tree fills in has its working: 1 − the others.
      const others = rolled.filled.has(key) ? childrenOf(nodes, child.parent!).filter((k) => k.id !== child.id).map((k) => rolled.p[`${child.parent}_${k.id}`] ?? 0) : [];
      const work = others.length > 0 ? `1 − ${others.map(n).join(" − ")} = ${n(p)}` : null;
      blanks.push({ part, kind: "probability", node: child.id, truth: p, label: `Probability of ${name(child.id)}`, work, depth: child.depth });
    } else if ((m = /^(effect|cost)_(.+)$/.exec(part))) {
      const kind = m[1] as "effect" | "cost";
      const info = nodes.get(m[2]);
      const v = kind === "effect" ? info?.payoff : info?.cost;
      if (!info || info.node.type !== "terminal" || typeof v !== "number") { issues.push(`blank "${part}": no terminal "${m[2]}" with a ${kind === "effect" ? "payoff" : "cost"}`); continue; }
      blanks.push({ part, kind, node: info.id, truth: v, label: `${kind === "effect" ? "Payoff" : "Cost"} of ${name(info.id)}`, work: info.node.work ?? null, depth: info.depth });
    } else {
      issues.push(`blank "${part}": not a tree number (value_<node>, branchlabel_<parent>_<child>, effect_<node>, cost_<node>)`);
    }
  }
  return { blanks, issues };
}

/** A typed number: "5,8", "£ 300", "1 200", "$78,000", "1.234,5", "−2"; null when it is not one. */
export function parseBlankNumber(text: string): number | null {
  let t = text.replace(/[\s\u00a0\u202f]/g, "").replace(/[£$€¥%]|kr|NOK/gi, "").replace(/−/g, "-");
  // Separators: with both marks, the last is the decimal point; a mark
  // repeated, or a lone comma before exactly three digits (as the tree
  // draws "$78,000"), groups thousands; any other lone comma is a decimal.
  // A group never starts with 0: "0,250" is a decimal comma (0.25).
  const grouped = (mark: string) => new RegExp(`^[-+]?[1-9]\\d{0,2}(\\${mark}\\d{3})+$`);
  const commas = (t.match(/,/g) ?? []).length;
  const dots = (t.match(/\./g) ?? []).length;
  if (commas && dots) {
    const dec = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const sep = dec === "," ? "." : ",";
    const [whole, frac, extra] = t.split(dec);
    if (extra !== undefined || !grouped(sep).test(whole)) return null;
    t = `${whole.split(sep).join("")}.${frac}`;
  } else if (commas) {
    if (grouped(",").test(t)) t = t.replace(/,/g, "");
    else if (commas > 1) return null;
    else t = t.replace(",", ".");
  } else if (dots > 1) {
    if (!grouped(".").test(t)) return null;
    t = t.replace(/\./g, "");
  }
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  return Number(t);
}

/** A tree blank's typed number: a probability written with "%" ("88%") is
 *  the fraction (0.88); any other blank keeps the number ("88%" → 88). */
export function parseTreeBlankNumber(text: string, kind: BlankKind): number | null {
  const v = parseBlankNumber(text);
  if (v === null || kind !== "probability" || !text.includes("%")) return v;
  return v / 100;
}

/** Within the tolerance (relative), or for a probability within 0.01. */
export function blankRight(b: TreeBlank, v: number | null, tolerance: number): boolean {
  if (v === null || !Number.isFinite(v)) return false;
  if (b.kind === "probability") return Math.abs(v - b.truth) <= PROB_TOLERANCE + 1e-9;
  return Math.abs(v - b.truth) <= tolerance * Math.max(Math.abs(b.truth), 1e-9) + 1e-9;
}

export function scoreBlanks(blanks: TreeBlank[], values: (number | null)[], tolerance: number): { within: number; count: number; ok: boolean; right: boolean[] } {
  const right = blanks.map((b, i) => blankRight(b, values[i] ?? null, tolerance));
  const within = right.filter(Boolean).length;
  return { within, count: blanks.length, ok: within === blanks.length, right };
}

/** A decision node's options and the one rollback picks; a string says what is wrong. */
export function treePick(params: DecisionTreeParams, node: string): TreePick | string {
  const nodes = index(params.root);
  const info = nodes.get(node);
  if (!info || info.node.type !== "decision") return `pick "${node}": not a decision node`;
  const rolled = rolledOf(params);
  const best = rolled.bestId[node];
  if (best === undefined) return `pick "${node}": rollback picks no best branch here`;
  const options = childrenOf(nodes, node).map((x) => ({ id: x.id, label: x.branchLabel || x.node.label || x.id, edge: `edge_${node}_${x.id}` }));
  const measure: TreePick["measure"] = params.wtp !== undefined && rolled.hasCost && rolled.hasPayoff ? "nmb" : rolled.hasPayoff ? "value" : "cost";
  const values: Record<string, number> = {};
  for (const o of options) values[o.id] = (measure === "nmb" ? rolled.nmb[o.id] : measure === "cost" ? rolled.cost[o.id] : rolled.ev[o.id]) ?? NaN;
  return { node, options, best, values, measure };
}

/** {c.diff} (spec §4.3): how much better the best option is — best minus
 *  the one chosen when the pick is wrong; else (right, skipped, the movie)
 *  best minus the best of the others, the margin. Always ≥ 0 (a cost saved
 *  for a tree of costs); null when the numbers are not there. */
export function pickDiff(pick: TreePick, chosen: string | null): number | null {
  const score = (id: string): number => (pick.measure === "cost" ? -1 : 1) * (pick.values[id] ?? NaN);
  const best = score(pick.best);
  const against = chosen !== null && chosen !== pick.best
    ? score(chosen)
    : Math.max(...pick.options.filter((o) => o.id !== pick.best).map((o) => score(o.id)));
  const d = best - against;
  return Number.isFinite(d) ? d : null;
}

/** What Answer (or Enter) does in a tree gate: an empty blank is opened
 *  first (never an answer of nulls), then a pick still to make is asked for,
 *  then the answer goes in. */
export function treeAnswerAction(values: (number | null)[], hasPick: boolean, chosen: string | null): { open: number } | "nudge" | "submit" {
  const empty = values.findIndex((v) => v === null);
  if (empty >= 0) return { open: empty };
  return hasPick && chosen === null ? "nudge" : "submit";
}

/** "5.8,;treat": the typed numbers (empty for none), then the pick. */
export function encodeTreeAnswer(values: (number | null)[], pick: string | null): string {
  return `${values.map((v) => (v === null ? "" : String(v))).join(",")};${pick ?? ""}`;
}

export function decodeTreeAnswer(s: string, n: number): { values: (number | null)[]; pick: string | null } | null {
  const [a, b] = s.split(";");
  if (a === undefined || b === undefined) return null;
  const values = n === 0 ? [] : a.split(",").map((x) => (x === "" ? null : Number(x)));
  if (values.length !== n || values.some((v) => v !== null && !Number.isFinite(v))) return null;
  return { values, pick: b === "" ? null : b };
}
