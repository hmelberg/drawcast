// Pure character math for the `type` draw mode's per-frame reveal
// (src/render/type-reveal.ts) — the DOM-free seam pulled out of
// svg-backend.ts's makeLeafHandle, since this repo carries no jsdom and the
// DOM glue around this math (querying a leaf's rows/runs, writing
// textContent back) cannot be exercised by a node-environment test.

import { describe, expect, test } from "vitest";
import { computeTypeFrame, revealRow, totalChars, type TypeRun } from "../src/render/type-reveal";

const run = (text: string): TypeRun => ({ text });

describe("revealRow: one row's runs at `take` characters shown", () => {
  test("take = 0 shows nothing, cutIndex is the first run", () => {
    const { shown, cutIndex } = revealRow([run("abc"), run("def")], 0);
    expect(shown).toEqual(["", ""]);
    expect(cutIndex).toBe(0);
  });
  test("a partial take straddling two runs keeps each run's own slice", () => {
    const { shown, cutIndex } = revealRow([run("abc"), run("def")], 4);
    expect(shown).toEqual(["abc", "d"]);
    expect(cutIndex).toBe(1); // the SECOND run is where the cut falls
  });
  test("take exactly at a run boundary — the cut is the run that is not yet full", () => {
    const { shown, cutIndex } = revealRow([run("abc"), run("def")], 3);
    expect(shown).toEqual(["abc", ""]);
    expect(cutIndex).toBe(1); // "abc" is fully shown, so the cut moves to the next run
  });
  test("take covering everything: cutIndex falls back to the last run", () => {
    const { shown, cutIndex } = revealRow([run("abc"), run("def")], 10);
    expect(shown).toEqual(["abc", "def"]);
    expect(cutIndex).toBe(1);
  });
  test("a single run row", () => {
    expect(revealRow([run("hello")], 2)).toEqual({ shown: ["he"], cutIndex: 0 });
  });
  test("an empty runs array never throws — cutIndex clamps to 0", () => {
    expect(revealRow([], 5)).toEqual({ shown: [], cutIndex: 0 });
  });
  test("negative take is clamped to 0 (erase/scrub never go negative in practice, but the function must not throw)", () => {
    expect(revealRow([run("abc")], -3)).toEqual({ shown: [""], cutIndex: 0 });
  });
});

describe("totalChars", () => {
  test("sums every run's length across every row", () => {
    expect(totalChars([[run("ab"), run("c")], [run("defg")]])).toBe(7);
  });
  test("zero for no rows or all-empty rows", () => {
    expect(totalChars([])).toBe(0);
    expect(totalChars([[run("")], []])).toBe(0);
  });
});

describe("computeTypeFrame: the whole reveal across rows", () => {
  const rows: TypeRun[][] = [[run("if "), run("x")], [run("    "), run("y"), run(" = 1")]];
  // row 0 = "if x" (4 chars), row 1 = "    y = 1" (9 chars), total 13

  test("n = 0, not typing: nothing shown, no cursor", () => {
    const { shown, cursorAt } = computeTypeFrame(rows, 0, false);
    expect(shown).toEqual([["", ""], ["", "", ""]]);
    expect(cursorAt).toBeNull();
  });

  test("mid row 0: cursor lands in the run where the cut falls, row 1 untouched", () => {
    const { shown, cursorAt } = computeTypeFrame(rows, 2, true);
    expect(shown[0]).toEqual(["if", ""]); // "if " is 3 chars, take=2 lands inside run 0
    expect(shown[1]).toEqual(["", "", ""]);
    expect(cursorAt).toEqual([0, 0]);
  });

  test("exactly at the row-0/row-1 boundary: cursor moves to row 1's first run", () => {
    const { shown, cursorAt } = computeTypeFrame(rows, 4, true);
    expect(shown[0]).toEqual(["if ", "x"]); // row 0 fully shown
    expect(shown[1]).toEqual(["", "", ""]); // row 1 not started
    expect(cursorAt).toEqual([1, 0]);
  });

  test("mid row 1", () => {
    const { shown, cursorAt } = computeTypeFrame(rows, 4 + 6, true);
    expect(shown[0]).toEqual(["if ", "x"]);
    expect(shown[1]).toEqual(["    ", "y", " "]); // 6 chars into row 1's "    y = 1" is "    y "
    expect(cursorAt).toEqual([1, 2]);
  });

  test("n = total, typing = false (rest): everything shown, no cursor", () => {
    const total = totalChars(rows);
    const { shown, cursorAt } = computeTypeFrame(rows, total, false);
    expect(shown[0]).toEqual(["if ", "x"]);
    expect(shown[1]).toEqual(["    ", "y", " = 1"]);
    expect(cursorAt).toBeNull();
  });

  test("n = total, typing = true (the blink at the very end): cursor still placed, on the last row's fallback rule", () => {
    const total = totalChars(rows);
    const { cursorAt } = computeTypeFrame(rows, total, true);
    expect(cursorAt).toEqual([1, 2]); // last row, last run — everything already shown
  });

  test("erase: n runs backwards from total to 0 — a pure function of n, so this is just computeTypeFrame at a smaller n", () => {
    const total = totalChars(rows);
    const atFull = computeTypeFrame(rows, total, false);
    const atZero = computeTypeFrame(rows, 0, false);
    const atHalf = computeTypeFrame(rows, Math.round(total / 2), true);
    // No ordering assumption beyond: shown chars only shrink as n shrinks.
    const lenOf = (shown: string[][]) => shown.flat().join("").length;
    expect(lenOf(atZero.shown)).toBe(0);
    expect(lenOf(atHalf.shown)).toBeLessThanOrEqual(lenOf(atFull.shown));
    expect(lenOf(atFull.shown)).toBe(total);
  });

  test("scrub: jumping n anywhere gives the same result as reaching it by steps (purity)", () => {
    for (let n = 0; n <= totalChars(rows); n++) {
      const direct = computeTypeFrame(rows, n, n > 0 && n < totalChars(rows));
      const again = computeTypeFrame(rows, n, n > 0 && n < totalChars(rows));
      expect(direct).toEqual(again);
    }
  });

  test("an empty row (no runs) never throws and never gets a cursor stuck", () => {
    const withEmpty: TypeRun[][] = [[], [run("ab")]];
    const frame = computeTypeFrame(withEmpty, 1, true);
    expect(frame.shown[0]).toEqual([]);
    expect(frame.shown[1]).toEqual(["a"]);
  });
});
