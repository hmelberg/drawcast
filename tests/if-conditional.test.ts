import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
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

const spec = (commands: object[]) => ({
  elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
  commands,
});

describe("if validation", () => {
  test("a forward if-goto with one comparison passes", () => {
    const r = validateSpec(
      spec([
        { ask: { question: "Age?", store: "age", default: "30" } },
        { if: { var: "age", gt: 20, goto: "adult" } },
        { draw: ["a"] },
        { label: "adult" },
      ]),
    );
    expect(r.ok).toBe(true);
  });

  test("zero or two comparisons fail", () => {
    expect(validateSpec(spec([{ label: "l" }, { if: { var: "age", goto: "l" } }])).ok).toBe(false);
    expect(validateSpec(spec([{ label: "l" }, { if: { var: "age", gt: 1, lt: 5, goto: "l" } }])).ok).toBe(false);
  });

  test("an unknown goto target fails", () => {
    expect(validateSpec(spec([{ if: { var: "age", gt: 20, goto: "nowhere" } }])).ok).toBe(false);
  });

  test("a backward if-jump must cross a question, or the loop has no human gate", () => {
    const ungated = validateSpec(
      spec([{ label: "top" }, { draw: ["a"] }, { if: { var: "age", gt: 20, goto: "top" } }]),
    );
    expect(ungated.ok).toBe(false);
    const gated = validateSpec(
      spec([
        { label: "top" },
        { ask: { question: "Age?", store: "age", default: "30" } },
        { if: { var: "age", gt: 200, goto: "top" } },
      ]),
    );
    expect(gated.ok).toBe(true);
  });
});

function makePlayer(commands: Command[], speech: RecordingSpeech) {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated" });
}

describe("if at runtime", () => {
  const BRANCHY: Command[] = [
    { ask: { question: "How old are you?", store: "age", default: "15" } },
    { if: { var: "age", gt: 20, goto: "adult" } },
    { speak: "The young path." },
    { label: "adult" },
    { speak: "Everyone again." },
  ];

  test("a true numeric condition jumps for a live viewer", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(BRANCHY, speech);
    player.askGate = async () => "45";
    await player.play();
    expect(speech.spoken).toEqual(["How old are you?", "Everyone again."]);
  });

  test("a false condition falls through", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(BRANCHY, speech);
    player.askGate = async () => "12";
    await player.play();
    expect(speech.spoken).toEqual(["How old are you?", "The young path.", "Everyone again."]);
  });

  test("eq compares like an answer (trimmed, case-insensitive)", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { ask: { question: "Name?", store: "name", default: "friend" } },
        { if: { var: "name", eq: "hans", goto: "vip" } },
        { speak: "The regular path." },
        { label: "vip" },
        { speak: "Welcome back." },
      ],
      speech,
    );
    player.askGate = async () => "  Hans ";
    await player.play();
    expect(speech.spoken).toEqual(["Name?", "Welcome back."]);
  });

  test("autoAnswers (movies) ignores if entirely", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(BRANCHY, speech);
    player.autoAnswers = true;
    player.askGate = async () => "45";
    await player.play();
    expect(speech.spoken).toEqual(["How old are you?", "The young path.", "Everyone again."]);
  });
});
