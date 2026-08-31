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
