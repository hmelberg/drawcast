// Fold-back (rollback) of a decision tree, and the cost-effectiveness table
// of the root decision's options. Pure arithmetic over the params: the
// layout draws what this returns, the lint reads its issues, and
// SceneLayout.values carries its numbers to `{tree.<key>}` tokens.
//
// Addressing — stable, and the same everywhere (values keys, element ids,
// a later live-editing widget's param paths):
//   node id      node.id, else its path from the root joined by "_" ("0",
//                "0_1", …) — layout.ts wrap() gives the same id
//   branch       "<parentId>_<childId>" (edge_…, branchlabel_…, p_…)

import type { TreeBranch, TreeNode } from "./layout";

export interface RollbackOptions {
  /** Willingness to pay per unit of payoff: a decision then maximises payoff·wtp − cost. */
  wtp?: number;
}

export interface TreeIssue {
  severity: "warn" | "error";
  message: string;
}

export interface Rolled {
  /** Expected payoff per node id (terminals: their own payoff). Absent where a payoff below is missing. */
  ev: Record<string, number>;
  /** Expected cost per node id; empty when the tree has no costs. */
  cost: Record<string, number>;
  /** Net monetary benefit per node id (with wtp and costs only). */
  nmb: Record<string, number>;
  /** Every chance branch's probability, the complement filled in, by "<parentId>_<childId>". */
  p: Record<string, number>;
  /** Branch keys whose probability was filled in as the complement. */
  filled: Set<string>;
  /** A decision node's chosen child: its index among the node's children. */
  best: Record<string, number>;
  /** …and that child's id. */
  bestId: Record<string, string>;
  hasCost: boolean;
  hasPayoff: boolean;
  issues: TreeIssue[];
}

/** The id a node goes by: its own, else its path ("0_1_0"). */
export function nodeId(node: TreeNode, path: number[]): string {
  return node.id ?? path.join("_");
}

const SUM_TOLERANCE = 0.005;

/** Every node, depth first, with its id, its incoming branch and its parent's id. */
export function walkTree(root: TreeNode, visit: (node: TreeNode, id: string, branch: TreeBranch | undefined, parentId: string | undefined) => void): void {
  const go = (node: TreeNode, path: number[], branch?: TreeBranch, parentId?: string) => {
    const id = nodeId(node, path);
    visit(node, id, branch, parentId);
    (node.children ?? []).forEach((b, i) => {
      if (b && typeof b === "object" && b.node && typeof b.node === "object") go(b.node, [...path, i], b, id);
    });
  };
  go(root, [0]);
}

/**
 * A chance node's probabilities with at most one missing one filled in as
 * 1 − Σ the others. `filled` is the index filled, if any.
 */
