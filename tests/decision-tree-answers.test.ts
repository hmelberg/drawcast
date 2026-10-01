import { describe, expect, test } from "vitest";
import { layoutDecisionTree } from "../src/scenes/decision_tree/layout";

const root = {
  id: "start", type: "decision", label: "Choose",
  children: [
    { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
      { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
      { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4, cost: 300 } },
    ] } },
    { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5 } },
  ],
};

const textOf = (l: ReturnType<typeof layoutDecisionTree>, id: string): string | undefined => {
  const label = l.labels?.find((x: { id: string }) => x.id === id) as { text?: string } | undefined;
  if (label?.text !== undefined) return label.text;
  const d = l.drawables.find((x: { id: string }) => x.id === id) as { text?: string } | undefined;
  return d?.text;
};

describe("answers", () => {
  test("a blank value shows ?", () => {
    const l = layoutDecisionTree({ root, rollback: true, answers: { value_treat: "?" } } as never);
    expect(textOf(l, "value_treat")).toBe("?");
  });
  test("a blank probability keeps the branch name", () => {
    const l = layoutDecisionTree({ root, rollback: true, answers: { branchlabel_treat_cured: "?" } } as never);
    expect(textOf(l, "branchlabel_treat_cured")).toMatch(/Cured/);
    expect(textOf(l, "branchlabel_treat_cured")).toMatch(/\?/);
    expect(textOf(l, "branchlabel_treat_cured")).not.toMatch(/0\.3/);
  });
  test("a filled-in probability can be blanked too", () => {
    const l = layoutDecisionTree({ root, rollback: true, answers: { branchlabel_treat_not: "?" } } as never);
    expect(textOf(l, "branchlabel_treat_not")).toMatch(/Not/);
    expect(textOf(l, "branchlabel_treat_not")).not.toMatch(/0\.7/);
  });
  test("a terminal's payoff and cost blanks", () => {
    const l = layoutDecisionTree({ root, rollback: true, answers: { effect_wait: "?", cost_not: "??" } } as never);
    expect(textOf(l, "effect_wait")).toBe("?");
    expect(textOf(l, "cost_not")).toBe("??");
  });
  test("rollback is unchanged by answers", () => {
    const a = layoutDecisionTree({ root, rollback: true } as never);
    const b = layoutDecisionTree({ root, rollback: true, answers: { value_treat: "?" } } as never);
    expect(b.values).toEqual(a.values);
  });
});
