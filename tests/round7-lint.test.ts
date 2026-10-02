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
