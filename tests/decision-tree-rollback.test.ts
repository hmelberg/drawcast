// decision_tree computes its own results under `rollback: true` (2026-09-27):
// expected values folded back, missing probabilities filled in, each
// decision's pick, the root's options as an ICER table, the numbers as
// SceneLayout.values, collapsed subtrees, and the probability lint.
import { describe, expect, test } from "vitest";
import { layoutDecisionTree, type DecisionTreeParams, type TreeNode } from "../src/scenes/decision_tree/layout";
import { fillProbabilities, rollback, strategyTable, treeIssues } from "../src/scenes/decision_tree/rollback";
import { lintDecisionTree } from "../src/scenes/decision_tree/lint";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import manifest from "../src/scenes/decision_tree/manifest.json";
import type { Spec } from "../src/spec/types";

const t = (id: string, payoff: number, cost?: number): TreeNode => ({ id, type: "terminal", label: id, payoff, ...(cost !== undefined && { cost }) });

/** Surgery vs medication: surgery 0.9 × 9.5 + 0.1 × 4 = 8.95, medication 7. */
const simple = (): DecisionTreeParams => ({
  rollback: true,
  root: {
    id: "choice",
    type: "decision",
    label: "Choice",
    children: [
      { label: "Surgery", node: { id: "surgery", type: "chance", label: "Surgery", children: [{ label: "Ok", probability: 0.9, node: t("s_ok", 9.5) }, { label: "Bad", node: t("s_bad", 4) }] } },
      { label: "Medication", node: t("med", 7) },
    ],
  },
});

/** The manifest's cost example: watch 5.8 / $42,000, medication 7.1 / $78,000, surgery 8.4 / $165,000. */
const costed = (): DecisionTreeParams => structuredClone(manifest.examples[1].params) as unknown as DecisionTreeParams;

const labelText = (l: { labels: { id: string; text: string }[] }, id: string) => l.labels.find((x) => x.id === id)?.text;
const ids = (l: { drawables: Parameters<typeof flattenDrawables>[0] }) => flattenDrawables(l.drawables).map((d) => d.id);

describe("fold-back", () => {
  test("a chance node's expected payoff is Σ p × child; the decision takes the larger", () => {
    const r = rollback(simple().root);
    expect(r.ev.surgery).toBeCloseTo(8.95, 10);
    expect(r.ev.choice).toBeCloseTo(8.95, 10);
    expect(r.best.choice).toBe(0);
    expect(r.bestId.choice).toBe("surgery");
    expect(r.hasCost).toBe(false);
  });

  test("the one branch without a probability gets the complement, and its label says so", () => {
    expect(fillProbabilities([{ probability: 0.25, node: t("a", 1) }, { node: t("b", 1) }, { probability: 0.5, node: t("c", 1) }])).toEqual({ p: [0.25, 0.25, 0.5], filled: 1 });
    // Two missing: nothing is guessed.
    expect(fillProbabilities([{ node: t("a", 1) }, { node: t("b", 1) }]).filled).toBeUndefined();
    const l = layoutDecisionTree(simple());
    expect(labelText(l, "branchlabel_surgery_s_bad")).toBe("Bad (p=0.1)");
    expect(l.values!.p_surgery_s_bad).toBeCloseTo(0.1, 10);
  });

  test("computed values are drawn under the nodes; a hand-written value still wins", () => {
    const l = layoutDecisionTree(simple());
    expect(labelText(l, "value_surgery")).toBe("8.95");
    expect(labelText(l, "value_choice")).toBe("8.95");
    const p = simple();
    p.root.children![0].node.value = "EV ≈ 9";
    expect(labelText(layoutDecisionTree(p), "value_surgery")).toBe("EV ≈ 9");
  });

  test("without rollback nothing is computed or drawn that was not before", () => {
    const p = simple();
    delete p.rollback;
    const l = layoutDecisionTree(p);
    expect(l.values).toBeUndefined();
    expect(labelText(l, "value_surgery")).toBeUndefined();
    expect(labelText(l, "branchlabel_surgery_s_bad")).toBe("Bad");
    expect(ids(l).some((id) => id.startsWith("best_") || id.startsWith("prune_") || id.startsWith("strategy_"))).toBe(false);
  });

  test("the chosen branch is highlighted, the others pruned", () => {
    const l = layoutDecisionTree(simple());
    expect(ids(l)).toContain("best_choice_surgery");
    expect(ids(l)).toContain("prune_choice_med");
    expect(l.groups?.best).toEqual(["best_choice_surgery"]);
    expect(l.groups?.pruned).toEqual(["prune_choice_med"]);
    expect(l.attached?.edge_choice_surgery).toContain("best_choice_surgery");
  });

  test("a nested decision picks its own best, and the parent folds back that", () => {
    const root: TreeNode = {
      id: "c",
      type: "chance",
      label: "Test",
      children: [
        { probability: 0.5, node: { id: "d", type: "decision", label: "Then", children: [{ node: t("x", 1) }, { node: t("y", 3) }] } },
        { probability: 0.5, node: t("z", 5) },
      ],
    };
    const r = rollback(root);
    expect(r.bestId.d).toBe("y");
    expect(r.ev.c).toBeCloseTo(4, 10);
  });

  test("a branch cost into a subtree is added to everything after it", () => {
    const root: TreeNode = { id: "d", type: "decision", label: "D", children: [{ cost: 100, node: { id: "c", type: "chance", label: "C", children: [{ probability: 0.5, node: t("a", 1, 10) }, { probability: 0.5, node: t("b", 1, 30) }] } }] };
    expect(rollback(root).cost.c).toBe(20);
    expect(rollback(root).cost.d).toBe(120);
  });

  test("a missing payoff leaves everything above it unfolded, and the lint says which", () => {
    const p = simple();
    delete (p.root.children![0].node.children![1].node as { payoff?: number }).payoff;
    const r = rollback(p.root);
    expect(r.ev.surgery).toBeUndefined();
    expect(r.best.choice).toBeUndefined();
    expect(lintDecisionTree(p).map((i) => i.message).join(" ")).toMatch(/s_bad has no payoff/);
  });
});