export function fillProbabilities(branches: TreeBranch[]): { p: (number | undefined)[]; filled?: number } {
  const given = branches.map((b) => (typeof b.probability === "number" && Number.isFinite(b.probability) ? b.probability : undefined));
  const missing = given.flatMap((v, i) => (v === undefined ? [i] : []));
  if (missing.length !== 1) return { p: given };
  const rest = given.reduce<number>((a, v) => a + (v ?? 0), 0);
  const out = [...given];
  out[missing[0]] = Math.max(0, Number((1 - rest).toFixed(6)));
  return { p: out, filled: missing[0] };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function rollback(root: TreeNode, opts: RollbackOptions = {}): Rolled {
  const out: Rolled = { ev: {}, cost: {}, nmb: {}, p: {}, filled: new Set(), best: {}, bestId: {}, hasCost: false, hasPayoff: false, issues: [] };
  walkTree(root, (node, _id, branch) => {
    if (num(node.cost) !== undefined || num(branch?.cost) !== undefined) out.hasCost = true;
    if (node.type === "terminal" && (num(node.payoff) !== undefined || num(branch?.payoff) !== undefined)) out.hasPayoff = true;
  });
  const wtp = num(opts.wtp);
  const useNmb = wtp !== undefined && out.hasCost && out.hasPayoff;

  /** [payoff, cost] of a node; undefined parts where something below is missing. */
  const fold = (node: TreeNode, path: number[], branch?: TreeBranch): { e?: number; c?: number } => {
    const id = nodeId(node, path);
    const kids = (node.children ?? []).filter((b) => b && typeof b === "object" && b.node && typeof b.node === "object");
    let e: number | undefined;
    let c: number | undefined;
    if (node.type === "terminal" || kids.length === 0) {
      e = num(node.payoff) ?? num(branch?.payoff);
      c = out.hasCost ? num(node.cost) ?? num(branch?.cost) ?? 0 : undefined;
    } else {
      const rolled = kids.map((b, i) => ({ ...fold(b.node, [...path, i], b), childId: nodeId(b.node, [...path, i]) }));
      if (node.type === "chance") {
        const { p, filled } = fillProbabilities(kids);
        kids.forEach((_, i) => {
          const key = `${id}_${rolled[i].childId}`;
          if (p[i] !== undefined) out.p[key] = p[i]!;
          if (filled === i) out.filled.add(key);
        });
        const complete = p.every((v) => v !== undefined);
        const sum = (f: (i: number) => number | undefined): number | undefined => {
          if (!complete) return undefined;
          let s = 0;
          for (let i = 0; i < kids.length; i++) {
            const v = f(i);
            if (v === undefined) return undefined;
            s += p[i]! * v;
          }
          return s;
        };
        e = sum((i) => rolled[i].e);
        c = out.hasCost ? sum((i) => rolled[i].c) : undefined;
      } else {
        // Decision: the best option. With a willingness to pay and costs,
        // the highest net benefit; else the highest payoff (the cheaper on a
        // tie); a tree of costs alone, the cheapest.
        const score = (r: { e?: number; c?: number }): number | undefined => {
          if (useNmb) return r.e === undefined || r.c === undefined ? undefined : r.e * wtp! - r.c;
          if (out.hasPayoff) return r.e;
          if (out.hasCost) return r.c === undefined ? undefined : -r.c;
          return undefined;
        };
        const scores = rolled.map(score);
        if (scores.every((s) => s !== undefined)) {
          let k = 0;
          for (let i = 1; i < scores.length; i++) {
            const better = scores[i]! > scores[k]! + 1e-12;
            const tie = Math.abs(scores[i]! - scores[k]!) <= 1e-12;
            if (better || (tie && (rolled[i].c ?? 0) < (rolled[k].c ?? 0))) k = i;
          }
          out.best[id] = k;
          out.bestId[id] = rolled[k].childId;
          e = rolled[k].e;
          c = rolled[k].c;
        }
      }
    }
    // A cost (or payoff) on the branch INTO a subtree is paid on the way
    // through: it counts for everything below the branch, so it is part of
    // the subtree's own numbers — its value_<id>, {tree.cost_<id>}, nmb and
    // its row in the strategy table — and of every pick above it. (Added
    // only to the parent's pick before 2026-09-27: the table showed a $300
    // screening option as $0.) On a branch into a terminal it IS the
    // terminal's number (above, and payoffText in layout.ts).
    if (branch && node.type !== "terminal" && kids.length > 0) {
      if (e !== undefined) e += num(branch.payoff) ?? 0;
      if (c !== undefined) c += num(branch.cost) ?? 0;
    }
    if (e !== undefined) out.ev[id] = e;
    if (c !== undefined) out.cost[id] = c;
    if (useNmb && e !== undefined && c !== undefined) out.nmb[id] = e * wtp! - c;
    return { e, c };
  };
  fold(root, [0]);
  out.issues = treeIssues(root, true);
  return out;
}

/**
 * What is wrong with a tree's numbers. `rollback`: whether the tree is
 * folded back (then a sum off 1 corrupts every number above it: an error;
 * a hand-labelled tree only draws its probabilities: a warning).
 */
export function treeIssues(root: TreeNode, rollbackOn: boolean): TreeIssue[] {
  const issues: TreeIssue[] = [];
  const sev = rollbackOn ? "error" : "warn";
  walkTree(root, (node, id) => {
    const kids = (node.children ?? []).filter((b) => b && typeof b === "object" && b.node && typeof b.node === "object");
    if (kids.length === 0) return;
    const name = `"${node.label ?? id}" (${id})`;
    if (node.type === "decision") {
      const withP = kids.filter((b) => b.probability !== undefined);
      if (withP.length > 0) {
        issues.push({
          severity: "warn",
          message: `decision node ${name}: its options carry probabilities (${withP.map((b) => b.label ?? b.node.label).join(", ")}) — a decision is chosen, not drawn by chance; put probabilities on a chance node's branches`,
        });
      }
      return;
    }
    if (node.type !== "chance") return;
    const { p, filled } = fillProbabilities(kids);
    const missing = p.filter((v) => v === undefined).length;
    if (missing > 0) {
      // A tree that only draws its labels may leave probabilities off.
      if (rollbackOn) issues.push({ severity: "error", message: `chance node ${name}: ${missing} branches have no probability — give all but at most one (that one is 1 − the others)` });
      return;
    }
    const bad = p.find((v) => v! < 0 || v! > 1);
    if (bad !== undefined) {
      issues.push({ severity: sev, message: `chance node ${name}: a probability of ${bad} is outside 0–1` });
      return;
    }
    const sum = p.reduce<number>((a, v) => a + v!, 0);
    const given = kids.filter((_, i) => i !== filled).reduce((a, b) => a + (b.probability ?? 0), 0);
    if (filled !== undefined && given > 1 + SUM_TOLERANCE) {
      issues.push({ severity: sev, message: `chance node ${name}: the given probabilities already sum to ${round(given)}, so the branch without one would get ${round(1 - given)} — they must sum to 1` });
    } else if (Math.abs(sum - 1) > SUM_TOLERANCE) {
      issues.push({ severity: sev, message: `chance node ${name}: its branch probabilities sum to ${round(sum)}, not 1 — leave one out to have it filled in as the complement` });
    }
  });
  return issues;
}

const round = (v: number) => Number(v.toFixed(4));

export interface StrategyInput {
  id: string;
  label: string;
  cost: number;
  effect: number;
}

export interface StrategyRow extends StrategyInput {
  /** "ref": the cheapest undominated option; "frontier": on the efficient frontier, with an ICER. */
  status: "ref" | "frontier" | "dominated" | "ext_dominated";
  /** The option the increments are against: the next cheaper one on the frontier, when there is one. */
  vs?: string;
  /** Against that option. */
  dCost?: number;
  dEffect?: number;
  icer?: number;
}

/**
 * The incremental cost-effectiveness table: options by cost, the (strictly)
 * dominated ones out — dearer and no better — then the extendedly dominated
 * ones — an ICER above the next option's — until every ICER along the
 * frontier rises. Each row's increments are against the frontier option
 * cheaper than it.
 */
export function strategyTable(options: StrategyInput[]): StrategyRow[] {
  const rows: StrategyRow[] = [...options]
    .sort((a, b) => a.cost - b.cost || b.effect - a.effect)
    .map((o) => ({ ...o, status: "frontier" as StrategyRow["status"] }));
  const EPS = 1e-9;
  for (const r of rows) {
    if (rows.some((o) => o !== r && o.cost <= r.cost + EPS && o.effect >= r.effect - EPS && (o.cost < r.cost - EPS || o.effect > r.effect + EPS))) r.status = "dominated";
  }
  // Two options of equal cost and effect: the later one is a duplicate.
  rows.forEach((r, i) => {
    if (r.status === "frontier" && rows.slice(0, i).some((o) => o.status === "frontier" && Math.abs(o.cost - r.cost) <= EPS && Math.abs(o.effect - r.effect) <= EPS)) r.status = "dominated";
  });
  for (;;) {
    const f = rows.filter((r) => r.status !== "dominated" && r.status !== "ext_dominated");
    let removed = false;
    for (let i = 1; i + 1 < f.length; i++) {
      const a = (f[i].cost - f[i - 1].cost) / (f[i].effect - f[i - 1].effect);
      const b = (f[i + 1].cost - f[i].cost) / (f[i + 1].effect - f[i].effect);
      if (a > b + EPS) {
        f[i].status = "ext_dominated";
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  let prev: StrategyRow | undefined;
  for (const r of rows) {
    if (prev) {
      r.vs = prev.id;
      r.dCost = r.cost - prev.cost;
      r.dEffect = r.effect - prev.effect;
    }
    if (r.status === "frontier" || r.status === "ref") {
      if (!prev) r.status = "ref";
      else if (r.dEffect! > EPS) r.icer = r.dCost! / r.dEffect!;
      prev = r;
    }
  }
  return rows;
}
