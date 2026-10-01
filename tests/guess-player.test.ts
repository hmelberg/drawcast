import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent, type GuessRuntime, type Reprojector } from "../src/render/player";
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

const handle: GuessHandle = {
  part: "bar_2",
  shows: ["bar_2"],
  kind: "height",
  truth: [80],
  min: 0,
  max: 100,
  step: 1,
  label: "Norway",
  format: formatterFor(1),
  unit: "",
  paths: ["values.1"],
};

function makePlayer(commands: Command[]) {
  const plan = planCommands(commands, ["axes", "bar_1", "bar_2"], {
    guessParts: (on) => ({ parts: Array.isArray(on) ? on : [on], shows: ["bar_2"] }),
  });
  const speech = new CapturingSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
  const frames: Record<string, unknown>[] = [];
  const rp: Reprojector = {
    frame: (params) => {
      frames.push(params);
    },
    commit: () => new Map(),
    committed: () => null,
  };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: (): GuessSetup => ({ handles: [handle], pin: {}, warnings: [] }),
    patch: (_setup, values) => ({ params: { "values.1": values[0][0] } }),
  };
  player.guess = runtime;
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events, frames, speech, plan };
}

const ASK: Command = {
  ask: {
    question: "How much?",
    on: "bar_2",
    store: "g",
    right: "Close: {g} against {g.true}.",
    wrong: "You said {g}; it is {g.true}, {g.off} off.",
  },
};

describe("guess asks in the player", () => {
  test("the plan carries on and reveals the guessed part after the question", () => {
    const { plan } = makePlayer([ASK]);
    const step = plan.steps[0];
    expect(step.kind).toBe("ask");
    expect((step as { on?: string[] }).on).toEqual(["bar_2"]);
    expect(plan.states[0].visible).toContain("bar_2");
  });

  test("a live guess: scored, stored, the reveal tweens guess → truth, wrong spoken with the gap", async () => {
    const { player, events, frames, speech } = makePlayer([ASK]);
    player.askGate = async () => "40";
    await player.play();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "ask", given: ["40"], expected: "80", correct: false });
    // Painted at the start, then from 40 up to 80.
    const painted = frames.map((f) => f["values.1"]).filter((v): v is number => typeof v === "number");
    expect(painted[1]).toBeCloseTo(40, 0);
    expect(painted[painted.length - 1]).toBeCloseTo(80);
    expect(speech.said.some((t) => t.includes("You said 40; it is 80, 40 off."))).toBe(true);
  });

  test("a close guess speaks right", async () => {
    const { player, events, speech } = makePlayer([ASK]);
    player.askGate = async () => "75";
    await player.play();
    expect(events[0].correct).toBe(true);
    expect(speech.said.some((t) => t.includes("Close: 75 against 80."))).toBe(true);
  });

  test("a skip is a miss and the truth is still revealed", async () => {
    const { player, events, frames } = makePlayer([ASK]);
    player.askGate = async () => null;
    await player.play();
    expect(events[0]).toMatchObject({ correct: false, given: [] });
    const painted = frames.map((f) => f["values.1"]).filter((v): v is number => typeof v === "number");
    expect(painted[painted.length - 1]).toBeCloseTo(80);
  });

  test("a movie demonstrates the default and never waits", async () => {
    const { player, events, frames } = makePlayer([{ ask: { ...ASK.ask!, default: "60" } }]);
    let asked = false;
    player.askGate = async () => {
      asked = true;
      return "1";
    };
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await player.play();
    expect(asked).toBe(false);
    expect(events).toHaveLength(0); // movies report no viewer answers
    const painted = frames.map((f) => f["values.1"]).filter((v): v is number => typeof v === "number");
    expect(painted.some((v) => Math.abs(v - 60) < 0.5)).toBe(true);
  });
});
