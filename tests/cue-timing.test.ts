// When a cued action starts. Two things the first cut got wrong: it ignored
// the delivery rate (a `grave` line runs 14% longer than the estimate, so
// every cue in it fired early), and it could only say "start here" — never
// "be finished by here", which is what a reveal actually wants.
import { describe, expect, test } from "vitest";
import { cueStartMs } from "../src/render/cue";
import { SpeechManager } from "../src/render/speech";

const LINE = "Renta stiger og etterspørselen faller helt ned hit igjen nå";
const lineMs = SpeechManager.estimateMs(LINE);

describe("when a cued action starts", () => {
  test("no cue, no wait", () => {
    expect(cueStartMs(undefined, false, LINE, undefined, 2150)).toBe(0);
  });

  test("a start cue is that far into the line", () => {
    expect(cueStartMs(0.5, false, LINE, undefined, 2150)).toBeCloseTo(lineMs * 0.5, 5);
  });

  test("a slow delivery makes the line longer, so the cue waits longer", () => {
    const plain = cueStartMs(0.5, false, LINE, undefined, 0);
    const grave = cueStartMs(0.5, false, LINE, "grave", 0);
    expect(grave).toBeCloseTo(plain / 0.88, 5);
    expect(grave).toBeGreaterThan(plain);
  });

  test("a brisk delivery shortens it", () => {
    expect(cueStartMs(0.5, false, LINE, "brisk", 0)).toBeLessThan(cueStartMs(0.5, false, LINE, undefined, 0));
  });

  test("an end cue starts early enough to FINISH on the word", () => {
    const start = cueStartMs(0.8, true, LINE, undefined, 2150);
    expect(start + 2150).toBeCloseTo(lineMs * 0.8, 5);
  });

  test("an end cue on an instant action is the same as a start cue", () => {
    expect(cueStartMs(0.8, true, LINE, undefined, 0)).toBeCloseTo(cueStartMs(0.8, false, LINE, undefined, 0), 5);
  });

  test("an action longer than its cue point starts at once rather than going negative", () => {
    expect(cueStartMs(0.2, true, LINE, undefined, 99_000)).toBe(0);
  });
});

import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";

const one = (text: string) => parseScriptPages(text).pages[0].spec;

describe("saying it in a script", () => {
  test("`ends` marks the cue as the FINISH of the action", () => {
    const spec = one("Etterspørselen faller helt ned hit (@draw kurve ends@) igjen.\n");
    expect(spec.commands![0]).toMatchObject({ draw: ["kurve"], cue_end: true });
    expect(spec.commands![0].cue).toBeGreaterThan(0);
  });

  test("without it the cue is where the action starts", () => {
    const spec = one("Etterspørselen faller helt ned hit (@draw kurve@) igjen.\n");
    expect(spec.commands![0].cue_end).toBeUndefined();
  });

  test("it prints back", () => {
    const source = "Etterspørselen faller helt ned hit (@draw kurve ends@) igjen.\n";
    expect(printScriptPages({}, [{ spec: one(source) }])).toBe(source);
  });
});

import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";

const issuesOf = (spec: Spec) => layoutSpec(spec).issues.filter((i) => i.rule === "cue-timing");

// A sketched curve costs 2150 ms (SKETCH_MS.curve); this line is ~10 words,
// so about 3.5 s of narration.
const withCue = (cue: number, cue_end?: boolean): Spec => ({
  domain: { x: [0, 100], y: [0, 100] },
  elements: [
    { id: "ax", type: "axes", x_label: "x", y_label: "y" },
    { id: "kurve", type: "curve", direction: "decreasing", curvature: "convex" },
  ],
  commands: [
    { draw: ["ax"] },
    { draw: ["kurve"], cue, ...(cue_end === undefined ? {} : { cue_end }), speak: "Renta stiger og etterspørselen faller helt ned hit igjen nå." },
  ],
});

describe("a cue that cannot land where it was written", () => {
  test("an end cue earlier than the action is long is reported", () => {
    // 2.15 s of curve cannot be finished 0.35 s into the line.
    const issues = issuesOf(withCue(0.1, true));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/cannot finish/);
    expect(issues[0].ids).toContain("kurve");
  });

  test("an end cue with room to spare is fine", () => {
    expect(issuesOf(withCue(0.9, true))).toEqual([]);
  });

  test("a start cue whose action overruns the sentence suggests the other anchor", () => {
    const issues = issuesOf(withCue(0.85));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/cue_end/);
  });

  test("a start cue early enough to finish inside the line is fine", () => {
    expect(issuesOf(withCue(0.2))).toEqual([]);
  });

  test("a cast with no cue is never reported", () => {
    const spec = withCue(0.85);
    delete spec.commands![1].cue;
    expect(issuesOf(spec)).toEqual([]);
  });
});
