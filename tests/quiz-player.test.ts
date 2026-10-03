import { describe, expect, test } from "vitest";
import { AFFIRM } from "../src/render/affirm";
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
  test("correct answer: the question, then one short affirmation, not `right` — the viewer knows why (Hans 2026-09-27, 2026-10-04)", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
    player.quizGate = async () => 1; // 0-based: "two"
    await player.play();
    expect(speech.spoken[0]).toBe("Which?");
    expect(speech.spoken).toHaveLength(2);
    expect([...AFFIRM.en.plain, ...AFFIRM.en.warm]).toContain(speech.spoken[1]);
    expect(player.state).toBe("done");
  });

  test("affirm: \"plain\" keeps the one word; false says nothing", async () => {
    for (const [affirm, said] of [["plain", ["Which?", "Correct."]], [false, ["Which?"]]] as const) {
      const speech = new RecordingSpeech();
      const player = makePlayer(ASK, speech);
      player.affirmer.configure({ affirm });
      player.quizGate = async () => 1;
      await player.play();
      expect(speech.spoken).toEqual(said);
    }
  });

  test("a movie still reads `right` (it answered for the viewer)", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
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

  test("a live viewer's Skip skips the question AND its explanation (Hans 2026-09-26)", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(ASK, speech);
    player.quizGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Which?"]);
  });

  test("without right, the reveal is the correct choice text", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer({ question: "Which?", choices: ["one", "two"], correct: 2 }, speech);
    player.quizGate = async () => 0; // a wrong answer is answered with the reveal
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "two"]);
  });

  test("Skip explanation cuts the feedback after an answer, and the lesson goes on", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer({ ...ASK, wrong: "Count again." }, speech);
    player.quizGate = async () => 0;
    const seen: boolean[] = [];
    player.feedbackHook = (active) => {
      seen.push(active);
      if (active) player.skipFeedback();
    };
    await player.play();
    expect(player.state).toBe("done");
    expect(speech.spoken).toEqual(["Which?"]);
    expect(seen).toEqual([true, false]);
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
    player.affirmer.configure({ affirm: "plain" });
    const answers = [1, 0]; // correct, then correct
    player.quizGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Which?", "Correct.", "Second?", "Correct."]);
    expect(player.state).toBe("done");
  });

  test("a right line that reads a live value is news, and is still said", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer({ ...ASK, right: "Yes: that is {score} so far." }, speech);
    player.quizGate = async () => 1;
    await player.play();
    expect(speech.spoken[1]).toMatch(/^Yes: that is/);
  });

  test("answering cuts the question's own reading at once", async () => {
    // A voice that only ends when aborted: before, the player waited for it.
    let aborted = false;
    const speech = {
      spoken: [] as string[],
      speak(text: string, _r: number, signal?: AbortSignal) {
        this.spoken.push(text);
        if (text !== "Which?") return Promise.resolve();
        return new Promise<void>((resolve) => signal?.addEventListener("abort", () => { aborted = true; resolve(); }));
      },
      cancel() {}, pause() {}, resume() {},
    };
    const player = makePlayer(ASK, speech as never);
    player.quizGate = async () => null; // Skip
    await player.play();
    expect(aborted).toBe(true);
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
