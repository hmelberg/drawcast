import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const base = (quiz: object) => ({
  elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
  commands: [{ draw: ["a"] }, { quiz }],
});

describe("quiz validation", () => {
  test("a well-formed quiz passes", () => {
    expect(
      validateSpec(base({ question: "Which?", choices: ["one", "two"], correct: 2, right: "Yes.", wrong: "No.", required: true })).ok,
    ).toBe(true);
  });

  test("correct out of range fails", () => {
    expect(validateSpec(base({ question: "Which?", choices: ["one", "two"], correct: 3 })).ok).toBe(false);
    expect(validateSpec(base({ question: "Which?", choices: ["one", "two"], correct: 0 })).ok).toBe(false);
  });

  test("fewer than two choices fails", () => {
    expect(validateSpec(base({ question: "Which?", choices: ["only"], correct: 1 })).ok).toBe(false);
  });

  test("an empty question fails", () => {
    expect(validateSpec(base({ question: "  ", choices: ["one", "two"], correct: 1 })).ok).toBe(false);
  });

  test("quiz counts as an action verb — combining it with draw fails", () => {
    const r = validateSpec({
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [{ draw: ["a"], quiz: { question: "Q?", choices: ["x", "y"], correct: 1 } }],
    });
    expect(r.ok).toBe(false);
  });

  test("quiz paired with speak is allowed (speak overrides the spoken question)", () => {
    const withSpeak = base({ question: "Which?", choices: ["one", "two"], correct: 1 });
    (withSpeak.commands[1] as Record<string, unknown>).speak = "Here is a question for you.";
    expect(validateSpec(withSpeak).ok).toBe(true);
  });
});
