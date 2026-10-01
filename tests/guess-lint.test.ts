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
    const shown = { ...spec, commands: [{ draw: ["born", "born_value"] }, { ask: { question: "When?", on: "born" } }] } as unknown as Spec;
    expect(guessIssues(shown)).toHaveLength(1);
  });

  test("a population state guess", () => {
    const spec = {
      elements: [{ id: "crowd", type: "population", count: 100, states: { healthy: 90, sick: 10 } }],
      commands: [{ ask: { question: "How many?", on: "crowd_sick" } }],
    } as unknown as Spec;
    expect(guessIssues(spec)).toEqual([]);
  });
});
