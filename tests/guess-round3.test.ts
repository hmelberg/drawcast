import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent, type GuessRuntime, type GuessSession, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { formatterFor, type GuessHandle, type GuessSetup } from "../src/guess/handles";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class CapturingSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

/** One bar whose truth is 80 at stage 0 and 50 from stage 1 on. */
const bar = (truth: number): GuessHandle => ({
  part: "bar_2", shows: ["bar_2"], kind: "height", truth: [truth], min: 0, max: 100, step: 1, label: "B", format: formatterFor(1), unit: "", paths: ["values.0.1"],
});

function makePlayer(commands: Command[]) {
  const plan = planCommands(commands, ["axes", "bar_1", "bar_2"], {
    animateBase: { stage: 0, values: [[10, 80], [10, 50]] },
    guessParts: (on) => ({ parts: Array.isArray(on) ? on : [on], shows: ["bar_2"] }),
  });
  const speech = new CapturingSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
  const frames: Record<string, unknown>[] = [];
  const rp: Reprojector = { frame: (p) => void frames.push(p), commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: (_on, _from, params): GuessSetup => ({ handles: [bar(Number(params["stage"] ?? 0) >= 1 ? 50 : 80)], pin: {}, warnings: [] }),
    patch: (_s, values) => ({ params: { "values.0.1": values[0][0] } }),
  };
  player.guess = runtime;
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events, frames, speech, plan };
}

describe("predict", () => {
  test("the guess starts at the present; the animate runs from the guess to the truth after it", async () => {
    const { player, events, frames, speech } = makePlayer([
      { ask: { question: "Where?", on: "bar_2", predict: true, tolerance: 0.05, store: "p", right: "Yes {p} vs {p.true}.", wrong: "You said {p}; it is {p.true}." } },
      { animate: { stage: 1 }, duration: 0.2 },
    ]);
    let started: number[][] | null = null;
    player.askGate = async (_s, step) => {
      started = (step as unknown as { guess: GuessSession }).guess.start;
      return "60";
    };
    await player.play();
    expect(started).toEqual([[80]]); // the present
    expect(events[0]).toMatchObject({ expected: "50", correct: false });
    // The animate frames hold the stage-0 row at the guess while the stage moves.
    expect(frames.some((f) => f["values.0.1"] === 60 && typeof f["stage"] === "number" && (f["stage"] as number) > 0)).toBe(true);
    expect(speech.said.some((t) => t.includes("You said 60; it is 50."))).toBe(true);
  });
});

describe("reveal: false and revise", () => {
  test("the first guess is kept back; the second starts from it", async () => {
    const { player, events, speech } = makePlayer([
      { ask: { question: "First?", on: "bar_2", store: "g1", reveal: false } },
      { ask: { question: "Again?", on: "bar_2", revise: "g1", store: "g2", right: "From {g1} to {g2}, moved {g2.moved}; truth {g2.true}." } },
    ]);
    const starts: number[][][] = [];
    const answers = ["30", "78"];
    player.askGate = async (_s, step) => {
      starts.push((step as unknown as { guess: GuessSession }).guess.start);
      return answers.shift() ?? null;
    };
    await player.play();
    expect(starts[1]).toEqual([[30]]);
    // Only the revise is judged and reported; the kept-back guess is not an answer yet.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ given: ["78"], correct: true });
    expect(speech.said.some((t) => t.includes("From 30 to 78, moved 48; truth 80."))).toBe(true);
  });
});

describe("judge: false and budget", () => {
  test("an opinion: right is spoken whatever the guess, and it scores nothing", async () => {
    const { player, events, speech } = makePlayer([{ ask: { question: "Split?", on: "bar_2", judge: false, store: "a", right: "Here is what is done." } }]);
    player.askGate = async () => "5";
    await player.play();
    expect(events[0].correct).toBe(true);
    expect(speech.said.some((t) => t.includes("Here is what is done."))).toBe(true);
  });

  // The budget's account bar: tests/guess-account.test.ts (it replaced withBudget).
});
