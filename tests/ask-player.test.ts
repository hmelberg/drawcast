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

function makePlayer(commands: Command[], speech: RecordingSpeech, questions?: "on" | "skip") {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated", questions });
}

describe("skip questions", () => {
  test("a skipped quiz says nothing and never gates", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ quiz: { question: "Which?", choices: ["a", "b"], correct: 1, right: "A." } }, { speak: "Moving on." }],
      speech,
      "skip",
    );
    let gated = false;
    player.quizGate = async () => {
      gated = true;
      return null;
    };
    await player.play();
    expect(gated).toBe(false);
    expect(speech.spoken).toEqual(["Moving on."]);
    expect(player.state).toBe("done");
  });

  test("a skipped collect-ask still stores its default for later lines", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ ask: { question: "Name?", store: "name", default: "friend" } }, { speak: "Hello, {name}." }],
      speech,
      "skip",
    );
    let gated = false;
    player.askGate = async () => {
      gated = true;
      return null;
    };
    await player.play();
    expect(gated).toBe(false);
    expect(speech.spoken).toEqual(["Hello, friend."]);
  });
});

describe("the typed ask action", () => {
  test("collect: the typed answer is stored and interpolated into later narration", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { ask: { question: "What is your name?", store: "name", default: "friend" } },
        { speak: "Nice to meet you, {name}!" },
      ],
      speech,
    );
    player.askGate = async () => "Hans";
    await player.play();
    expect(player.vars.get("name")).toBe("Hans");
    expect(speech.spoken).toEqual(["What is your name?", "Nice to meet you, Hans!"]);
  });

  test("collect skipped: the default is stored and used", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ ask: { question: "Name?", store: "name", default: "friend" } }, { speak: "Hello, {name}." }],
      speech,
    );
    player.askGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Name?", "Hello, friend."]);
  });

  test("check correct (case-insensitive): right only", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong: "No." } }], speech);
    player.askGate = async () => "  au ";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Gold is Au."]);
  });

  test("check wrong without retry: wrong then the reveal", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong: "Not that." } }], speech);
    player.askGate = async () => "Ag";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Not that.", "Gold is Au."]);
  });

  test("check wrong with reveal false: wrong only", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", wrong: "Not that.", reveal: false } }], speech);
    player.askGate = async () => "Ag";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Not that."]);
  });

  test("retry: the gate is asked again until correct", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong: "Try again.", retry: true } }], speech);
    const attempts = ["Ag", "Au"];
    player.askGate = async () => attempts.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Try again.", "Gold is Au."]);
  });

  test("skipped during retry with reveal: the reveal line speaks", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", wrong: "Try again.", retry: true } }], speech);
    const attempts: (string | null)[] = ["Ag", null];
    player.askGate = async () => attempts.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Try again.", "Au"]);
  });

  test("no gate (auto): types the answer — right speaks; collect stores the default", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { ask: { question: "Gold?", answer: "Au", right: "Gold is Au." } },
        { ask: { question: "Name?", store: "name", default: "friend" } },
        { speak: "Bye, {name}." },
      ],
      speech,
    );
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Gold is Au.", "Name?", "Bye, friend."]);
    expect(player.state).toBe("done");
  });
});
