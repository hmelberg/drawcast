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
