import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command, Spec } from "../src/spec/types";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class RecordingSpeech extends SpeechManager {
  spoken: string[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

function makePlayer(commands: Command[], speech: RecordingSpeech) {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated" });
}

const TWO_QUESTIONS: Command[] = [
  { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
  { ask: { question: "Two?", answer: "x", reveal: false } },
  { speak: "You got {score} of {score_total}." },
];

describe("the score tally", () => {
  test("one right, one wrong: 1 of 2", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(TWO_QUESTIONS, speech);
    player.quizGate = async () => 0; // correct
    player.askGate = async () => "wrong";
    await player.play();
    expect(speech.spoken.at(-1)).toBe("You got 1 of 2.");
  });

  test("a skipped answer counts as wrong", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(TWO_QUESTIONS, speech);
    player.quizGate = async () => null;
    player.askGate = async () => "x";
    await player.play();
    expect(speech.spoken.at(-1)).toBe("You got 1 of 2.");
  });

  test("re-answering after a remediation goto overwrites the slot — never double-counts", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { label: "recap" },
        { speak: "Think." },
        { quiz: { question: "One?", choices: ["a", "b"], correct: 1, wrong_goto: "recap" } },
        { speak: "Score: {score} of {score_total}." },
      ],
      speech,
    );
    const answers = [1, 0]; // wrong, then right
    player.quizGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.spoken.at(-1)).toBe("Score: 1 of 1.");
  });

  test("if on score jumps once the threshold is met", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
        { if: { var: "score", gte: 1, goto: "praise" } },
        { speak: "The consolation path." },
        { label: "praise" },
        { speak: "Well done." },
      ],
      speech,
    );
    player.quizGate = async () => 0;
    await player.play();
    expect(speech.spoken).toEqual(["One?", "Well done."]);
  });

  test("feedback lines see the fresh answer", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ quiz: { question: "One?", choices: ["a", "b"], correct: 1, right: "That makes {score}." } }],
      speech,
    );
    player.quizGate = async () => 0;
    await player.play();
    expect(speech.spoken).toEqual(["One?", "That makes 1."]);
  });

  test("auto answers (no gates) score full marks", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(TWO_QUESTIONS, speech);
    await player.play();
    expect(speech.spoken.at(-1)).toBe("You got 2 of 2.");
  });
});

describe("reserved score names", () => {
  test("ask.store may not claim score or score_total", () => {
    const spec = (store: string) => ({
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [{ ask: { question: "Q?", store, default: "1" } }],
    });
    expect(validateSpec(spec("score")).ok).toBe(false);
    expect(validateSpec(spec("score_total")).ok).toBe(false);
  });

  test("the ask-var lint does not flag the reserved names", () => {
    const spec = {
      elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
      commands: [
        { quiz: { question: "Q?", choices: ["a", "b"], correct: 1 } },
        { draw: ["a"], speak: "So far {score} of {score_total}." },
      ],
    } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "ask-var")).toEqual([]);
  });
});
