import { describe, expect, test } from "vitest";
import { quizDemoAt, quizDemoDuration, askDemoAt, askDemoDuration } from "../src/export/demo";

describe("quiz demo timeline", () => {
  test("appear phase hovers nothing", () => {
    expect(quizDemoAt(100, 3, 2)).toEqual({ hover: null, selected: false, done: false });
  });

  test("the walk hovers every choice in order and ends on the correct one", () => {
    // after appear (400) + hold (900), 500ms per choice
    expect(quizDemoAt(400 + 900 + 250, 3, 2).hover).toBe(0);
    expect(quizDemoAt(400 + 900 + 750, 3, 2).hover).toBe(1);
    const late = quizDemoAt(400 + 900 + 1250, 3, 2);
    expect(late.hover).toBe(2);
  });

  test("after the walk, the correct choice is selected and the demo completes", () => {
    const d = quizDemoDuration(3);
    const end = quizDemoAt(d, 3, 1);
    expect(end.selected).toBe(true);
    expect(end.hover).toBe(1);
    expect(end.done).toBe(true);
  });

  test("duration grows with choice count", () => {
    expect(quizDemoDuration(4)).toBeGreaterThan(quizDemoDuration(2));
  });
});

describe("ask demo timeline", () => {
  test("appear phase has typed nothing", () => {
    expect(askDemoAt(100, "Au")).toEqual({ typedChars: 0, done: false });
  });

  test("typing advances one character at a time", () => {
    const start = 400 + 900;
    expect(askDemoAt(start + 80, "Au").typedChars).toBe(1);
    expect(askDemoAt(start + 160, "Au").typedChars).toBe(2);
  });

  test("at full duration the text is complete and done", () => {
    const d = askDemoDuration("Au");
    expect(askDemoAt(d, "Au")).toEqual({ typedChars: 2, done: true });
  });

  test("duration grows with text length", () => {
    expect(askDemoDuration("a long answer")).toBeGreaterThan(askDemoDuration("Au"));
  });
});
