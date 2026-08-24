import { describe, expect, test } from "vitest";
import { layoutDecisionTree, type DecisionTreeParams } from "../src/scenes/decision_tree/layout";
import { flattenDrawables } from "../src/layout/model";
import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";

const params: DecisionTreeParams = {
  root: {
    id: "choice",
    type: "decision",
    label: "Treatment choice",
    children: [
      {
        label: "Surgery",
        node: {
          id: "surgery",
          type: "chance",
          label: "Surgery",
          children: [
            { label: "Success", probability: 0.9, node: { id: "s_ok", type: "terminal", label: "Recovered", payoff: 9.5 } },
            { label: "Complication", probability: 0.1, node: { id: "s_bad", type: "terminal", label: "Complication", payoff: 4.0 } },
          ],
        },
      },
      {
        label: "Medication",
        node: { id: "med", type: "terminal", label: "Medication", payoff: 7.0 },
      },
    ],
  },
};

describe("layoutDecisionTree", () => {
  test("produces a node drawable per tree node and edges between them", () => {
    const r = layoutDecisionTree(params);
    const flat = flattenDrawables(r.drawables);
    for (const id of ["node_choice", "node_surgery", "node_s_ok", "node_s_bad", "node_med"]) {
      expect(flat.map((d) => d.id)).toContain(id);
    }
    expect(flat.map((d) => d.id)).toContain("edge_choice_surgery");
    expect(flat.map((d) => d.id)).toContain("edge_surgery_s_ok");
  });

  test("root is left of children (horizontal layout), depth increases x", () => {
    const r = layoutDecisionTree(params);
    expect(r.positions["choice"][0]).toBeLessThan(r.positions["surgery"][0]);
    expect(r.positions["surgery"][0]).toBeLessThan(r.positions["s_ok"][0]);
  });

  test("sibling nodes do not overlap vertically", () => {
    const r = layoutDecisionTree(params);
    const dy = Math.abs(r.positions["s_ok"][1] - r.positions["s_bad"][1]);
    expect(dy).toBeGreaterThan(40);
  });

  test("branch probability and payoff labels exist", () => {
    const r = layoutDecisionTree(params);
    const labelIds = r.labels.map((l) => l.id);
    expect(labelIds).toContain("branchlabel_surgery_s_ok");
    expect(labelIds).toContain("payoff_s_ok");
    const prob = r.labels.find((l) => l.id === "branchlabel_surgery_s_ok");
    expect(prob!.text).toMatch(/0\.9/);
    const payoff = r.labels.find((l) => l.id === "payoff_s_ok");
    expect(payoff!.text).toMatch(/9\.5/);
  });

  test("node ids fall back to path-based ids when not given", () => {
    const r = layoutDecisionTree({
      root: { type: "decision", label: "Root", children: [{ label: "a", node: { type: "terminal", label: "A" } }] },
    });
    const flat = flattenDrawables(r.drawables);
    expect(flat.map((d) => d.id)).toContain("node_0");
    expect(flat.map((d) => d.id)).toContain("node_0_0");
  });
});

// Branch labels carry the option AND its probability ("Not controlled
// (p=0.3)"), which is what a real health-economics tree says. The text is
// placed at the edge midpoint, where the sibling branch is one node-gap away,
// so anything longer than a word used to land on it — the figure was only
// clean if you kept every branch label to about five characters.
describe("branch labels survive realistic lengths", () => {
  function twoArmTree(a: string, b: string): DecisionTreeParams {
    return {
      root: {
        id: "choice",
        type: "decision",
        label: "Treatment choice",
        children: [
          {
            label: "Surgery",
            node: {
              id: "surgery",
              type: "chance",
              label: "Surgery",
              children: [
                { label: "Success", probability: 0.9, node: { id: "s_ok", type: "terminal", label: "Full recovery", payoff: 9.5 } },
                { label: "Complication", probability: 0.1, node: { id: "s_bad", type: "terminal", label: "Complication", payoff: 4 } },
              ],
            },
          },
          {
            label: "Medication",
            node: {
              id: "med",
              type: "chance",
              label: "Medication",
              children: [
                { label: a, probability: 0.7, node: { id: "m_ok", type: "terminal", label: "Controlled", payoff: 7.5 } },
                { label: b, probability: 0.3, node: { id: "m_bad", type: "terminal", label: "Still ill", payoff: 5 } },
              ],
            },
          },
        ],
      },
    };
  }

  test.each([
    ["Works", "Fails"],
    ["Controlled", "Not controlled"],
    ["Symptoms resolve", "Symptoms persist"],
    ["Symptoms resolve completely", "Symptoms persist or worsen"],
    ["The patient recovers fully within six months", "The patient does not recover at all"],
  ])("%s / %s — no label collides with a stroke", (a, b) => {
    const spec = { title: "t", template: "decision_tree", params: twoArmTree(a, b), commands: [] } as unknown as Spec;
    expect(layoutSpec(spec).issues.map((i) => i.message)).toEqual([]);
  });

  // A three-way fan puts one branch dead horizontal, with a sibling wedge
  // right above it — the shape that used to leave the middle label lying
  // across its own branch whatever its length.
  test.each([2, 3])("a %i-way fan keeps every branch label off the strokes", (n) => {
    const params = {
      root: {
        id: "r",
        type: "chance",
        label: "Outcome",
        children: Array.from({ length: n }, (_, i) => ({
          label: `A rather longer outcome name ${i + 1}`,
          probability: 1 / n,
          node: { id: `t${i}`, type: "terminal", label: `Outcome ${i + 1}`, payoff: i },
        })),
      },
    } as unknown as DecisionTreeParams;
    const spec = { title: "t", template: "decision_tree", params, commands: [] } as unknown as Spec;
    expect(layoutSpec(spec).issues.map((i) => i.message)).toEqual([]);
  });
});
