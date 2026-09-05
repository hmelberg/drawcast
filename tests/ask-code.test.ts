// The ask verb's code widget: what the viewer's run ANSWERS, how the plan
// carries the question, and the two ways an author can make it unanswerable.
// The card itself (Check, Skip, the status line) is the live smoke's, like
// every other gate in ui/.

import { describe, expect, test } from "vitest";
import { askPaths, checkedAnswer, formatAnswer } from "../src/code/ask-check";
import { answersMatch } from "../src/spec/answers";
import { lintCommands } from "../src/lint/lint";
import { planCommands } from "../src/render/plan";
import type { CodeRunResult } from "../src/code/envelope";
import type { Spec } from "../src/spec/types";

const env = (over: Partial<CodeRunResult> = {}): CodeRunResult => ({ ok: true, stdout: "", stderr: "", figures: [], ...over });

describe("what a run answers", () => {
  test("stdout is the default, and an empty one is not an answer", () => {
    expect(askPaths(undefined)).toEqual([]);
    expect(checkedAnswer(env({ stdout: "45\n" }), undefined)).toEqual({ text: "45" });
    expect(checkedAnswer(env(), "stdout").text).toBeNull();
    expect(checkedAnswer(env(), "stdout").note).toMatch(/print/i);
  });

  test("a variable is harvested through the data bridge's own paths", () => {
    expect(askPaths("total")).toEqual(["total"]);
    expect(checkedAnswer(env({ data: { total: 45 } }), "total")).toEqual({ text: "45" });
    // …and one the script never left behind is unfinished, not wrong.
    expect(checkedAnswer(env({ data: {} }), "total").text).toBeNull();
    expect(checkedAnswer(env({ dataErrors: { total: "not a number" } }), "total").note).toMatch(/not a number/);
  });

  test("a figure answers 1 or 0", () => {
    expect(askPaths("figure")).toEqual([]);
    expect(checkedAnswer(env({ figures: [{ href: "data:,", w: 2, h: 2 }] }), "figure")).toEqual({ text: "1" });
    expect(checkedAnswer(env(), "figure")).toEqual({ text: "0" });
  });

  test("a script that failed spends no attempt", () => {
    const v = checkedAnswer(env({ ok: false, error: "NameError" }), "total");
    expect(v.text).toBeNull();
    expect(v.note).toMatch(/did not run/);
  });

  test("values read back the way an author would have typed them", () => {
    expect(formatAnswer(45)).toBe("45");
    expect(formatAnswer(45.0)).toBe("45");
    expect(formatAnswer(0.1 + 0.2)).toBe("0.3"); // 12 significant digits, not 0.30000000000000004
    expect(formatAnswer("Oslo")).toBe("Oslo");
    expect(formatAnswer([1, 2])).toBe("[1,2]");
    expect(formatAnswer(undefined)).toBe("");
  });

  test("numbers are compared as numbers — a harvest must not fail on formatting", () => {
    expect(answersMatch("45", "45.0")).toBe(true);
    expect(answersMatch("4.5e1", "45")).toBe(true);
    expect(answersMatch("45", "46")).toBe(false);
    // Text is still the old forgiving match, and a number never equals a word.
    expect(answersMatch(" Oslo ", "oslo")).toBe(true);
    expect(answersMatch("45", "forty-five")).toBe(false);
  });
});

const spec = (ask: object, el: object = {}): Spec =>
  ({
    elements: [{ id: "task", type: "code", language: "python", show: "left", code: "# your turn", ...el }],
    commands: [{ draw: ["task"] }, { ask: { question: "Sum 0 to 9 into total.", answer: "45", ...ask } }],
  }) as unknown as Spec;

describe("the question the plan carries", () => {
  const planOf = (s: Spec) => planCommands(s.commands, ["task", "task_line_1"], {});

  test("naming a code element IS the code widget", () => {
    const step = planOf(spec({ code: "task", expect: "total" })).steps.find((s) => s.kind === "ask")!;
    expect(step).toMatchObject({ kind: "ask", widget: "code", codeId: "task", expect: "total", answer: "45" });
  });

  test("without it nothing changes — a typed ask stays a typed ask", () => {
    const step = planOf(spec({})).steps.find((s) => s.kind === "ask")!;
    expect("widget" in step).toBe(false);
    expect("codeId" in step).toBe(false);
  });

  test("the movie's laser gets the panel to point at", () => {
    const s = spec({ code: "task" });
    const plan = planCommands(s.commands, ["task"], { bboxOf: (id) => (id === "task" ? { x: 10, y: 20, w: 300, h: 200 } : null) });
    const step = plan.steps.find((st) => st.kind === "ask")!;
    expect(step.answerBox).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });
});

describe("a question the viewer could not answer is caught at authoring time", () => {
  test("an id that is not a code element", () => {
    const issues = lintCommands(spec({ code: "nope" }));
    expect(issues.some((i) => i.message.includes('ask code: "nope" is not a code element'))).toBe(true);
  });

  test("a panel with no code pane to write on", () => {
    for (const show of ["output", "none"]) {
      const issues = lintCommands(spec({ code: "task" }, { show }));
      expect(issues.some((i) => i.message.includes("shows no code pane to write in")), show).toBe(true);
    }
    expect(lintCommands(spec({ code: "task" }, { show: "code" })).some((i) => i.message.includes("no code pane"))).toBe(false);
  });
});
