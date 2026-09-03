import { describe, expect, test, vi } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

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
    frame: (p) => frames.push({ ...p }),
    commit: (p) => { commits.push({ ...p }); return new Map<string, RenderedElement>(); },
  };
  return { rp, frames, commits };
}

const BASE = { demand_shift: { amount: 0 } };

describe("the animate action", () => {
  test("interpolates from start to target, then commits the end state", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.1 }], [], { animateBase: BASE });
    const { rp, frames, commits } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const vals = frames.map((f) => f["demand_shift.amount"] as number);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(20);
    expect(vals[vals.length - 1]).toBeCloseTo(20, 5);
    expect(commits).toEqual([{ "demand_shift.amount": 20 }]);
    expect(player.state).toBe("done");
  });

  test("null start jumps straight to the target", async () => {
    const plan = planCommands([{ animate: { "tax.rate": 5 }, duration: 0.05 }], [], { animateBase: BASE });
    const { rp, frames } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames.every((f) => f["tax.rate"] === 5)).toBe(true);
  });

  test("narrated animate: voice and animation both must finish", async () => {
    const speech = new StubSpeech();
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.05, speak: "slide" }], [], { animateBase: BASE });
    const { rp, commits } = makeReprojector();
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
    player.reprojector = rp;
    const done = player.play();
    await new Promise((r) => setTimeout(r, 120)); // animation done, voice still open
    expect(player.state).toBe("playing");
    expect(commits.length).toBe(1); // action settled while the voice speaks
    speech.resolvers[0]();
    await done;
    expect(player.state).toBe("done");
  });

  test("scrubbing commits boundary params: back to 0 restores the original figure", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.05 }], [], { animateBase: BASE });
    const { rp, commits } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    player.renderUpTo(0);
    expect(commits[commits.length - 1]).toEqual({});
    player.renderUpTo(plan.steps.length);
    expect(commits[commits.length - 1]).toEqual({ "demand_shift.amount": 20 });
  });

  test("no reprojector: animate is a timed no-op, never a crash", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.02 }], [], { animateBase: BASE });
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    await player.play();
    expect(player.state).toBe("done");
  });

  test("abort mid-animate, then scrub to a boundary whose params already match: still commits (a stale mid-tween frame must never be left uncommitted)", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.3 }], [], { animateBase: BASE });
    const { rp, commits } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    const done = player.play();
    await new Promise((r) => setTimeout(r, 40)); // a few frame ticks into the 300ms animation, nowhere near done
    player.renderUpTo(0); // appliedParams is still {} here — a naive params-equality check would skip the commit
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[commits.length - 1]).toEqual({});
    await done;
  });

  test("redundant animate (same target as current params) still ends on a commit, not a trailing frame", async () => {
    const plan = planCommands(
      [
        { animate: { "demand_shift.amount": 20 }, duration: 0.05 },
        { animate: { "demand_shift.amount": 20 }, duration: 0.05 },
      ],
      [],
      { animateBase: BASE },
    );
    const { rp, commits } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(commits.length).toBe(2); // the second animate is a no-op in value but must still settle with its own commit
    expect(commits[1]).toEqual({ "demand_shift.amount": 20 });
  });

  test("commit→applyScene sequencing: an element returned by commit that is visible at the boundary gets finish() called (guards the 'later draws invisible' regression class)", async () => {
    const finishSpy = vi.fn();
    const hideSpy = vi.fn();
    const committedEl: RenderedElement = { id: "foo", durationMs: 0, setProgress() {}, finish: finishSpy, hide: hideSpy };
    const preElements = new Map<string, RenderedElement>([
      ["foo", { id: "foo", durationMs: 0, setProgress() {}, finish() {}, hide() {} }],
    ]);
    const rp: Reprojector = {
      frame: () => {},
      commit: () => new Map<string, RenderedElement>([["foo", committedEl]]),
    };
    const plan = planCommands(
      [{ draw: ["foo"] }, { animate: { "demand_shift.amount": 20 }, duration: 0.02 }],
      ["foo"],
      { animateBase: BASE },
    );
    const player = new Player(plan, preElements, new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(player.state).toBe("done");
    expect(finishSpy).toHaveBeenCalled();
    expect(hideSpy).not.toHaveBeenCalled();
  });

  test("multi-key passthrough: a second animate on a different key still carries the first key's settled value on every frame", async () => {
    const plan = planCommands(
      [
        { animate: { "demand_shift.amount": 20 }, duration: 0.02 },
        { animate: { "tax.rate": 5 }, duration: 0.05 },
      ],
      [],
      { animateBase: BASE },
    );
    const { rp, frames } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    const secondKeyFrames = frames.filter((f) => "tax.rate" in f);
    expect(secondKeyFrames.length).toBeGreaterThan(0);
    for (const f of secondKeyFrames) {
      expect(f["demand_shift.amount"]).toBe(20);
    }
  });

  // tests/animate-easing.test.ts pins that an explicit `easing` reaches the
  // PlanStep, but the plan never evaluates a curve — the actual smoothstep
  // vs. linear math only runs here, in the player. Smoothstep's derivative is
  // 0 at t=0 (it eases IN), so its earliest frame sits far below the
  // elapsed-time fraction; linear tracks that fraction exactly. This is the
  // property a thirty-second race depends on `easing: "linear"` for.
  test("explicit `easing: linear` actually changes the curve the player drives, not just the plan step", async () => {
    const firstNonZeroFrame = async (extra: Record<string, unknown>) => {
      const plan = planCommands([{ animate: { "demand_shift.amount": 100 }, duration: 0.3, ...extra }], [], { animateBase: BASE });
      const { rp, frames } = makeReprojector();
      const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
      player.reprojector = rp;
      await player.play();
      const hit = frames.find((f) => (f["demand_shift.amount"] as number) > 0);
      return hit!["demand_shift.amount"] as number;
    };
    const smoothstepFirst = await firstNonZeroFrame({});
    const linearFirst = await firstNonZeroFrame({ easing: "linear" });
    expect(smoothstepFirst).toBeLessThan(linearFirst * 0.5);
  });
});
