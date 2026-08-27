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
