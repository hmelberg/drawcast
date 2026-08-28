// Identify-quiz generators: valid, distinct, deterministic under an injected
// rng, and every piano target really exists on the drawn keyboard.
import { describe, expect, test } from "vitest";
import { activitiesFor, chessQuizTargets, pianoQuizTargets, quizPrompt } from "../src/ui/quiz-model";
import { pianoKeyBox, pianoNotes } from "../src/render/widgets";

/** Deterministic rng stub: cycles a fixed sequence. */
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++ % vals.length];
}

describe("activitiesFor", () => {
  test("kinds imply their drills; unknown kinds imply nothing", () => {
    expect(activitiesFor(["chess"]).map((a) => a.id)).toEqual(["square_quiz", "vs_computer"]);
    expect(activitiesFor(["piano", "chess"]).map((a) => a.id)).toEqual(["square_quiz", "vs_computer", "note_quiz"]);
    expect(activitiesFor([])).toEqual([]);
  });
});

describe("chessQuizTargets", () => {
  test("distinct valid squares, as many as asked", () => {
    const t = chessQuizTargets(5);
    expect(t).toHaveLength(5);
    expect(new Set(t).size).toBe(5);
    for (const sq of t) expect(sq).toMatch(/^[a-h][1-8]$/);
  });
  test("deterministic under an injected rng", () => {
    expect(chessQuizTargets(3, rngOf(0.1, 0.5, 0.9))).toEqual(chessQuizTargets(3, rngOf(0.1, 0.5, 0.9)));
  });
  test("asking for more than 64 caps at the whole board", () => {
    expect(chessQuizTargets(99)).toHaveLength(64);
  });
});

describe("pianoNotes / pianoQuizTargets", () => {
  test("one octave holds 12 notes, two hold 24, and every one has a key box", () => {
    expect(pianoNotes(1)).toHaveLength(12);
    expect(pianoNotes(2)).toHaveLength(24);
    for (const octaves of [1, 2] as const) {
      for (const note of pianoNotes(octaves)) expect(pianoKeyBox(octaves, note)).not.toBeNull();
    }
  });
  test("targets are distinct notes from the drawn keyboard", () => {
    const t = pianoQuizTargets(5, 2);
    expect(t).toHaveLength(5);
    expect(new Set(t).size).toBe(5);
    for (const note of t) expect(pianoNotes(2)).toContain(note);
  });
});

describe("quizPrompt", () => {
  test("chess names the square; piano prettifies sharps", () => {
    expect(quizPrompt("chess", "e4")).toBe("Click square e4");
    expect(quizPrompt("piano", "F#3")).toBe("Click F♯3");
    expect(quizPrompt("piano", "C4")).toBe("Click C4");
  });
});
