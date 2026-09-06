import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { answersMatch, subVars } from "../src/spec/answers";

const base = (ask: object) => ({
  elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
  commands: [{ draw: ["a"] }, { ask }],
});

describe("typed ask validation", () => {
  test("a check-mode ask passes", () => {
    expect(validateSpec(base({ question: "Symbol for gold?", answer: "Au", right: "Yes.", wrong: "No.", retry: true })).ok).toBe(true);
  });

  test("a collect-mode ask (store + default) passes", () => {
    expect(validateSpec(base({ question: "What is your name?", store: "name", default: "friend" })).ok).toBe(true);
  });

  test("check + collect combined passes", () => {
    expect(validateSpec(base({ question: "Your age?", answer: "42", store: "age", default: "30" })).ok).toBe(true);
  });

  test("neither answer nor store fails", () => {
    expect(validateSpec(base({ question: "Hm?" })).ok).toBe(false);
  });

  test("store without default fails", () => {
    expect(validateSpec(base({ question: "Name?", store: "name" })).ok).toBe(false);
  });

  test("a bad store name fails", () => {
    expect(validateSpec(base({ question: "Name?", store: "your name!", default: "x" })).ok).toBe(false);
  });

  test("retry, reveal, right, and wrong require answer", () => {
    expect(validateSpec(base({ question: "Name?", store: "name", default: "x", retry: true })).ok).toBe(false);
    expect(validateSpec(base({ question: "Name?", store: "name", default: "x", reveal: false })).ok).toBe(false);
    expect(validateSpec(base({ question: "Name?", store: "name", default: "x", wrong: "No." })).ok).toBe(false);
  });

  test("ask counts as an action verb — combining it with draw fails", () => {
    const r = validateSpec({
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [{ draw: ["a"], ask: { question: "Q?", answer: "x" } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("answersMatch and subVars", () => {
  test("matching is trimmed and case-insensitive", () => {
    expect(answersMatch("  AU ", "au")).toBe(true);
    expect(answersMatch("Ag", "Au")).toBe(false);
  });

  test("subVars replaces known names, leaves unknown braces alone", () => {
    const vars = new Map([["name", "Hans"]]);
    expect(subVars("Hi {name}, {x} stays.", vars)).toBe("Hi Hans, {x} stays.");
  });
});

// The drag widget: items are the answer, right is the reveal, geometry is the
// planner's business — the schema checks shape only.
describe("the drag widget", () => {
  const drag = (extra: Record<string, unknown> = {}) => {
    const ask: Record<string, unknown> = { question: "Place them.", widget: "drag", items: ["a"], right: "There.", ...extra };
    for (const k of Object.keys(ask)) if (ask[k] === undefined) delete ask[k];
    return ask;
  };
  const errorsOf = (ask: object) => validateSpec(base(ask)).errors.join(" | ");

  test("items + right pass; answer is implied", () => {
    expect(validateSpec(base(drag())).errors).toEqual([]);
    expect(validateSpec(base(drag({ items: [{ id: "a", label: "The A" }], tolerance: 0.1 }))).errors).toEqual([]);
    expect(validateSpec(base(drag({ retry: true, wrong: "No.", reveal: false, required: true }))).errors).toEqual([]);
  });

  test("drag needs items and right, refuses answer and store", () => {
    expect(errorsOf({ question: "Q", widget: "drag", right: "R" })).toMatch(/items/);
    expect(errorsOf(drag({ right: undefined }))).toMatch(/right/);
    expect(errorsOf(drag({ answer: "a" }))).toMatch(/answer is implied/);
    expect(errorsOf(drag({ store: "s", default: "d" }))).toMatch(/store/);
  });

  test("items only with drag; 1–8 of them; tolerance in [0, 1]", () => {
    expect(errorsOf({ question: "Q", answer: "a", items: ["a"] })).toMatch(/items/);
    expect(errorsOf({ question: "Q", answer: "a", tolerance: 0.5 })).toMatch(/tolerance/);
    expect(validateSpec(base(drag({ items: [] }))).ok).toBe(false);
    expect(validateSpec(base(drag({ items: Array(9).fill("a") }))).ok).toBe(false);
    expect(validateSpec(base(drag({ items: [{ label: "no id" }] }))).ok).toBe(false);
    expect(validateSpec(base(drag({ tolerance: 1.5 }))).ok).toBe(false);
    expect(validateSpec(base(drag({ tolerance: -0.1 }))).ok).toBe(false);
  });
});
