import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

describe("typed ask planning", () => {
  test("check-mode defaults: reveal true, retry false, narration = question", () => {
    const plan = planCommands([{ ask: { question: "Symbol for gold?", answer: "Au" } }], []);
    expect(plan.steps).toHaveLength(1);
    const s = plan.steps[0];
    expect(s.kind).toBe("ask");
    if (s.kind !== "ask") return;
    expect(s.answer).toBe("Au");
    expect(s.reveal).toBe(true);
    expect(s.retry).toBe(false);
    expect(s.required).toBe(false);
    expect(s.narration).toBe("Symbol for gold?");
  });

  test("collect-mode carries store and fallback", () => {
    const plan = planCommands([{ ask: { question: "Name?", store: "name", default: "friend" } }], []);
    const s = plan.steps[0];
    if (s.kind !== "ask") throw new Error("not an ask step");
    expect(s.store).toBe("name");
    expect(s.fallback).toBe("friend");
    expect(s.answer).toBeUndefined();
  });

  test("lint warns when {var} is used before any ask stores it", () => {
    const spec = {
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [
        { draw: ["a"], speak: "Hello {name}!" },
        { ask: { question: "Name?", store: "name", default: "friend" } },
      ],
    } as unknown as Spec;
    const issues = lintCommands(spec).filter((i) => i.rule === "ask-var");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
  });

  test("lint stays quiet when the store comes first", () => {
    const spec = {
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [
        { ask: { question: "Name?", store: "name", default: "friend" } },
        { draw: ["a"], speak: "Hello {name}!" },
      ],
    } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "ask-var")).toEqual([]);
  });

  test("explicit reveal false and retry true carry through; paired speak overrides narration", () => {
    const plan = planCommands(
      [{ ask: { question: "Q?", answer: "x", reveal: false, retry: true }, speak: "A question now." }],
      [],
    );
    const s = plan.steps[0];
    if (s.kind !== "ask") throw new Error("not an ask step");
    expect(s.reveal).toBe(false);
    expect(s.retry).toBe(true);
    expect(s.narration).toBe("A question now.");
  });
});
