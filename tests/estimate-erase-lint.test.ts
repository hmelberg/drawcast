// W27: `check` treats an erased estimate slider as gone — its answer marker
// (the counter's number and the thumb, drawn by the ask, never named) goes
// with `estimate_1` when the cast erases it, as the player takes it.
import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import { layoutAsSeen } from "../src/lint/at-scale";
import { heuristicMeasure } from "../src/layout/measure";
import { readFileSync } from "node:fs";
import type { Command, Spec } from "../src/spec/types";

const ask: Command = {
  ask: { question: "How many people have walked on the Moon?", estimate: { min: 0, max: 100, value: 12, unit: "people" }, store: "g", right: "Twelve.", wrong: "You said {g}. Twelve." },
} as Command;

const cast = (erase: boolean): Spec =>
  ({
    title: "Moonwalkers",
    heading: false,
    elements: [{ id: "twelve", type: "text", text: "12 people walked there", x: 500, y: 450, font_size: 60 }],
    commands: [
      { speak: "Only a few have ever stood on the Moon." },
      // Kept on purpose (after: keep) — since 2026-10-05 a slider leaves by itself.
      erase ? ask : ({ ask: { ...(ask.ask as object), after: "keep" } } as Command),
      ...(erase ? [{ erase: ["estimate_1"] }] : []),
      { draw: ["twelve"], speak: "Twelve, all between 1969 and 1972." },
    ],
  }) as unknown as Spec;

const aboutAnswer = (s: Spec): string[] => {
  const ex = expandSpec(s);
  const l = layoutSpec(ex);
  return [...l.issues, ...lintCommands(ex)].map((i) => i.message).filter((m) => m.includes("estimate_1_answer"));
};

describe("an erased estimate is gone for the lint", () => {
  test("kept on the page, its counter collides with what comes after (control)", () => {
    expect(aboutAnswer(cast(false)).length).toBeGreaterThan(0);
  });
  test("erased after its ask, nothing drawn later is judged against it", () => {
    expect(aboutAnswer(cast(true))).toEqual([]);
  });
  test("left to the default, the slider leaves by itself and is not judged either", () => {
    const auto = { ...cast(true), commands: (cast(true).commands ?? []).filter((c) => !c.erase) } as Spec;
    expect(aboutAnswer(auto)).toEqual([]);
  });
});

describe("a scale part the cast names keeps the walk's own answer", () => {
  // library/quiz/ball-in-play: the cast erases mins and mins_answer by name;
  // the answer is never drawn by a command, so it is never judged against
  // the scale's caption (lint clean on main; r3-quick regressed it).
  test("ball-in-play stays lint clean", () => {
    const ex = expandSpec(JSON.parse(readFileSync("library/quiz/ball-in-play.json", "utf8")).spec as Spec);
    const l = layoutAsSeen(ex, heuristicMeasure);
    expect([...l.issues, ...lintCommands(ex)].map((i) => i.message).filter((m) => m.includes("mins_answer"))).toEqual([]);
  });
});
