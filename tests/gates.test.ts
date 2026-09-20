// The stage's gestures must all stand aside for the SAME set of gates. Three
// of them named their own subset and left `.cs-waitgate` out, which is what
// made a chapter's continue pill unclickable wherever the finished drawing
// carried a card element. A drift test, because the failure is silent: a
// forgotten class costs nothing until a viewer clicks the wrong pixel.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { GATE_SELECTOR, gateIsOpen } from "../src/ui/gates";

const source = (name: string): string => readFileSync(new URL(`../src/ui/${name}`, import.meta.url), "utf8");

/** Every full-stage overlay controls.ts can put up. */
const GATE_CLASSES = ["cs-figgate", "cs-cardgate", "cs-waitgate"];

describe("GATE_SELECTOR", () => {
  test("names every full-stage overlay, the continue gate included", () => {
    for (const cls of GATE_CLASSES) expect(GATE_SELECTOR).toContain(`.${cls}`);
  });

  test("does not match the pill INSIDE a gate", () => {
    // .cs-waitgate-pill is the label a figure gate borrows for its hint; a
    // selector that matched it would report a gate on every quiz hint.
    expect(GATE_SELECTOR).not.toContain(".cs-waitgate-pill");
  });

  test("gateIsOpen asks the stage with that selector", () => {
    const asked: string[] = [];
    const stage = {
      querySelector: (sel: string) => {
        asked.push(sel);
        return null;
      },
    } as unknown as ParentNode;
    expect(gateIsOpen(stage)).toBe(false);
    expect(asked).toEqual([GATE_SELECTOR]);
  });
});

describe("no guard names its own subset", () => {
  // A gate clearing a stale copy of ITSELF names one class and is fine
  // (`querySelector(".cs-figgate")?.remove()`). What drifts is a guard that
  // hand-writes the LIST — that is the shape banned here.
  const HAND_WRITTEN_LIST = /querySelector\(\s*"\.cs-\w+\s*,[^"]*"\s*\)/;

  for (const name of ["controls.ts", "infocard.ts", "chessplay.ts"]) {
    test(`${name} guards through gateIsOpen`, () => {
      const text = source(name);
      expect(text).toContain("gateIsOpen");
      expect(text).not.toMatch(HAND_WRITTEN_LIST);
    });
  }
});

describe("the chess-ish quiz gates clear each other on mount", () => {
  // quiz.ts, chessvs.ts and chessdrill.ts each put up a distinct .cs-figgate
  // subclass (.cs-quizgate / .cs-vsgate / .cs-drillgate) directly on the
  // stage, and each pre-clears the OTHER two so opening one from inside
  // another (without pressing ✕ first) swaps it rather than stacking two
  // overlays. chessdrill.ts named its own class correctly but chessvs.ts and
  // quiz.ts had never heard of it — caught only in review, because
  // mountChessDrill had no call sites yet to make it visible at runtime.
  // Same silent-drift shape this file's own header warns about.
  const SIBLINGS = ["cs-quizgate", "cs-vsgate", "cs-drillgate"];
  const PRE_CLEAR = /stage\.querySelector\("([^"]+)"\)\?\.remove\(\);/;

  for (const name of ["quiz.ts", "chessvs.ts", "chessdrill.ts"]) {
    test(`${name} names every sibling in its pre-mount clear`, () => {
      const text = source(name);
      const m = text.match(PRE_CLEAR);
      expect(m, `${name}: no stage.querySelector(...)?.remove() pre-clear found`).not.toBeNull();
      const selector = m![1];
      for (const cls of SIBLINGS) expect(selector, `${name}'s pre-clear selector`).toContain(`.${cls}`);
    });
  }
});
