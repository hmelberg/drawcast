// What layout.ts's template lint hears about a decision tree's params
// (SceneModule.lint): probabilities that do not sum to 1, a decision's
// options carrying probabilities, numbers a rollback needs and lacks, and a
// tree too big for the page.

import { layoutDecisionTree, type DecisionTreeParams } from "./layout";
import { rollback, treeIssues, walkTree, type TreeIssue } from "./rollback";

/** Below this text size the tree is legible only zoomed in: say how to split it. */
const SMALL_TEXT = 16;

export function lintDecisionTree(params: DecisionTreeParams & { box?: unknown }): TreeIssue[] {
  const root = params?.root;
  if (!root || typeof root !== "object") return [];
  const on = params.rollback === true;
  const issues = treeIssues(root, on);
  if (on) {
    const r = rollback(root, { wtp: params.wtp });
    const noPayoff: string[] = [];
    walkTree(root, (node, id, branch) => {
      const leaf = node.type === "terminal" || (node.children ?? []).length === 0;
      if (leaf && r.hasPayoff && node.payoff === undefined && branch?.payoff === undefined) noPayoff.push(id);
    });
    if (noPayoff.length > 0) {
      issues.push({ severity: "warn", message: `rollback: ${noPayoff.join(", ")} ${noPayoff.length === 1 ? "has" : "have"} no payoff, so nothing above ${noPayoff.length === 1 ? "it" : "them"} can be folded back` });
    }
    if (params.wtp !== undefined && !r.hasCost) issues.push({ severity: "warn", message: "wtp is set but no terminal has a cost — decisions pick the highest payoff" });
  }
  try {
    const l = layoutDecisionTree(params);
    if (l.textSize < SMALL_TEXT - 0.01) {
      let leaves = 0;
      walkTree(root, (node) => {
        if (node.type === "terminal") leaves++;
      });
      issues.push({
        severity: "warn",
        message: `the tree (${leaves} terminals) only fits the page with its text at ${l.textSize.toFixed(0)} — set collapsed: true on a subtree to show it in parts (its value is still computed), or split it across pages`,
      });
    }
  } catch {
    // A tree the layout cannot draw is the layout's warning, not this lint's.
  }
  return issues;
}
