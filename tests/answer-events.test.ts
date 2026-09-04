import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class SilentSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

function makePlayer(commands: Command[]) {
  const player = new Player(planCommands(commands, []), new Map(), new SilentSpeech(), null, { mode: "narrated" });
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events };
}

const QUIZ: Command = { quiz: { question: "Which?", choices: ["dative", "genitive"], correct: 2 } };

describe("quiz answers", () => {
  test("a live wrong answer reports the chosen text, the expected text and false", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.quizGate = async () => 0;
    await player.play();
    expect(events).toEqual([{ index: 0, kind: "quiz", question: "Which?", given: ["dative"], expected: "genitive", correct: false }]);
  });
  test("a live right answer reports true", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.quizGate = async () => 1;
    await player.play();
    expect(events[0]).toMatchObject({ given: ["genitive"], correct: true });
  });
  test("skip reports no attempt and false", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.quizGate = async () => null;
    await player.play();
    expect(events[0]).toMatchObject({ given: [], correct: false });
  });
  test("a gate-less player (movie, embed) reports nothing", async () => {
    const { player, events } = makePlayer([QUIZ]);
    await player.play();
    expect(events).toEqual([]);
  });
  test("autoAnswers reports nothing even with a gate", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.autoAnswers = true;
    player.quizGate = async () => 0;
    await player.play();
    expect(events).toEqual([]);
  });
});

describe("ask answers", () => {
  test("every attempt is kept, verbatim, and the outcome is the last one", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive", retry: true, wrong: "No." } }]);
    const tries = ["dativ", "Genitive"];
    player.askGate = async () => tries.shift() ?? null;
    await player.play();
    expect(events).toEqual([{ index: 0, kind: "ask", question: "Case?", given: ["dativ", "Genitive"], expected: "genitive", correct: true }]);
  });
  test("a wrong answer without retry reports one attempt and false", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive" } }]);
    player.askGate = async () => "dative";
    await player.play();
    expect(events[0]).toMatchObject({ given: ["dative"], correct: false });
  });
  test("collect mode (no answer) is personal input and never reports", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Your name?", store: "name", default: "friend" } }]);
    player.askGate = async () => "Kari";
    await player.play();
    expect(events).toEqual([]);
  });
  test("skip on a check-mode ask reports no attempt and false", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive", retry: true, wrong: "No." } }]);
    player.askGate = async () => null;
    await player.play();
    expect(events[0]).toMatchObject({ given: [], correct: false });
  });
  test("the auto path reports nothing", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive" } }]);
    await player.play();
    expect(events).toEqual([]);
  });
});
