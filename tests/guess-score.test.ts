import { describe, expect, test } from "vitest";
import { formatterFor, type GuessHandle } from "../src/guess/handles";
import { guessText, guessVars, scoreGuess } from "../src/guess/score";

const h = (truth: number[], min = 0, max = 100, unit = ""): GuessHandle => ({
  part: "p",
  shows: ["p"],
  kind: truth.length > 1 ? "curve" : "height",
  truth,
  min,
  max,
  step: 1,
  label: "p",
  format: formatterFor(1, unit),
  unit,
});

describe("scoreGuess", () => {
  test("one value within the default tolerance (10 % of the range)", () => {
    const s = scoreGuess([h([40])], [[48]]);
    expect(s.ok).toBe(true);
    expect(s.err).toBe(8);
    expect(s.off).toBe(8);
    expect(s.pct).toBeCloseTo(20);
  });

  test("outside tolerance", () => {
    expect(scoreGuess([h([40])], [[60]]).ok).toBe(false);
  });

  test("relative tolerance compares to the truth", () => {
    expect(scoreGuess([h([1000], 0, 100000)], [[1150]], { tolerance: 0.2, relative: true }).ok).toBe(true);
    expect(scoreGuess([h([1000], 0, 100000)], [[1300]], { tolerance: 0.2, relative: true }).ok).toBe(false);
  });

  test("a whole chart averages; within counts the close ones", () => {
    const s = scoreGuess([h([10]), h([50]), h([90])], [[10], [50], [60]]);
    expect(s.within).toBe(2);
    expect(s.count).toBe(3);
    expect(s.meanFrac).toBeCloseTo(0.1);
    expect(s.ok).toBe(true);
    expect(s.err).toBeNull();
  });

  test("a sketched line averages over its points", () => {
    const s = scoreGuess([h([10, 20, 30])], [[10, 20, 60]]);
    expect(s.meanFrac).toBeCloseTo(0.1);
  });
});

describe("guess variables", () => {
  test("one value: the guess, the truth, the gap", () => {
    const hs = [h([31], 0, 100, "%")];
    const s = scoreGuess(hs, [[12]]);
    expect(guessText(hs, [[12]], s)).toBe("12%");
    const v = guessVars("G", hs, [[12]], s);
    expect(v["g.true"]).toBe("31%");
    expect(v["g.off"]).toBe("19%");
    expect(v["g.err"]).toBe("−19%");
    expect(v["g.pct"]).toBe("61%");
  });

  test("several: within/count and the mean percent", () => {
    const hs = [h([10]), h([50])];
    const s = scoreGuess(hs, [[10], [80]]);
    expect(guessText(hs, [[10], [80]], s)).toBe("1 of 2");
    const v = guessVars("g", hs, [[10], [80]], s);
    expect(v["g.within"]).toBe("1");
    expect(v["g.count"]).toBe("2");
    expect(v["g.true"]).toBeUndefined();
  });
});

describe("a sketched line: how far off in its own units", () => {
  test("{g.off} is the mean miss and {g.max} the biggest", () => {
    const hs = [h([46, 56, 64, 70], 0, 90)];
    const guess = [[46, 52, 58, 61]];
    const v = guessVars("g", hs, guess, scoreGuess(hs, guess));
    expect(v["g.off"]).toBe("5"); // (0 + 4 + 6 + 9) / 4 = 4.75 → 5 at step 1
    expect(v["g.max"]).toBe("9");
  });
});
