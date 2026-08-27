import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const spec = (commands: object[]) => ({
  elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
  commands,
});

describe("label and goto validation", () => {
  test("a label command and a quiz wrong_goto to it pass", () => {
    const r = validateSpec(
      spec([
        { label: "recap" },
        { draw: ["a"] },
        { quiz: { question: "Q?", choices: ["x", "y"], correct: 1, wrong_goto: "recap" } },
      ]),
    );
    expect(r.ok).toBe(true);
  });

  test("an ask right_goto to a forward label passes", () => {
    const r = validateSpec(
      spec([
        { ask: { question: "Gold?", answer: "Au", right_goto: "the_end" } },
        { draw: ["a"] },
        { label: "the_end" },
      ]),
    );
    expect(r.ok).toBe(true);
  });

  test("a goto to an unknown label fails", () => {
    const r = validateSpec(spec([{ quiz: { question: "Q?", choices: ["x", "y"], correct: 1, wrong_goto: "nowhere" } }]));
    expect(r.ok).toBe(false);
  });

  test("duplicate labels fail", () => {
    const r = validateSpec(spec([{ label: "here" }, { draw: ["a"] }, { label: "here" }]));
    expect(r.ok).toBe(false);
  });

  test("a bad label name fails", () => {
    expect(validateSpec(spec([{ label: "no spaces!" }])).ok).toBe(false);
  });

  test("retry and wrong_goto together fail", () => {
    const r = validateSpec(
      spec([{ label: "l" }, { ask: { question: "Gold?", answer: "Au", retry: true, wrong_goto: "l" } }]),
    );
    expect(r.ok).toBe(false);
  });

  test("label counts as an action verb — combining it with draw fails", () => {
    expect(validateSpec(spec([{ label: "l", draw: ["a"] }])).ok).toBe(false);
  });
});
