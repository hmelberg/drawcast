// decision_tree's terminal numbers as columns (Hans, 2026-09-27: "the end
// note has the outcome in QALY and the cost. The two are so close it is
// confusing. Also no headline on top."). A terminal's payoff and cost are
// two texts, right-aligned in two columns per depth, a clear gap between,
// each column headed once over its topmost terminal; payoff_<id> names the
// pair, and a heading is drawn with the first number of its column.
import { describe, expect, test } from "vitest";
import { layoutDecisionTree, type DecisionTreeParams } from "../src/scenes/decision_tree/layout";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { bboxOfText } from "../src/layout/geometry";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { knee } from "./helpers/knee-tree";
import manifest from "../src/scenes/decision_tree/manifest.json";
import examples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";
import type { Spec } from "../src/spec/types";

const CE = manifest.examples[1].params as unknown as DecisionTreeParams;
const specOf = (params: DecisionTreeParams, commands: unknown[] = []): Spec => ({ title: "t", template: "decision_tree", params, commands }) as unknown as Spec;
const texts = (l: { drawables: Parameters<typeof flattenDrawables>[0] }) => new Map(flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => [d.id, d]));

describe("the numbers stand in columns", () => {
  test("the payoffs share a right edge, the costs another, a clear gap between them", () => {
    const l = layoutDecisionTree(structuredClone(CE));
    const t = texts(l);
    const ends = ["w_ok", "w_bad", "m_ok", "m_bad", "s_ok", "s_bad"];
    const effects = ends.map((id) => t.get(`effect_${id}`)!);
    const costs = ends.map((id) => t.get(`cost_${id}`)!);
    for (const d of [...effects, ...costs]) expect(d.anchor).toBe("end");
    expect(new Set(effects.map((d) => d.pos[0])).size).toBe(1);
    expect(new Set(costs.map((d) => d.pos[0])).size).toBe(1);
    // The widest cost's left edge stands well clear of the payoff column.
    const costLeft = Math.min(...costs.map((d) => bboxOfText(d, heuristicMeasure).x));
    expect(costLeft - effects[0].pos[0]).toBeGreaterThan(20);
    // Right of every name.
    const nameRight = Math.max(...ends.map((id) => l.positions[id][0] + 34 + heuristicMeasure(l.labels.find((x) => x.id === `label_${id}`)!.text, l.textSize).w));
    expect(Math.min(...effects.map((d) => bboxOfText(d, heuristicMeasure).x))).toBeGreaterThan(nameRight);
  });

  test("each column is headed once, over its topmost terminal: the unit and Cost", () => {
    const l = layoutDecisionTree(structuredClone(CE));
    const t = texts(l);
    expect(t.get("payoff_head")!.text).toBe("QALYs");
    expect(t.get("cost_head")!.text).toBe("Cost");
    expect(t.get("payoff_head")!.pos[0]).toBe(t.get("effect_w_ok")!.pos[0]);
    expect(t.get("cost_head")!.pos[0]).toBe(t.get("cost_w_ok")!.pos[0]);
    const top = Math.max(...[...t.values()].filter((d) => d.id.startsWith("effect_")).map((d) => d.pos[1]));
    expect(t.get("payoff_head")!.pos[1]).toBeGreaterThan(top);
    // Under the card heading.
    expect(bboxOfText(t.get("payoff_head")!, heuristicMeasure).y + 25).toBeLessThanOrEqual(690);
  });

  test("payoff_<id> is the group of the terminal's two numbers; the node carries them", () => {
    const l = layoutDecisionTree(structuredClone(CE));
    expect(l.groups!.payoff_s_ok).toEqual(["effect_s_ok", "cost_s_ok"]);
    expect(l.attached!.node_s_ok).toEqual(expect.arrayContaining(["label_s_ok", "effect_s_ok", "cost_s_ok"]));
    // Groups are names, not elements: never in the natural order.
    expect(l.order).not.toContain("payoff_s_ok");
    expect(l.order.indexOf("payoff_head")).toBeLessThan(l.order.indexOf("effect_w_ok"));
  });

  test("the effect column's heading without a unit: Payoff for bare payoffs, Effect beside costs", () => {
    const noUnit = { ...structuredClone(CE), unit: undefined };
    expect(texts(layoutDecisionTree(noUnit)).get("payoff_head")!.text).toBe("Effect");
    const bare = structuredClone(manifest.examples[2].params) as unknown as DecisionTreeParams; // rollback, no costs
    const t = texts(layoutDecisionTree(bare));
    expect(t.get("payoff_head")!.text).toBe("Payoff");
    expect(t.has("cost_head")).toBe(false);
  });

  test("a tree of bare payoffs, not rolled back, keeps its numbers by their terminals, unheaded", () => {
    const l = layoutDecisionTree(structuredClone(manifest.examples[0].params) as unknown as DecisionTreeParams);
    expect(l.labels.find((x) => x.id === "effect_s_ok")?.text).toBe("9.5");
    expect(texts(l).has("payoff_head")).toBe(false);
    expect(l.drawnWith).toBeUndefined();
  });

  test("ends at several depths: each depth its own columns and headings, payoff_head names them all", () => {
    const l = layoutDecisionTree(knee({ size: "full", rollback: true, currency: "$" }, true));
    const heads = l.groups!.payoff_head;
    expect(heads.length).toBeGreaterThan(1);
    const t = texts(l);
    for (const h of heads) expect(t.get(h)!.text).toBe("Effect");
    // Within a depth, one right edge.
    const byDepth = new Map<number, Set<number>>();
    for (const d of t.values()) {
      if (!d.id.startsWith("effect_")) continue;
      const x = l.positions[d.id.slice("effect_".length)][0];
      byDepth.set(x, (byDepth.get(x) ?? new Set()).add(d.pos[0]));
    }
    expect(byDepth.size).toBeGreaterThan(1);
    for (const edges of byDepth.values()) expect(edges.size).toBe(1);
  });
});

