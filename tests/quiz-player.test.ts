import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";

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

const ASK = { question: "Which?", choices: ["one", "two"], correct: 2, right: "Yes, two.", wrong: "No." };

function makePlayer(quiz: object, speech: RecordingSpeech) {
  const plan = planCommands([{ quiz: quiz as never }], []);
  return new Player(plan, new Map(), speech, null, { mode: "narrated" });
}

describe("the quiz action", () => {
  test("correct answer: question then right feedback only", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
    player.quizGate = async () => 1; // 0-based: "two"
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "Yes, two."]);
    expect(player.state).toBe("done");
  });

  test("wrong answer: wrong feedback then the reveal line", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
    player.quizGate = async () => 0;
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "No.", "Yes, two."]);
  });

  test("skipped/auto (null): just the reveal line", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
    player.quizGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "Yes, two."]);
  });

  test("without right, the reveal is the correct choice text", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer({ question: "Which?", choices: ["one", "two"], correct: 2 }, speech);
    player.quizGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "two"]);
  });

  test("no gate at all: degrades to a hold + reveal, never deadlocks", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
    await player.play();
    expect(player.state).toBe("done");
    expect(speech.spoken).toEqual(["Which?", "Yes, two."]);
  });

  test("several quizzes in a row run as a test, each with its own feedback", async () => {
    const speech = new RecordingSpeech();
    const plan = planCommands(
      [{ quiz: ASK }, { quiz: { question: "Second?", choices: ["a", "b"], correct: 1, right: "A is right." } }],
      [],
    );
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
    const answers = [1, 0]; // correct, then correct
    player.quizGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "Yes, two.", "Second?", "A is right."]);
    expect(player.state).toBe("done");
  });

  test("the gate receives the step, including required", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer({ ...ASK, required: true }, speech);
    let seen: { required: boolean; choices: string[] } | null = null;
    player.quizGate = async (_sig, step) => {
      seen = { required: step.required, choices: step.choices };
      return step.correct;
    };
    await player.play();
    expect(seen).toEqual({ required: true, choices: ["one", "two"] });
  });
});