describe("costs, willingness to pay and the ICER table", () => {
  test("expected costs fold back like payoffs", () => {
    const r = rollback(costed().root);
    expect(r.cost.watch).toBeCloseTo(42000, 6);
    expect(r.cost.med).toBeCloseTo(78000, 6);
    expect(r.cost.surgery).toBeCloseTo(165000, 6);
    expect(r.ev.med).toBeCloseTo(7.1, 10);
  });

  test("without wtp a decision takes the highest payoff, with it the highest net benefit", () => {
    const p = costed();
    delete p.wtp;
    expect(rollback(p.root).bestId.choice).toBe("surgery");
    // NMB at $50,000: watch 248,000, medication 277,000, surgery 255,000.
    expect(rollback(costed().root, { wtp: 50000 }).bestId.choice).toBe("med");
    expect(rollback(costed().root, { wtp: 50000 }).nmb.med).toBeCloseTo(277000, 4);
    // Past surgery's ICER ($66,923) surgery wins.
    expect(rollback(costed().root, { wtp: 70000 }).bestId.choice).toBe("surgery");
  });

  test("the table: by cost, increments against the frontier, ICERs", () => {
    const l = layoutDecisionTree(costed());
    const v = l.values!;
    expect(v.icer_med).toBeCloseTo(36000 / 1.3, 6);
    expect(v.icer_surgery).toBeCloseTo(87000 / 1.3, 6);
    expect(v.icer_watch).toBeUndefined();
    expect(v.best).toBe(1);
    expect(v.ev_choice).toBeCloseTo(7.1, 10);
    expect(v.cost_choice).toBeCloseTo(78000, 6);
    expect(l.groups?.strategy_table).toEqual(["strategy_head", "strategy_rule", "strategy_row_watch", "strategy_row_med", "strategy_row_surgery", "strategy_wtp"]);
    const row = flattenDrawables(l.drawables).filter((d) => d.id.startsWith("strategy_row_med__")) as TextDrawable[];
    expect(row.map((d) => d.text)).toEqual(["Medication", "$78,000", "7.1", "+$36,000", "+1.3", "$27,700"]);
    expect(labelText(l, "value_med")).toBe("7.1, $78,000");
    expect(labelText(l, "payoff_m_ok")).toBe("8, $60,000");
  });

  test("dominance: dearer and no better is dominated; an ICER above the next one is extended dominance", () => {
    const rows = strategyTable([
      { id: "a", label: "A", cost: 0, effect: 0 },
      { id: "b", label: "B", cost: 100, effect: 1 },
      { id: "c", label: "C", cost: 150, effect: 0.5 }, // dearer than B, worse: dominated
      { id: "d", label: "D", cost: 500, effect: 2 }, // B→D 400/QALY, but …
      { id: "e", label: "E", cost: 700, effect: 4 }, // … B→E 200/QALY: D is extendedly dominated
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(by.a.status).toBe("ref");
    expect(by.b.icer).toBe(100);
    expect(by.c.status).toBe("dominated");
    expect(by.d.status).toBe("ext_dominated");
    expect(by.e.icer).toBe(200);
    expect(by.e.dCost).toBe(600);
    expect(by.d.icer).toBeUndefined();
  });

  test("table: false hides it; a tree without costs never has one", () => {
    expect(ids(layoutDecisionTree({ ...costed(), table: false })).some((id) => id.startsWith("strategy_"))).toBe(false);
    expect(ids(layoutDecisionTree(simple())).some((id) => id.startsWith("strategy_"))).toBe(false);
  });

  test("the numbers reach a cast's drawn text as {tree.<key>}", () => {
    const spec = {
      template: "decision_tree",
      params: costed(),
      elements: [{ id: "note", type: "text", x: 500, y: 700, text: "ICER {tree.icer_med:0}" }],
      commands: [],
    } as unknown as Spec;
    const note = flattenDrawables(layoutSpec(spec, heuristicMeasure).drawables).find((d) => d.id === "note") as TextDrawable;
    expect(note.text).toBe("ICER 27692");
  });

  test("the cost example lays out without a lint issue", () => {
    const spec = { title: "t", template: "decision_tree", params: costed(), commands: [] } as unknown as Spec;
    expect(layoutSpec(spec).issues.map((i) => i.message)).toEqual([]);
  });
});

describe("collapsed subtrees", () => {
  test("a collapsed node draws no children but still folds them back", () => {
    const p = simple();
    p.root.children![0].node.collapsed = true;
    const l = layoutDecisionTree(p);
    expect(ids(l)).toContain("node_surgery");
    expect(ids(l)).toContain("collapsed_surgery");
    expect(ids(l)).not.toContain("node_s_ok");
    expect(ids(l)).not.toContain("edge_surgery_s_ok");
    expect(labelText(l, "value_surgery")).toBe("8.95");
    expect(l.values!.ev_s_ok).toBe(9.5);
    expect(l.attached?.node_surgery).toContain("collapsed_surgery");
  });

  test("collapsed on a terminal, or a node without children, draws as usual", () => {
    const p = simple();
    (p.root.children![1].node as TreeNode).collapsed = true;
    expect(ids(layoutDecisionTree(p)).some((id) => id.startsWith("collapsed_"))).toBe(false);
  });
});

describe("the probability lint", () => {
  const chance = (ps: (number | undefined)[]): TreeNode => ({ id: "c", type: "chance", label: "C", children: ps.map((p, i) => ({ ...(p !== undefined && { probability: p }), node: t(`t${i}`, i) })) });

  test("a sum within ±0.005 of 1 passes; off it is an error under rollback, a warning without", () => {
    expect(treeIssues(chance([0.333, 0.333, 0.333]), true)).toEqual([]);
    expect(treeIssues(chance([0.5, 0.4]), true)).toEqual([expect.objectContaining({ severity: "error", message: expect.stringMatching(/sum to 0\.9/) })]);
    expect(treeIssues(chance([0.5, 0.4]), false)[0].severity).toBe("warn");
  });

  test("after the complement: givens over 1 are an error; two missing is an error only under rollback", () => {
    expect(treeIssues(chance([0.7, 0.6, undefined]), true)[0].message).toMatch(/already sum to 1\.3/);
    expect(treeIssues(chance([0.7, undefined]), true)).toEqual([]);
    expect(treeIssues(chance([0.7, undefined, undefined]), true)[0].message).toMatch(/2 branches have no probability/);
    expect(treeIssues(chance([0.7, undefined, undefined]), false)).toEqual([]);
  });

  test("a decision's options with probabilities warn", () => {
    const d: TreeNode = { id: "d", type: "decision", label: "D", children: [{ label: "A", probability: 0.5, node: t("a", 1) }, { label: "B", node: t("b", 2) }] };
    expect(treeIssues(d, false)).toEqual([expect.objectContaining({ severity: "warn", message: expect.stringMatching(/decision node "D" \(d\).*A/) })]);
  });

  test("reaches layoutSpec's lint as template-params", () => {
    const p = simple();
    p.root.children![0].node.children![0].probability = 1.2;
    const spec = { title: "t", template: "decision_tree", params: p, commands: [] } as unknown as Spec;
    const issue = layoutSpec(spec).issues.find((i) => i.rule === "template-params");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toMatch(/Surgery/);
  });
});

describe("large trees", () => {
  const big = (a: number, b: number, size?: DecisionTreeParams["size"]): DecisionTreeParams => ({
    ...(size && { size }),
    root: {
      id: "d",
      type: "decision",
      label: "Choice",
      children: Array.from({ length: a }, (_, i) => ({
        label: `Option ${i + 1}`,
        node: { id: `c${i}`, type: "chance", label: `Opt ${i + 1}`, children: Array.from({ length: b }, (_, j) => ({ label: `Out ${j + 1}`, probability: 1 / b, node: t(`t${i}_${j}`, i + j) })) },
      })),
    },
  });

  test("a two-by-two tree keeps its full text size", () => {
    expect(layoutDecisionTree(big(2, 2)).textSize).toBe(26);
  });

  test.each([
    [3, 3],
    [4, 3],
  ])("on the page, a %i×%i tree gives up text size instead of overlapping its words", (a, b) => {
    const l = layoutDecisionTree(big(a, b, "page"));
    expect(l.textSize).toBeLessThan(26);
    expect(l.textSize).toBeGreaterThanOrEqual(14);
    const spec = { title: "t", template: "decision_tree", params: big(a, b, "page"), commands: [] } as unknown as Spec;
    expect(layoutSpec(spec).issues.filter((i) => i.rule.startsWith("overlap")).map((i) => i.message)).toEqual([]);
  });

  test("the lint suggests size: full or collapsing when the text had to go below 16", () => {
    const said = lintDecisionTree(big(4, 4, "page")).map((i) => i.message).join(" ");
    expect(said).toMatch(/collapsed: true/);
    expect(said).toMatch(/size: "full"/);
    expect(lintDecisionTree(big(2, 2))).toEqual([]);
  });
});
