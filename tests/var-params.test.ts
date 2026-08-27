import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player, type Reprojector } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";
import type { RenderedElement } from "../src/render/backend";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class StubSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

function makeReprojector() {
  const frames: Record<string, number>[] = [];
  const commits: Record<string, number>[] = [];
  const rp: Reprojector = {
    frame: (p) => frames.push({ ...p }),
    commit: (p) => {
      commits.push({ ...p });
      return new Map<string, RenderedElement>();
    },
  };
  return { rp, frames, commits };
}

const ASK_N: Command = { ask: { question: "How many?", store: "n_choice", default: "20" } };
const VAR_ANIMATE: Command = { animate: { n: "{n_choice}" }, duration: 0.05 };
const BASE = { n: 4 };

describe("var-animate validation", () => {
  const spec = (commands: object[]) => ({
    elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
    commands,
  });

  test("a var token referencing an earlier stored ask passes", () => {
    expect(validateSpec(spec([ASK_N as object, { animate: { n: "{n_choice}" } }])).ok).toBe(true);
  });

  test("a junk string value fails", () => {
    expect(validateSpec(spec([{ animate: { n: "sixty" } }])).ok).toBe(false);
  });

  test("a token with no earlier storing ask fails", () => {
    expect(validateSpec(spec([{ animate: { n: "{n_choice}" } }])).ok).toBe(false);
  });
});

describe("var-animate planning", () => {
  test("the fallback comes from the ask's default; varTargets carries the name", () => {
    const plan = planCommands([ASK_N, VAR_ANIMATE], [], { animateBase: BASE });
    const s = plan.steps.find((st) => st.kind === "animate");
    if (s?.kind !== "animate") throw new Error("no animate step");
    expect(s.targets).toEqual({ n: 20 });
    expect(s.varTargets).toEqual({ n: "n_choice" });
  });

  test("a non-numeric default drops the target with a warning", () => {
    const plan = planCommands(
      [{ ask: { question: "Name?", store: "who", default: "friend" } }, { animate: { n: "{who}" } }],
      [],
      { animateBase: BASE },
    );
    expect(plan.steps.filter((s) => s.kind === "animate")).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("{who}"))).toBe(true);
  });
});

describe("var-animate at runtime", () => {
  function makePlayer(commands: Command[]) {
    const plan = planCommands(commands, [], { animateBase: BASE });
    return new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
  }

  test("the tween ends at the typed value and scrubbing forward keeps it", async () => {
    const player = makePlayer([ASK_N, VAR_ANIMATE]);
    const { rp, commits } = makeReprojector();
    player.reprojector = rp;
    player.askGate = async () => "60";
    await player.play();
    expect(commits.at(-1)).toEqual({ n: 60 }); // the settle commit honors the answer
    player.renderUpTo(player.totalSteps);
    expect(commits.at(-1)).toEqual({ n: 60 }); // scrub keeps the personalization
    player.renderUpTo(0);
    expect(commits.at(-1)).toEqual({}); // before the animate, untouched
  });

  test("no answer (bare player): the default drives it", async () => {
    const player = makePlayer([ASK_N, VAR_ANIMATE]);
    const { rp, commits } = makeReprojector();
    player.reprojector = rp;
    await player.play();
    expect(commits.at(-1)).toEqual({ n: 20 });
  });

  test("a non-numeric answer degrades to the fallback", async () => {
    const player = makePlayer([ASK_N, VAR_ANIMATE]);
    const { rp, commits } = makeReprojector();
    player.reprojector = rp;
    player.askGate = async () => "plenty";
    await player.play();
    expect(commits.at(-1)).toEqual({ n: 20 });
  });
});
