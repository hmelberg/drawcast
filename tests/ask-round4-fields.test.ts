// tests/ask-round4-fields.test.ts
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { parseScript, printScript } from "../src/spec/script";

describe("round 4 ask fields", () => {
  test("validate", () => {
    const spec = {
      commands: [
        { ask: { question: "EV?", blanks: ["value_treat"], pick: "start", work: "all", store: "e", default: "0" } },
        { ask: { question: "Box?", on: "area", others: ["r", "2r"], form: "exact" } },
        { ask: { question: "Tax?", on: "supply_curve", predict: true, check: "size" } },
      ],
      elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}", fills: [null], x: 100, y: 100 }],
    };
    expect(validateSpec(spec as never).ok).toBe(true);
  });

  test("the script format round-trips them", () => {
    const spec = { commands: [{ ask: { question: "EV?", blanks: ["value_treat"], pick: "start", work: false, check: "size", others: ["r"], form: "exact", on: "x" } }] };
    expect(parseScript(printScript(spec as never)).commands).toEqual(spec.commands);
  });

  test("bad values are rejected", () => {
    const bad = { commands: [{ ask: { question: "x", check: "nearly" } }] };
    expect(validateSpec(bad as never).ok).toBe(false);
  });

  test("plan: a tree ask carries its blanks and pick", () => {
    const plan = planCommands([{ ask: { question: "EV?", blanks: ["value_treat"], pick: "start" } }] as never, ["value_treat"], {});
    const step = plan.steps[0] as { kind: string; tree?: { blanks: string[]; pick?: string } };
    expect(step.tree).toEqual({ blanks: ["value_treat"], pick: "start" });
  });

  test("plan: a formula ask names its element", () => {
    const plan = planCommands([{ ask: { question: "Box?", on: "area", others: ["r"] } }] as never, ["area"], { formulaFor: (id: string) => (id === "area" ? { blanks: 1 } : null) } as never);
    const step = plan.steps[0] as { formula?: string; others?: string[] };
    expect(step.formula).toBe("area");
    expect(step.others).toEqual(["r"]);
  });
});
