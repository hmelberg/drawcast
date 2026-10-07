// The frames harness's stand-in viewer (src/dev/wrong-answer.ts): on the
// "answer (after the reveal)" tile every question is answered WRONG-ish, the
// way a real viewer often is, so the tile shows the guess and the truth side
// by side. Each answer must decode through the player's own decoders and
// score as wrong — never the truth, which would hide the guess under it.
import { describe, expect, test } from "vitest";
import { formatterFor, decodeGuess, type GuessHandle } from "../src/guess/handles";
import { scoreGuess } from "../src/guess/score";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { decodeArrangement, scoreCards } from "../src/cards/model";
import { wrongArrangement, wrongChoice, wrongGuess, wrongQuiz, wrongTyped } from "../src/dev/wrong-answer";

const handle = (kind: GuessHandle["kind"], truth: number[], min = 0, max = 100, step = 1): GuessHandle => ({
  part: "p",
  shows: ["p"],
  kind,
  truth,
  min,
  max,
  step,
  label: "p",
  format: formatterFor(step),
  unit: "",
});

describe("wrongGuess", () => {
  test("a bar: off the truth by enough to score wrong, inside its axis, on its step", () => {
    const hs = [handle("height", [40], 0, 100, 0.5)];
    const g = wrongGuess(hs, {});
    expect(decodeGuess(g, hs)).not.toBeNull();
    const v = decodeGuess(g, hs)!;
    expect(scoreGuess(hs, v).ok).toBe(false);
    expect(v[0][0]).toBeGreaterThanOrEqual(0);
    expect(v[0][0]).toBeLessThanOrEqual(100);
    expect((v[0][0] * 2) % 1).toBe(0);
  });

  test("a bar near the top goes down, not off the axis", () => {
    const hs = [handle("height", [95])];
    const v = decodeGuess(wrongGuess(hs, {}), hs)!;
    expect(v[0][0]).toBeLessThan(95);
    expect(scoreGuess(hs, v).ok).toBe(false);
  });

  test("a line: every point drawn, offset from the true line", () => {
    const hs = [handle("curve", [10, 20, 30, 40, 50])];
    const v = decodeGuess(wrongGuess(hs, {}), hs)!;
    expect(v[0]).toHaveLength(5);
    expect(v[0].every((x, j) => x !== hs[0].truth[j])).toBe(true);
    expect(scoreGuess(hs, v).ok).toBe(false);
  });

  test("the author's default stands when it is itself wrong — the guess the cast expects", () => {
    const hs = [handle("height", [40])];
    expect(wrongGuess(hs, { fallback: "75" })).toBe("75");
  });

  test("a default that would score right is not used", () => {
    const hs = [handle("height", [40])];
    const v = decodeGuess(wrongGuess(hs, { fallback: "41" }), hs)!;
    expect(scoreGuess(hs, v).ok).toBe(false);
  });

  test("a default far from the truth stands even when the scoring calls it close — as a viewer would hear it", () => {
    // 60 against 40 on a 0–100 axis with a loose tolerance: scored right, yet plainly apart.
    const hs = [handle("height", [40])];
    expect(wrongGuess(hs, { fallback: "60", tolerance: 0.25 })).toBe("60");
  });

  test("a single-number default on a line is spread over every point", () => {
    const hs = [handle("curve", [10, 20, 30])];
    expect(decodeGuess(wrongGuess(hs, { fallback: "70" }), hs)).toEqual([[70, 70, 70]]);
  });

  test("a relative tolerance is honoured", () => {
    const hs = [handle("point", [78], 1, 1000)];
    const v = decodeGuess(wrongGuess(hs, { fallback: "100", relative: true, tolerance: 0.3 }), hs)!;
    expect(scoreGuess(hs, v, { relative: true, tolerance: 0.3 }).ok).toBe(false);
  });

  test("a budget: the split still balances", () => {
    const hs = [handle("height", [30]), handle("height", [70])];
    const v = decodeGuess(wrongGuess(hs, { budget: 100 }), hs)!;
    expect(v[0][0] + v[1][0]).toBeCloseTo(100);
    expect(scoreGuess(hs, v).ok).toBe(false);
  });
});

describe("wrongArrangement", () => {
  const judge = (el: CardsElementLike): { ok: boolean; within: number; count: number; decoded: boolean } => {
    const g = cardsGeometry(el);
    const s = wrongArrangement(g);
    const a = decodeArrangement(g, s);
    const sc = a ? scoreCards(g, a) : { ok: true, within: 0, count: 0 };
    return { ...sc, decoded: a !== null };
  };

  test("rank: one pair out of order", () => {
    const r = judge({ id: "r", type: "cards", items: ["A", "B", "C", "D"] });
    expect(r.decoded).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.within).toBe(r.count - 2);
  });

  test("select (check: each): one card wrong, the rest right", () => {
    const r = judge({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }] });
    expect(r.decoded).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.within).toBe(r.count - 1);
  });

  test("sort with check: end: one card in the wrong box", () => {
    const r = judge({ id: "c", type: "cards", check: "end", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Tax", bin: "Fixed" }] } as CardsElementLike);
    expect(r.decoded).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.within).toBe(r.count - 1);
  });
});

describe("the other question kinds", () => {
  test("quiz: a choice that is not the correct one", () => {
    expect(wrongQuiz({ choices: ["a", "b", "c"], correct: 0 })).toBe(1);
    expect(wrongQuiz({ choices: ["a", "b", "c"], correct: 2 })).toBe(0);
  });

  test("choose: an option other than the answer", () => {
    const opts = [{ id: "x" }, { id: "y" }];
    expect(wrongChoice({ choose: opts, answer: "x" })).toBe("y");
    expect(wrongChoice({ choose: opts })).toBe("x");
  });

  test("typed: the default when it is wrong, else something that is not the answer", () => {
    expect(wrongTyped({ answer: "42", fallback: "40" })).toBe("40");
    expect(wrongTyped({ answer: "42", fallback: "42" })).not.toBe("42");
    expect(wrongTyped({ fallback: "hello" })).toBe("hello");
  });
});
