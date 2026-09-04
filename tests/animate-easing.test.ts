// The animate verb's pacing. Two things are pinned: an explicit easing
// reaches the plan (and absent stays today's smoothstep), and a narrated
// animate tweens UNDER its narration rather than after it — the property a
// thirty-second race depends on, which nothing pinned before.

import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { EASINGS } from "../src/render/effects";
import { Player, type Reprojector } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import type { Command } from "../src/spec/types";

const plan = (cmd: Command) => planCommands([cmd], ["fig"], { bboxOf: () => null, animateBase: { stage: 0 } });

describe("animate easing", () => {
  test("an explicit easing reaches the step", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10, easing: "linear" }).steps[0];
    expect(step).toMatchObject({ kind: "animate", easing: "linear" });
  });

  test("no easing leaves the step's easing undefined (the smoothstep default)", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10 }).steps[0];
    expect((step as { easing?: string }).easing).toBeUndefined();
  });

  test("linear is the identity, so a race runs at constant speed", () => {
    expect(EASINGS.linear(0.25)).toBeCloseTo(0.25, 6);
    expect(EASINGS.linear(0.75)).toBeCloseTo(0.75, 6);
  });
});

// node has no rAF; drive Player.progress with a timer-based stand-in — the
// same stand-in and the same two stubs tests/animate.test.ts uses to drive a
// real Player without a DOM.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

/** A voice that never finishes on its own: the test decides when it resolves. */
class StubSpeech extends SpeechManager {
  resolvers: (() => void)[] = [];
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return new Promise((res) => this.resolvers.push(res)); }
  override cancel(): void {}
}

function makeReprojector() {
  const frames: Record<string, unknown>[] = [];
  const commits: Record<string, number>[] = [];
  const rp: Reprojector = {
    frame: (p) => {
      frames.push({ ...p });
    },
    commit: (p) => { commits.push({ ...p }); return new Map<string, RenderedElement>(); },
  };
  return { rp, frames, commits };
}

describe("narrated animate", () => {
  test("the narration rides on the animate step, so the prelude runs them together", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10, speak: "Watch the 80s." }).steps[0];
    expect(step).toMatchObject({ kind: "animate", narration: "Watch the 80s." });
    expect(plan({ animate: { stage: 3 }, speak: "x" }).steps.filter((s) => s.kind === "speak")).toEqual([]);
  });

  // The plan-shape check above is necessary and not sufficient: it says the
  // narration is CARRIED on the animate step, not that the player starts the
  // tween without waiting for the voice. The named risk in §7.2 — "a future
  // edit to the barrier would silently serialize every narrated race" — lives
  // entirely in the player's narrated-action prelude (src/render/player.ts:
  // `await this.narrationBarrier()` then `Promise.all([runAction, voice])`),
  // so the guard has to run the player. It does, against a voice that never
  // finishes by itself: if the prelude were made sequential (await the voice,
  // then the action), no frame and no commit could exist at the checkpoint
  // below, because nothing has resolved the speech yet. Verified by making
  // the prelude sequential: this test fails, the plan-shape test above does
  // not notice.
  test("the tween actually runs UNDER the narration: frames land while the voice is still open", async () => {
    const speech = new StubSpeech();
    const p = planCommands(
      [{ animate: { "demand_shift.amount": 20 }, duration: 0.05, speak: "Watch the 80s." }],
      [],
      { animateBase: { demand_shift: { amount: 0 } } },
    );
    const { rp, frames, commits } = makeReprojector();
    const player = new Player(p, new Map(), speech, null, { mode: "narrated" });
    player.reprojector = rp;
    const done = player.play();
    // Well past the 50 ms tween, and the voice has NOT been resolved.
    await new Promise((r) => setTimeout(r, 150));
    expect(speech.resolvers.length, "the voice was started").toBe(1);
    expect(player.state, "still playing: the step waits for the voice too").toBe("playing");
    expect(frames.length, "reprojection frames landed before the voice resolved").toBeGreaterThan(0);
    expect(commits, "and the tween settled on its target while the voice speaks").toEqual([{ "demand_shift.amount": 20 }]);
    // Both halves must finish before the step does — the other half of the
    // same promise, so a race that ends early is caught here as well.
    speech.resolvers[0]();
    await done;
    expect(player.state).toBe("done");
  });
});
