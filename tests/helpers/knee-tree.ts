// A decision tree too big for one page, for the world tests and renders
// (tests/decision-tree-world.test.ts).
import type { DecisionTreeParams, TreeNode } from "../../src/scenes/decision_tree/layout";

const end = (id: string, label: string, payoff: number, cost?: number): TreeNode => ({ id, type: "terminal", label, payoff, ...(cost !== undefined && { cost }) });

/**
 * Four treatments for a painful knee, each with a good result, some relief,
 * or no better — and no better has three ways on: 20 terminals, at two depths.
 */
export function knee(extra: Partial<DecisionTreeParams> = {}, costs = false): DecisionTreeParams {
  const arms = [
    ["physio", "Physiotherapy", 2000],
    ["inject", "Injections", 3500],
    ["scope", "Arthroscopy", 9000],
    ["replace", "Knee replacement", 18000],
  ] as const;
  return {
    ...extra,
    root: {
      id: "choice",
      type: "decision",
      label: "Painful knee",
      children: arms.map(([id, label, c], i) => ({
        label,
        node: {
          id,
          type: "chance",
          label,
          children: [
            { label: "Good result", probability: 0.4 + i * 0.05, node: end(`${id}_good`, "Pain free", 9, costs ? c : undefined) },
            { label: "Some relief", probability: 0.3, node: end(`${id}_some`, "Better", 7.5, costs ? c : undefined) },
            {
              label: "No better",
              probability: Number((0.3 - i * 0.05).toFixed(2)),
              node: {
                id: `${id}_no`,
                type: "chance",
                label: "Still in pain",
                children: [
                  { label: "Operated later", probability: 0.5, node: end(`${id}_op`, "Replaced later", 8, costs ? c + 20000 : undefined) },
                  { label: "Lives with it", probability: 0.45, node: end(`${id}_live`, "Chronic pain", 5.5, costs ? c + 4000 : undefined) },
                  { label: "Complication", probability: 0.05, node: end(`${id}_bad`, "Complication", 3, costs ? c + 30000 : undefined) },
                ],
              },
            },
          ],
        },
      })),
    },
  };
}
