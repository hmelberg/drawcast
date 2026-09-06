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

  test("intro prepends to the spoken question", () => {
    const plan = planCommands([{ ask: { question: "Gold?", answer: "Au", intro: "A quick check!" } }], []);
    expect(plan.steps[0].narration).toBe("A quick check! Gold?");
  });

  test("intro prepends to a paired speak too", () => {
    const plan = planCommands([{ ask: { question: "Gold?", answer: "Au", intro: "A quick check!" }, speak: "Here it comes." }], []);
    expect(plan.steps[0].narration).toBe("A quick check! Here it comes.");
  });

  test("quiz intro prepends the same way", () => {
    const plan = planCommands([{ quiz: { question: "Which?", choices: ["a", "b"], correct: 1, intro: "Test time!" } }], []);
    expect(plan.steps[0].narration).toBe("Test time! Which?");
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

  test("a speak paired with a typed ask or a label is not a standalone narration line", () => {
    const spec = {
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [
        { speak: "Opening line.", blocking: false },
        { speak: "Second line.", ask: { question: "Q?", answer: "x" } },
        { speak: "Third line.", label: "here" },
        { draw: ["a"] },
      ],
    } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "slow-start")).toEqual([]);
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

// The drag widget: items become targets with boxes, the answer is implied,
// and the element items are visible once the question ends (the reveal).
describe("the drag widget is planned", () => {
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    heart: { x: 10, y: 10, w: 20, h: 20 },
    liver: { x: 40, y: 10, w: 30, h: 20 },
  };
  const plan = (items: (string | { id: string; label?: string })[], extra: Record<string, unknown> = {}) =>
    planCommands(
      [{ draw: ["body"] }, { ask: { question: "Place.", widget: "drag", items, right: "R.", ...extra } } as never],
      ["body", "heart", "liver"],
      { bboxOf: (id) => boxes[id] ?? null },
    );

  test("items normalised, answer implied, boxes gathered, elements marked", () => {
    const p = plan(["heart", { id: "liver", label: "The liver" }]);
    const s = p.steps[1];
    if (s.kind !== "ask") throw new Error("not an ask");
    expect(s.widget).toBe("drag");
    expect(s.items).toEqual([
      { id: "heart", label: "Heart", element: true },
      { id: "liver", label: "The liver", element: true },
    ]);
    expect(s.answer).toBe("heart,liver");
    expect(s.tolerance).toBe(0.25);
    expect(s.answerBoxes).toEqual([boxes.heart, boxes.liver]);
    expect(s.answerBox).toEqual(boxes.heart);
    expect(p.warnings).toEqual([]);
  });

  test("the element items are visible after the step (the reveal), and not drawn again at the end", () => {
    const p = plan(["heart"]);
    expect(p.states[0].visible).toEqual(["body"]);
    expect(p.states[1].visible).toEqual(["body", "heart"]);
    const drawn = p.steps.flatMap((s) => (s.kind === "draw" ? s.ids : []));
    expect(drawn).not.toContain("heart"); // shown by the question, never drawn twice
    expect(drawn).toContain("liver"); // never mentioned: the implicit final draw takes it
  });

  test("a note on a piano figure is a target without being an element", () => {
    const p = planCommands([{ ask: { question: "Find C.", widget: "drag", items: [{ id: "C4", label: "C" }], right: "R." } } as never], [], { animateBase: { octaves: 1 } });
    const s = p.steps[0];
    if (s.kind !== "ask") throw new Error("not an ask");
    expect(s.items).toEqual([{ id: "C4", label: "C", element: false }]);
    expect(s.answerBoxes?.length).toBe(1);
    expect(p.states[0].visible).toEqual([]);
  });

  test("an item nothing locates is skipped with a warning", () => {
    const p = plan(["heart", "spleen"]);
    const s = p.steps[1];
    if (s.kind !== "ask") throw new Error("not an ask");
    expect(s.items?.map((i) => i.id)).toEqual(["heart"]);
    expect(s.answer).toBe("heart");
    expect(p.warnings.join()).toMatch(/spleen/);
  });

  test("tolerance is carried", () => {
    const s = plan(["heart"], { tolerance: 0 }).steps[1];
    if (s.kind !== "ask") throw new Error("not an ask");
    expect(s.tolerance).toBe(0);
  });
});
