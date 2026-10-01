import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import bundled from "../src/examples.json";
import type { Spec } from "../src/spec/types";

// Tree asks (spec 2026-10-03 §4.4): blanks and pick on a decision tree.
const guessIssues = (spec: Spec) => lintCommands(expandSpec(spec)).filter((i) => i.rule === "guess");

const root = {
  id: "start", type: "decision", label: "Choose",
  children: [
    { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
      { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
      { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4 } },
    ] } },
    { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5 } },
  ],
};

const tree = (ask: Record<string, unknown>, params: Record<string, unknown> = {}): Spec =>
  ({
    template: "decision_tree",
    params: { root, rollback: true, ...params },
    commands: [{ draw: ["node_start"] }, { ask: { question: "?", ...ask } }],
  }) as unknown as Spec;

/** A chance node with n terminal children under one decision: n + 2 nodes. */
function wide(n: number) {
  const kids = Array.from({ length: n }, (_, i) => ({ label: `o${i}`, probability: 1 / n, node: { id: `t${i}`, type: "terminal", label: "", payoff: i } }));
  return {
    id: "start", type: "decision", label: "Choose",
    children: [{ label: "Go", node: { id: "go", type: "chance", label: "", children: kids } }],
  };
}

describe("tree ask lint", () => {
  test("a clean ask has no issues", () => {
    expect(guessIssues(tree({ blanks: ["value_treat"] }))).toEqual([]);
    expect(guessIssues(tree({ pick: "start" }))).toEqual([]);
    expect(guessIssues(tree({ on: "tree", blanks: ["value_treat", "branchlabel_treat_not"], pick: "start" }))).toEqual([]);
  });

  test("a blank naming an unknown part is one error with treeBlanks' message", () => {
    const issues = guessIssues(tree({ blanks: ["value_nowhere"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/no chance or decision node "nowhere"/);
  });

  test("a value blank with rollback off is an error", () => {
    const issues = guessIssues(tree({ blanks: ["value_treat"] }, { rollback: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/rollback: true/);
  });

  test("more than 4 blanks warns", () => {
    const issues = guessIssues(tree({ blanks: ["value_treat", "value_start", "branchlabel_treat_not", "branchlabel_treat_cured", "effect_wait"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/more than 4 blanks/);
  });

  test("a tree with 13 nodes warns; 12 is fine", () => {
    const big = guessIssues(tree({ blanks: ["value_go"] }, { root: wide(11) }));
    expect(big).toHaveLength(1);
    expect(big[0].severity).toBe("warn");
    expect(big[0].message).toMatch(/13 nodes/);
    expect(guessIssues(tree({ blanks: ["value_go"] }, { root: wide(10) }))).toEqual([]);
  });

  test("pick on a chance node is an error", () => {
    const issues = guessIssues(tree({ pick: "treat" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/not a decision node/);
  });

  test("blanks on a non-tree template is an error", () => {
    const spec = { template: "bar_chart", params: { labels: ["A"], values: [1] }, commands: [{ ask: { question: "?", blanks: ["value_x"] } }] } as unknown as Spec;
    const issues = guessIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/blanks: only a decision tree has blanks/);
  });

  test("pick on a non-tree template is an error", () => {
    const spec = { template: "bar_chart", params: { labels: ["A"], values: [1] }, commands: [{ ask: { question: "?", pick: "start" } }] } as unknown as Spec;
    const issues = guessIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/pick: only a decision tree/);
  });

  test("a tree ask on something other than the tree is an error", () => {
    const issues = guessIssues(tree({ on: "bar_1", blanks: ["value_treat"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/on: "tree"/);
  });

  test("guess-only fields on a tree ask warn that they do nothing", () => {
    const issues = guessIssues(tree({ blanks: ["value_treat"], budget: 10, relative: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/budget, relative/);
  });

  test("a tree ask with store, right, wrong and tolerance validates (no default, no answer)", () => {
    const spec = tree({ blanks: ["value_treat"], store: "e", right: "Yes", wrong: "No: {e.work}", tolerance: 0.01, work: "all" });
    expect(validateSpec(spec).errors ?? []).toEqual([]);
  });

  test("the tree must be drawn before its ask; its blanks need not be", () => {
    const undrawn = { ...tree({ blanks: ["value_treat"] }), commands: [{ ask: { question: "?", blanks: ["value_treat"] } }] } as unknown as Spec;
    const issues = guessIssues(undrawn);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/draw the tree first/);
    // The tree drawn whole, the blank's own part included: fine (it shows "?").
    const whole = { ...tree({ blanks: ["value_treat"] }), commands: [{ draw: ["node_start", "value_treat"] }, { ask: { question: "?", blanks: ["value_treat"] } }] } as unknown as Spec;
    expect(guessIssues(whole)).toEqual([]);
  });

  test("answer, widget or retry on a tree ask warn that they do nothing", () => {
    const issues = guessIssues(tree({ blanks: ["value_treat"], answer: "5.8", retry: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/answer, retry do nothing on a tree ask/);
    expect(guessIssues(tree({ pick: "start", widget: "choice" }))[0]?.message).toMatch(/widget do nothing on a tree ask/);
  });

  test("the bundled tree-ask examples lint clean", () => {
    const withTree = (bundled as { spec?: Spec }[]).filter((e) => e.spec?.commands?.some((c) => c.ask?.blanks !== undefined || c.ask?.pick !== undefined));
    expect(withTree.length).toBeGreaterThanOrEqual(2);
    for (const e of withTree) expect(lintCommands(expandSpec(e.spec!))).toEqual([]);
  });
});
