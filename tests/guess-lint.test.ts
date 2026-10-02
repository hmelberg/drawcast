import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const guessIssues = (spec: Spec) => lintCommands(expandSpec(spec)).filter((i) => i.rule === "guess");

const bars = (commands: Spec["commands"], params: Record<string, unknown> = {}): Spec =>
  ({ template: "bar_chart", params: { labels: ["A", "B"], values: [1, 2], ...params }, commands }) as Spec;

describe("guess lint", () => {
  test("a fair guess is clean", () => {
    expect(guessIssues(bars([{ draw: ["axes", "bar_1"] }, { ask: { question: "B?", on: "bar_2" } }]))).toEqual([]);
  });

  test("the guessed bar drawn before the question warns", () => {
    const issues = guessIssues(bars([{ draw: ["axes", "bar_1", "bar_2"] }, { ask: { question: "B?", on: "bar_2" } }]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/already drawn/);
  });

  test("keep: clean on a guess, a warning on an ask with no guess marks to keep", () => {
    expect(guessIssues(bars([{ draw: ["axes", "bar_1"] }, { ask: { question: "B?", on: "bar_2", keep: true } }]))).toEqual([]);
    const typed = guessIssues(bars([{ ask: { question: "Why?", store: "w", default: "x", keep: true } }]));
    expect(typed).toHaveLength(1);
    expect(typed[0].severity).toBe("warn");
    expect(typed[0].message).toMatch(/keep/);
    const cards = guessIssues({
      elements: [{ id: "c", type: "cards", items: [{ text: "A" }, { text: "B" }] }],
      commands: [{ draw: ["c"] }, { ask: { question: "Rank", on: "c", keep: true } }],
    } as unknown as Spec);
    expect(cards.some((i) => /keep/.test(i.message))).toBe(true);
  });

  test("reveal_style and reveal_order: clean on a guess, a warning where there is no reveal on the figure", () => {
    expect(guessIssues(bars([{ draw: ["axes", "bar_1"] }, { ask: { question: "B?", on: "bar_2", reveal_style: "morph", reveal_order: "each" } }]))).toEqual([]);
    const typed = guessIssues(bars([{ ask: { question: "Why?", store: "w", default: "x", reveal_order: "each" } }]));
    expect(typed).toHaveLength(1);
    expect(typed[0].severity).toBe("warn");
    expect(typed[0].message).toMatch(/reveal_order/);
  });

  test("grouped bars are an error", () => {
    const issues = guessIssues(bars([{ ask: { question: "B?", on: "bar_1" } }], { series: [{ values: [1, 2] }, { values: [3, 4] }] }));
    expect(issues[0].severity).toBe("error");
  });

  test("an unknown part is an error", () => {
    expect(guessIssues(bars([{ ask: { question: "?", on: "wiggle" } }]))[0].severity).toBe("error");
  });

  test("a scale's marker drawn before the question warns; its line may be drawn", () => {
    const spec = {
      elements: [{ id: "born", type: "scale", min: 1700, max: 1800, value: 1756 }],
      commands: [{ draw: ["born"] }, { ask: { question: "When?", on: "born" } }],
    } as unknown as Spec;
    expect(guessIssues(spec)).toEqual([]);
    const shown = { ...spec, commands: [{ draw: ["born", "born_answer"] }, { ask: { question: "When?", on: "born" } }] } as unknown as Spec;
    expect(guessIssues(shown)).toHaveLength(1);
  });

  test("a population state guess", () => {
    const spec = {
      elements: [{ id: "crowd", type: "population", count: 100, states: { healthy: 90, sick: 10 } }],
      commands: [{ ask: { question: "How many?", on: "crowd_sick" } }],
    } as unknown as Spec;
    expect(guessIssues(spec)).toEqual([]);
  });

  test("predict needs an animate next; its part may be drawn", () => {
    const ok = guessIssues(bars([{ draw: ["axes", "bar_1", "bar_2"] }, { ask: { question: "Where?", on: "bar_2", predict: true } }, { animate: { stage: 1 } }]));
    expect(ok).toEqual([]);
    const missing = guessIssues(bars([{ draw: ["axes"] }, { ask: { question: "Where?", on: "bar_2", predict: true } }, { speak: "x" }]));
    expect(missing.some((i) => /animate right after/.test(i.message))).toBe(true);
  });

  test("revise needs an earlier kept-back guess", () => {
    const ok = guessIssues(bars([{ ask: { question: "1?", on: "bar_2", store: "g1", reveal: false } }, { ask: { question: "2?", on: "bar_2", revise: "g1" } }]));
    expect(ok).toEqual([]);
    const bad = guessIssues(bars([{ ask: { question: "2?", on: "bar_2", revise: "g1" } }]));
    expect(bad.some((i) => /reveal: false/.test(i.message))).toBe(true);
  });
});

describe("market guess lint (spec 2026-10-03 §3)", () => {
  const market = (commands: Spec["commands"], tax: Record<string, unknown> = { amount: 0, side: "seller", kind: "ad_valorem" }): Spec =>
    ({ template: "supply_demand", params: { demand: { steepness: "medium" }, supply: { steepness: "medium" }, tax }, commands }) as Spec;
  const allIssues = (spec: Spec) => lintCommands(expandSpec(spec));

  test("a predict on the curve the animate moves is clean", () => {
    const spec = market([{ draw: ["supply_curve", "demand_curve"] }, { ask: { question: "Show it", on: "supply_curve", predict: true, check: "shape" } }, { animate: { "tax.amount": 20 } }]);
    expect(guessIssues(spec)).toEqual([]);
    expect(allIssues(spec).filter((i) => i.rule === "widget")).toEqual([]);
  });

  test("an animate that does not move the asked curve errors (review focus 4)", () => {
    const issues = guessIssues(market([{ draw: ["supply_curve", "demand_curve"] }, { ask: { question: "Show it", on: "demand_curve", predict: true } }, { animate: { "tax.amount": 20 } }]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/does not move demand_curve/);
  });

  test("a market guess without predict errors", () => {
    const issues = guessIssues(market([{ ask: { question: "Show it", on: "supply_curve" } }]));
    expect(issues.some((i) => i.severity === "error" && /predict/.test(i.message))).toBe(true);
  });

  test("both curves in one question is an error (one curve per question)", () => {
    const issues = guessIssues(market([{ ask: { question: "Show them", on: ["supply_curve", "demand_curve"], predict: true } }, { animate: { "tax.amount": 20 } }]));
    expect(issues.some((i) => i.severity === "error" && /one curve per question/.test(i.message))).toBe(true);
  });

  test("check on a bar guess warns", () => {
    const issues = guessIssues(bars([{ draw: ["axes", "bar_1"] }, { ask: { question: "B?", on: "bar_2", check: "size" } }]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/check/);
  });
});
