import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

// Formula asks (design 2026-10-03 §5): an ask on a math element with \blank{…}.
const guessIssues = (spec: Spec) => lintCommands(expandSpec(spec)).filter((i) => i.rule === "guess");

const formula = (tex: string, ask: Record<string, unknown>, extra: Record<string, unknown> = {}): Spec =>
  ({
    elements: [{ id: "f", type: "math", tex, x: 500, y: 300 }],
    commands: [{ draw: ["f"] }, { ask: { question: "What goes in the box?", on: "f", ...ask } }],
    ...extra,
  }) as unknown as Spec;

describe("formula ask lint", () => {
  test("clean asks have no issues: tiles, a typed number, a typed expression", () => {
    expect(guessIssues(formula("A = \\pi \\blank{r^2}", { others: ["2r", "r", "d^2"], store: "f1" }))).toEqual([]);
    expect(guessIssues(formula("7 \\times \\blank{8} = 56", { store: "n" }))).toEqual([]);
    expect(guessIssues(formula("\\frac{d}{dx} x^2 = \\blank{2x}", {}))).toEqual([]);
    expect(guessIssues(formula("x + x = \\blank{2x}", { form: "exact" }))).toEqual([]);
  });

  test("a blank inside a live-math {var} is an error", () => {
    const issues = guessIssues(formula("A = \\pi \\blank{{r}^2}", {}, { vars: { r: { value: 2, min: 1, max: 5 } } }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/live/);
  });

  test("a symbolic blank that cannot be typed, with no others, is an error", () => {
    const issues = guessIssues(formula("S = \\blank{\\sum i}", {}));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/others/);
    // With tiles it is fine.
    expect(guessIssues(formula("S = \\blank{\\sum i}", { others: ["\\prod i"] }))).toEqual([]);
  });

  test("others holding the right answer warns: already a tile", () => {
    const issues = guessIssues(formula("A = \\pi \\blank{r^2}", { others: ["2r", "{r^2}", "r ^2"] }));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.every((i) => i.severity === "warn")).toBe(true);
    expect(issues[0].message).toMatch(/already a tile/);
  });

  test("a formula with a blank that no ask fills warns", () => {
    const spec = {
      elements: [{ id: "f", type: "math", tex: "A = \\pi \\blank{r^2}" }],
      commands: [{ draw: ["f"] }, { speak: "Here it is." }],
    } as unknown as Spec;
    const issues = guessIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/no ask fills/);
  });

  test("an ask on a formula without blanks warns: nothing to fill", () => {
    const issues = guessIssues(formula("A = \\pi r^2", {}));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/nothing to fill/);
  });

  test("a formula not drawn before the ask is an error", () => {
    const spec = {
      elements: [{ id: "f", type: "math", tex: "A = \\pi \\blank{r^2}" }],
      commands: [{ ask: { question: "?", on: "f" } }, { draw: ["f"] }],
    } as unknown as Spec;
    const issues = guessIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/not drawn before/);
  });

  test("others or form: exact on an ask that is not a formula ask warns", () => {
    const bars = (ask: Record<string, unknown>): Spec =>
      ({ template: "bar_chart", params: { labels: ["A", "B"], values: [1, 2] }, commands: [{ draw: ["axes", "bar_1"] }, { ask: { question: "B?", on: "bar_2", ...ask } }] }) as unknown as Spec;
    const o = guessIssues(bars({ others: ["3"] }));
    expect(o).toHaveLength(1);
    expect(o[0].severity).toBe("warn");
    expect(o[0].message).toMatch(/others/);
    const f = guessIssues(bars({ form: "exact" }));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("warn");
    expect(f[0].message).toMatch(/form/);
  });

  test("schema: a formula ask needs no default with store; right, wrong and tolerance are allowed", () => {
    const r = validateSpec(formula("7 \\times \\blank{8} = 56", { store: "n", right: "Yes.", wrong: "It is {n.true}.", tolerance: 0.01 }));
    expect(r.errors).toEqual([]);
    const t = validateSpec(formula("A = \\pi \\blank{r^2}", { others: ["2r"], store: "a", right: "Yes." }));
    expect(t.errors).toEqual([]);
  });
});
