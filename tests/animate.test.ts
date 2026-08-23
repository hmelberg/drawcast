import { describe, expect, test } from "vitest";
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
  const frames: Record<string, number>[] = [];
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
    const vals = frames.map((f) => f["demand_shift.amount"]);
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
});
