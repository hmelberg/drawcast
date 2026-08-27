import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

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

const REMEDIATION: Command[] = [
  { label: "recap" },
  { speak: "The shift moves the crossing." },
  { quiz: { question: "Which way?", choices: ["down", "up"], correct: 2, right: "Up it goes.", wrong_goto: "recap" } },
  { speak: "Done." },
];

function makePlayer(commands: Command[], speech: RecordingSpeech) {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated" });
}

describe("goto branching", () => {
  test("a wrong viewer answer jumps back: the recap replays and the quiz comes again", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(REMEDIATION, speech);
    const answers = [0, 1]; // wrong, then right
    player.quizGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual([
      "The shift moves the crossing.",
      "Which way?",
      "Up it goes.", // the reveal after the wrong answer (right ?? choice)
      "The shift moves the crossing.",
      "Which way?",
      "Up it goes.",
      "Done.",
    ]);
    expect(player.state).toBe("done");
  });

  test("a right answer with right_goto skips ahead", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { quiz: { question: "Q?", choices: ["x", "y"], correct: 1, right_goto: "the_end" } },
        { speak: "Skipped detail." },
        { label: "the_end" },
        { speak: "The end." },
      ],
      speech,
    );
    player.quizGate = async () => 0;
    await player.play();
    expect(speech.spoken).toEqual(["Q?", "The end."]);
  });

  test("autoAnswers (the exporter) never follows gotos", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(REMEDIATION, speech);
    player.autoAnswers = true;
    player.quizGate = async () => 1; // the demo answers correctly
    await player.play();
    expect(speech.spoken).toEqual(["The shift moves the crossing.", "Which way?", "Up it goes.", "Done."]);
  });

  test("a skipped answer (null) never jumps", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(REMEDIATION, speech);
    player.quizGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["The shift moves the crossing.", "Which way?", "Up it goes.", "Done."]);
  });

  test("ask gotos work the same in check mode", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { label: "again" },
        { speak: "Think Latin." },
        { ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong_goto: "again", reveal: false } },
        { speak: "Onwards." },
      ],
      speech,
    );
    const attempts = ["Ag", "Au"];
    player.askGate = async () => attempts.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Think Latin.", "Gold?", "Think Latin.", "Gold?", "Gold is Au.", "Onwards."]);
  });

  test("skipQuestions skips the whole question including its gotos", async () => {
    const speech = new RecordingSpeech();
    const player = new Player(planCommands(REMEDIATION, []), new Map(), speech, null, { mode: "narrated", questions: "skip" });
    player.quizGate = async () => 0;
    await player.play();
    expect(speech.spoken).toEqual(["The shift moves the crossing.", "Done."]);
  });
});
