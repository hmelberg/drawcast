import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";

describe("label and goto planning", () => {
  test("labels map to their step index, backward and forward", () => {
    const plan = planCommands(
      [
        { label: "start" },
        { speak: "One." },
        { quiz: { question: "Q?", choices: ["x", "y"], correct: 1, wrong_goto: "start", right_goto: "the_end" } },
        { speak: "Two." },
        { label: "the_end" },
      ],
      [],
    );
    expect(plan.labels).toEqual({ start: 0, the_end: 4 });
    expect(plan.steps[0].kind).toBe("label");
    expect(plan.steps[4].kind).toBe("label");
  });

  test("quiz and ask steps carry the goto names", () => {
    const plan = planCommands(
      [
        { label: "l" },
        { quiz: { question: "Q?", choices: ["x", "y"], correct: 1, wrong_goto: "l" } },
        { ask: { question: "Gold?", answer: "Au", right_goto: "l" } },
      ],
      [],
    );
    const q = plan.steps[1];
    if (q.kind !== "quiz") throw new Error("not a quiz step");
    expect(q.wrongGoto).toBe("l");
    expect(q.rightGoto).toBeUndefined();
    const a = plan.steps[2];
    if (a.kind !== "ask") throw new Error("not an ask step");
    expect(a.rightGoto).toBe("l");
  });
});