describe("a heading comes with the first number of its column", () => {
  const planOf = (commands: unknown[]) => {
    const spec = specOf(structuredClone(CE), commands);
    const layout = layoutSpec(spec);
    return planCommands(spec.commands, layout.order, planOptionsFor(spec, layout));
  };
  const draws = (plan: ReturnType<typeof planCommands>) => plan.steps.filter((s) => s.kind === "draw" && !s.implicit).map((s) => (s as { ids: string[] }).ids);

  test("drawing a terminal's payoff_<id> draws its numbers, the headings first — once", () => {
    const [first, second] = draws(planOf([{ draw: ["payoff_m_bad"] }, { draw: ["payoff_s_ok"] }]));
    expect(first).toEqual(["payoff_head", "effect_m_bad", "cost_head", "cost_m_bad"]);
    expect(second).toEqual(["effect_s_ok", "cost_s_ok"]);
  });

  test("a single column's number brings only its own heading", () => {
    const [first, second] = draws(planOf([{ draw: ["effect_w_ok"] }, { draw: ["cost_w_ok"] }]));
    expect(first).toEqual(["payoff_head", "effect_w_ok"]);
    expect(second).toEqual(["cost_head", "cost_w_ok"]);
  });

  test("a heading drawn on its own is not drawn again", () => {
    const [, second] = draws(planOf([{ draw: ["payoff_head", "cost_head"] }, { draw: ["payoff_s_ok"] }]));
    expect(second).toEqual(["effect_s_ok", "cost_s_ok"]);
  });
});

describe("no overlap anywhere", () => {
  const bundled = [...(examples as { spec?: Spec }[]), ...(fewshots as { spec?: Spec }[])]
    .map((e) => e.spec)
    .filter((s): s is Spec => s?.template === "decision_tree")
    .map((s): [string, Spec] => [s.title ?? "", s]);
  const fromManifest = manifest.examples.map((e, i): [string, Spec] => [`manifest example ${i}`, specOf(e.params as unknown as DecisionTreeParams)]);
  const helpers: [string, Spec][] = [
    ["the knee tree", specOf(knee())],
    ["the knee tree with costs, rolled back", specOf(knee({ rollback: true, currency: "$", wtp: 30000, unit: "QALYs" }, true))],
    ["the knee tree with costs, rolled back, in a world", specOf(knee({ size: "full", rollback: true, currency: "$", wtp: 30000, unit: "QALYs" }, true))],
  ];
  test.each([...bundled, ...fromManifest, ...helpers])("%s: no overlap or out-of-canvas lint", (_name, spec) => {
    const issues = layoutSpec(structuredClone(spec)).issues.filter((i) => i.rule.startsWith("overlap") || i.rule === "out-of-canvas" || i.rule.startsWith("label"));
    expect(issues.map((i) => i.message)).toEqual([]);
  });
});
