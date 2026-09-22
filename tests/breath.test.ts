// Breathing between beats (Hans 2026-09-23): a lecture that never pauses
// sounds like one endless sentence. The player now waits a short breath
// after every SPOKEN beat — longer after a question, longer still at the
// end of a section — unless the author wrote a `pause` there, which wins.
// Renderer-side, so it holds whatever the model was asked and forgot.

import { describe, expect, test } from "vitest";
import { BREATH_MS, breathAfterMs } from "../src/render/breath";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

const steps = (commands: Command[]) => planCommands(commands, []).steps;

describe("breathAfterMs — the rule", () => {
  test("a narrated beat followed by another gets the plain breath", () => {
    const s = steps([{ draw: ["a"], speak: "One." }, { draw: ["b"], speak: "Two." }]);
    expect(breathAfterMs(s, 0)).toBe(BREATH_MS.beat);
  });

  test("a beat with no voice gets none", () => {
    const s = steps([{ draw: ["a"] }, { draw: ["b"], speak: "Two." }]);
    expect(breathAfterMs(s, 0)).toBe(0);
  });

  test("an author's own pause wins: no breath before an explicit pause", () => {
    const s = steps([{ draw: ["a"], speak: "One." }, { pause: 0.2 }, { draw: ["b"], speak: "Two." }]);
    expect(breathAfterMs(s, 0)).toBe(0);
  });

  test("a question hangs longer", () => {
    const s = steps([{ draw: ["a"], speak: "But why would that be?" }, { draw: ["b"], speak: "Because." }]);
    expect(breathAfterMs(s, 0)).toBe(BREATH_MS.question);
    expect(BREATH_MS.question).toBeGreaterThan(BREATH_MS.beat);
  });

  test("the last spoken beat of a page, and a beat before a quiz or a clear, get the section breath", () => {
    const last = steps([{ draw: ["a"], speak: "One." }, { draw: ["b"], speak: "So that is it." }]);
    expect(breathAfterMs(last, 1)).toBe(BREATH_MS.section);
    const quiz = steps([{ draw: ["a"], speak: "One." }, { quiz: { question: "Q?", choices: ["x", "y"], correct: 1 } }]);
    expect(breathAfterMs(quiz, 0)).toBe(BREATH_MS.section);
    const clear = steps([{ draw: ["a"], speak: "One." }, { clear: { keep: [] } }, { draw: ["b"], speak: "Two." }]);
    expect(breathAfterMs(clear, 0)).toBe(BREATH_MS.section);
    expect(BREATH_MS.section).toBeGreaterThan(BREATH_MS.question);
  });

  test("a standalone speak breathes too; a non-blocking one does not (it runs under the next beat)", () => {
    const alone = steps([{ speak: "Closing line." }, { draw: ["b"], speak: "Two." }]);
    expect(breathAfterMs(alone, 0)).toBe(BREATH_MS.beat);
    const under = steps([{ speak: "Over the next beats.", blocking: false }, { point: { at: { ref: "b" } } }]);
    expect(breathAfterMs(under, 0)).toBe(0);
  });
});

class StubSpeech extends SpeechManager {
  resolvers: (() => void)[] = [];
  calls: string[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.calls.push(text);
    return new Promise((res) => this.resolvers.push(res));
  }
  override cancel(): void {}
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// No requestAnimationFrame in this environment: the player's waits tick on a timer instead.
const withTimerRaf = (player: Player): Player => {
  player.raf = (cb) => void setTimeout(() => cb(performance.now()), 16);
  return player;
};

describe("the player breathes", () => {
  test("the next beat's voice starts only after the breath", async () => {
    const speech = new StubSpeech();
    const player = withTimerRaf(new Player(planCommands([{ draw: ["a"], speak: "One." }, { draw: ["b"], speak: "Two." }], []), new Map(), speech, null, { mode: "narrated" }));
    const done = player.play();
    await wait(20);
    expect(speech.calls).toHaveLength(1);
    speech.resolvers[0]();
    await wait(BREATH_MS.beat / 2);
    expect(speech.calls).toHaveLength(1); // still breathing
    await wait(BREATH_MS.beat);
    expect(speech.calls).toHaveLength(2);
    speech.resolvers[1]();
    await done;
  });

  test("an explicit pause replaces the breath rather than adding to it", async () => {
    const speech = new StubSpeech();
    const player = withTimerRaf(new Player(planCommands([{ draw: ["a"], speak: "One." }, { pause: 0.05 }, { draw: ["b"], speak: "Two." }], []), new Map(), speech, null, { mode: "narrated" }));
    const done = player.play();
    await wait(20);
    speech.resolvers[0]();
    await wait(BREATH_MS.beat / 2); // longer than the pause, shorter than a breath
    expect(speech.calls).toHaveLength(2);
    speech.resolvers[1]();
    await done;
  });
});
