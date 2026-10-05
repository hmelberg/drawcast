// Round 7 lint: a figure question says its whole task (it stands over the
// figure as the headline), and a sort judged card by card has no arrows or
// marks for its wrong line to point at.
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const zoo = { id: "zoo", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, { text: "Shark" }, { text: "Bat", in: true }] };
const cast = (ask: object, el: object = zoo) => ({ elements: [el], commands: [{ draw: ["zoo"] }, { ask: { on: "zoo", store: "m", ...ask } }] }) as unknown as Spec;
const rule = (spec: Spec, r: string) => lintCommands(spec).filter((i) => i.rule === r);
const FULL = "Which of these animals are mammals? Tap every mammal.";
const echo = (spec: Spec) => rule(spec, "ask-question").filter((i) => i.message.includes("asks again"));

describe("the question says the whole task", () => {
  test("under six words warns", () => expect(rule(cast({ question: "Tap all the mammals." }), "ask-question")).toHaveLength(1));
  test("an instruction with no object warns, in English and Norwegian", () => {
    expect(rule(cast({ question: "Sort them." }), "ask-question")).toHaveLength(1);
    expect(rule(cast({ question: "Din tur." }), "ask-question")).toHaveLength(1);
  });
  test("a full sentence passes", () => expect(rule(cast({ question: FULL }), "ask-question")).toHaveLength(0));
  test("longer than the headline holds warns", () => {
    const long = `${FULL} ${"Think of how each one feeds its young and breathes, then tap it. ".repeat(2)}`;
    expect(rule(cast({ question: long }), "ask-question")).toHaveLength(1);
  });
  test("a typed question or a quiz is not a figure question", () => {
    const spec = { elements: [], commands: [{ ask: { question: "Name?", answer: "x" } }] } as unknown as Spec;
    expect(rule(spec, "ask-question")).toHaveLength(0);
  });
});

describe("under a heading that asks it, the question gives the task (Hans 2026-10-05)", () => {
  const ants = (question: string, speak = "How many ants are alive on Earth right now?") =>
    ({
      elements: [{ id: "count", type: "scale", min: 1, max: 100, value: 20 }],
      commands: [{ card: { title: "How many ants are on Earth?" } }, { draw: ["count"], speak }, { ask: { on: "count", store: "a", question } }],
    }) as unknown as Spec;
  test("a short task-only sentence is fine under the heading", () => {
    expect(rule(ants("Click on the line."), "ask-question")).toHaveLength(0);
    expect(echo(ants("Click on the line."))).toHaveLength(0);
  });
  test("restating the heading and the line before warns", () => {
    expect(echo(ants("How many ants live on Earth? Click on the line: each step is ten times the last."))).toHaveLength(1);
  });
  test("restating only the heading does not", () => {
    expect(echo(ants("How many ants live on Earth? Click on the line.", "Ants are everywhere: in gardens, forests and deserts."))).toHaveLength(0);
  });
  test("a different question does not", () => {
    expect(echo(ants("How much do all the ants weigh together? Drag the bar."))).toHaveLength(0);
  });
  test("with no heading a task-only sentence still stands as the headline: under six words warns", () => {
    expect(rule(cast({ question: "Tap all the mammals." }), "ask-question")).toHaveLength(1);
  });
});

describe("no arrows under check: each", () => {
  test("arrows or marks in the wrong line warn — raw and expanded", () => {
    const spec = cast({ question: FULL, wrong: "You got {m}. The arrows show where the rest belong." });
    expect(rule(spec, "cards-check")).toHaveLength(1);
    expect(rule(expandSpec(spec), "cards-check")).toHaveLength(1);
    expect(rule(cast({ question: FULL, wrong: "{m} right. The marks show where the rest belong." }), "cards-check")).toHaveLength(1);
    expect(rule(cast({ question: FULL, wrong: "Pilene viser hvor resten hører hjemme." }), "cards-check")).toHaveLength(1);
  });
  test("the score passes; check: end keeps its arrows", () => {
    expect(rule(cast({ question: FULL, wrong: "{m} of {m.total} on the first try." }), "cards-check")).toHaveLength(0);
    expect(rule(cast({ question: FULL, wrong: "The arrows show where the rest belong." }, { ...zoo, check: "end" }), "cards-check")).toHaveLength(0);
  });
});
