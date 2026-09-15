import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const OK = JSON.stringify({ ok: true, stdout: "", stderr: "", figures: [] });
const base = (commands: unknown[]): Spec =>
  ({
    elements: [
      { id: "sim", type: "code", language: "python", show: "left", pane: "controls", controls: ["beta", "model"], code: 'beta = (0.1, 1.0, 0.05)\nmodel = ["SIR", "SEIR"]', code_result: OK },
      { id: "plain", type: "code", language: "python", show: "left", code: "print(1)", code_result: OK },
      { id: "box", type: "node", label: "x" },
    ],
    commands,
  }) as unknown as Spec;
const runIssues = (commands: unknown[]) => lintCommands(base(commands)).filter((i) => i.rule === "run");

describe("lint: run", () => {
  test("a good run passes", () => {
    expect(runIssues([{ run: { code: "sim", values: { beta: { from: 0.1, to: 0.9, steps: 5 } } } }])).toEqual([]);
  });
  test("unknown code id, a non-code element, a script without controls", () => {
    expect(runIssues([{ run: { code: "nope", values: { beta: 1 } } }])[0].message).toMatch(/nope/);
    expect(runIssues([{ run: { code: "box", values: { beta: 1 } } }])[0].message).toMatch(/box/);
    expect(runIssues([{ run: { code: "plain", values: { beta: 1 } } }])[0].message).toMatch(/controls/);
  });
  test("the model's issues surface as errors: unknown name, bad choice, 21 steps", () => {
    expect(runIssues([{ run: { code: "sim", values: { gamma: 1 } } }])[0]).toMatchObject({ severity: "error" });
    expect(runIssues([{ run: { code: "sim", values: { model: ["SIRS"] } } }])[0].message).toMatch(/SIRS/);
    expect(runIssues([{ run: { code: "sim", values: { beta: { from: 0.1, to: 0.9, steps: 21 } } } }])[0].message).toMatch(/20/);
  });
  test("explore.play is checked the same way; play: false and a plain explore pass", () => {
    expect(runIssues([{ explore: { code: "sim", play: { values: { gamma: 1 } } } }])[0].message).toMatch(/explore\.play/);
    expect(runIssues([{ explore: { code: "sim", play: false } }])).toEqual([]);
    expect(runIssues([{ explore: { code: "sim" } }])).toEqual([]);
  });
  test("the invitation law is gone: an ordinary speak may invite", () => {
    const all = lintCommands(base([{ speak: "Now slide the rate and watch." }]));
    expect(all.some((i) => (i.rule as string) === "explore-invite")).toBe(false);
  });
});
