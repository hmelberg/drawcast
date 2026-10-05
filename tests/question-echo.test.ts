// Say the question once (Hans 2026-10-05, ants-on-earth): the ask's question
// split into what it asks and the task, and whether it restates the heading
// or the line just spoken.
import { describe, expect, test } from "vitest";
import { restates, splitQuestion, taskBeside } from "../src/spec/question-echo";

describe("splitQuestion", () => {
  test("the question sentence, then the task", () => {
    expect(splitQuestion("How many ants live on Earth? Click on the line: each step is ten times the last.")).toEqual({
      question: "How many ants live on Earth?",
      task: "Click on the line: each step is ten times the last.",
    });
  });
  test("a question alone has no task", () => {
    expect(splitQuestion("How many ants live on Earth?")).toEqual({ question: "How many ants live on Earth?", task: "" });
  });
  test("no question mark: all task", () => {
    expect(splitQuestion("Click on the line where you think it is.")).toEqual({ question: "", task: "Click on the line where you think it is." });
  });
  test("only the first question goes in the question part", () => {
    expect(splitQuestion("Which is bigger? A or B? Tap one.").task).toBe("A or B? Tap one.");
  });
});

describe("restates", () => {
  test("the ants heading, said a little differently", () => {
    expect(restates("How many ants live on Earth? Click on the line.", "How many ants are on Earth?")).toBe(true);
    expect(restates("How many ants live on Earth?", "How many ants are alive on Earth right now?")).toBe(true);
  });
  test("a short question restates a short heading", () => {
    expect(restates("How many ants?", "Ants on Earth")).toBe(true);
  });
  test("a different question does not", () => {
    expect(restates("How much do they weigh?", "How many ants are on Earth?")).toBe(false);
    expect(restates("Which ant species is the largest?", "Ants")).toBe(false);
    expect(restates("How many ants?", "Ants live in gardens, forests, deserts and cities across every continent.")).toBe(false);
  });
  test("a new claim under a heading that names its topic does not", () => {
    expect(restates("On the Moon you would weigh about a sixth as much. True or myth?", "True or myth? Three things about the Moon")).toBe(false);
  });
  test("nothing to restate", () => {
    expect(restates("How many ants?", undefined)).toBe(false);
    expect(restates("How many ants?", "")).toBe(false);
    expect(restates("Click on the line.", "How many ants are on Earth?")).toBe(false);
  });
  test("Norwegian", () => {
    expect(restates("Hvor mange maur lever på jorden? Klikk på linjen.", "Hvor mange maur finnes på jorden?")).toBe(true);
    expect(restates("Hvor mye veier maurene?", "Hvor mange maur finnes på jorden?")).toBe(false);
    expect(restates("Hvor mange maur er det?", "Maurene")).toBe(true);
  });
});

describe("taskBeside", () => {
  const heading = "How many ants are on Earth?";
  test("restates the heading: only the task", () => {
    expect(taskBeside("How many ants live on Earth? Click on the line: each step is ten times the last.", heading)).toBe("Click on the line: each step is ten times the last.");
    expect(taskBeside("How many ants live on Earth?", heading)).toBe("");
  });
  test("restates the line spoken before: only the task", () => {
    expect(taskBeside("How many ants live on Earth? Click.", "Ants", "How many ants are alive on Earth right now?")).toBe("Click.");
  });
  test("a different question stands whole", () => {
    expect(taskBeside("How much do all the ants weigh? Drag the bar.", heading, "First, a count.")).toBeNull();
  });
  test("a task-only question is all task", () => {
    expect(taskBeside("Click on the line where you think it is.", heading)).toBe("Click on the line where you think it is.");
    expect(taskBeside("Click on the line where you think it is.")).toBe("Click on the line where you think it is.");
  });
});
