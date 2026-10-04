// W25: a picture over a guessed scale's marker band hides the viewer's number.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const spec = (y: number, drawFirst: boolean): Spec =>
  ({
    title: "How many ants are there on Earth?",
    elements: [
      { id: "ant", type: "text", text: "ANT ANT ANT ANT", x: 500, y, font_size: 40 },
      { id: "count", type: "scale", min: 0.01, max: 100000, log: true, unit: "trillion", value: 20000, x: 100, y: 440, width: 800 },
    ],
    commands: [
      { draw: drawFirst ? ["ant", "count"] : ["count"], speak: "Ants." },
      { ask: { question: "How many ants live on Earth? Click on the line.", on: "count", store: "g" } },
      ...(drawFirst ? [] : [{ draw: ["ant"], speak: "There." }]),
    ],
  }) as unknown as Spec;

const markerIssues = (s: Spec) => layoutSpec(expandSpec(s)).issues.filter((i) => i.rule === "scale-marker");

describe("scale-marker lint", () => {
  test("a text on the marker band while the viewer guesses: warned", () => {
    const out = markerIssues(spec(480, true));
    expect(out).toHaveLength(1);
    expect(out[0].ids).toEqual(["ant", "count"]);
  });
  test("clear of the band: none", () => {
    expect(markerIssues(spec(600, true))).toHaveLength(0);
  });
  test("drawn only after the guess: none", () => {
    expect(markerIssues(spec(480, false))).toHaveLength(0);
  });
});
