// The player's three ways with questions (ui/watch.ts): Interactive waits at
// the gates the controls built, Watch answers on its own and goes on, Skip
// leaves the questions out — and the choice can change while a cast plays.
import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { applyQuestionMode } from "../src/ui/watch";
import { questionsOption } from "../src/question-mode";
import type { RenderHandle } from "../src/render";
import type { Command } from "../src/spec/types";

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

const CAST: Command[] = [
  { speak: "Before." },
  { quiz: { question: "Which way?", choices: ["down", "up"], correct: 2, right: "Up it goes.", wrong_goto: "end" } },
  { speak: "After." },
  { label: "end" },
];

const make = (speech: RecordingSpeech) => new Player(planCommands(CAST, []), new Map(), speech, null, { mode: "narrated" });
const handle = (p: Player) => ({ timeline: p }) as unknown as RenderHandle;
const stage = {} as HTMLElement;

describe("question modes", () => {
  test("Watch: no gate waits, the answer is right, the cast goes on (no goto fires)", async () => {
    const speech = new RecordingSpeech();
    const p = make(speech);
    const viewerGate = async (): Promise<number | null> => { throw new Error("the viewer was asked"); };
    p.quizGate = viewerGate;
    applyQuestionMode(handle(p), stage, "watch", { quiz: viewerGate, ask: null, input: null });
    expect(p.autoAnswers).toBe(true);
    expect(p.quizGate).not.toBe(viewerGate);
    p.quizGate = null; // the watch card is DOM; in node the bare auto path stands in
    await p.play();
    expect(speech.spoken).toEqual(["Before.", "Which way?", "Up it goes.", "After."]);
  });

  test("back to Interactive: the viewer's own gates return", () => {
    const p = make(new RecordingSpeech());
    const live = { quiz: async () => 1, ask: async () => "x", input: async () => {} };
    applyQuestionMode(handle(p), stage, "watch", live);
    applyQuestionMode(handle(p), stage, "interactive", live);
    expect(p.autoAnswers).toBe(false);
    expect(p.quizGate).toBe(live.quiz);
    expect(p.askGate).toBe(live.ask);
    expect(p.inputGate).toBe(live.input);
  });

  test("Skip, chosen after the render: the question is left out", async () => {
    const speech = new RecordingSpeech();
    const p = make(speech);
    const live = { quiz: async () => 0, ask: null, input: null };
    applyQuestionMode(handle(p), stage, "skip", live);
    await p.play();
    expect(speech.spoken).toEqual(["Before.", "After."]);
  });

  test("renders and exports know on and skip", () => {
    expect(questionsOption("interactive")).toBe("on");
    expect(questionsOption("watch")).toBe("on");
    expect(questionsOption("skip")).toBe("skip");
    expect(questionsOption(undefined)).toBe("on");
  });
});
