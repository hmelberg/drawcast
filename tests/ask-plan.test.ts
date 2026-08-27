import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const ASK = { question: "Which?", choices: ["one", "two", "three"], correct: 3, right: "Yes.", wrong: "No." };

describe("ask planning", () => {
  test("translates to an ask step with a 0-based correct index", () => {
    const plan = planCommands([{ ask: ASK }], []);
    expect(plan.steps).toHaveLength(1);
    const s = plan.steps[0];
    expect(s.kind).toBe("ask");
    if (s.kind !== "ask") return;
    expect(s.correct).toBe(2);
    expect(s.choices).toEqual(["one", "two", "three"]);
    expect(s.right).toBe("Yes.");
    expect(s.wrong).toBe("No.");
    expect(s.required).toBe(false);
  });

  test("required carries through", () => {
    const plan = planCommands([{ ask: { ...ASK, required: true } }], []);
    const s = plan.steps[0];
    if (s.kind === "ask") expect(s.required).toBe(true);
  });

  test("the question becomes the narration when no speak is paired", () => {
    const plan = planCommands([{ ask: ASK }], []);
    expect(plan.steps[0].narration).toBe("Which?");
  });

  test("a paired speak overrides the spoken question", () => {
    const plan = planCommands([{ ask: ASK, speak: "Time for a question." }], []);
    expect(plan.steps[0].narration).toBe("Time for a question.");
  });
});

describe("ask and lint", () => {
  test("a speak paired with ask is not a standalone narration line", () => {
    const spec = {
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [
        { speak: "Opening line.", blocking: false },
        { speak: "Second line before ink.", ask: { question: "Q?", choices: ["x", "y"], correct: 1 } },
        { draw: ["a"] },
      ],
    } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "slow-start")).toEqual([]);
  });
});
