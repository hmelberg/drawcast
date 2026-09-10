import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { INITIAL_STATE, planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import { moveFrame, morphFrame, transformFrame } from "../src/render/tween";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class StubSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}
function stub() {
  const frames: { params: Record<string, unknown>; overrides: unknown; offsets: Record<string, unknown>; trailProgress?: Record<string, number> }[] = [];
  const commits: { params: Record<string, number>; overrides: unknown }[] = [];
  const rp: Reprojector = {
    frame: (params, scene, opts) => {
      frames.push({ params: { ...params }, overrides: opts?.overrides, offsets: { ...scene.offsets }, trailProgress: opts?.trailProgress });
    },
    commit: (params, overrides) => {
      commits.push({ params: { ...params }, overrides });
      return new Map<string, RenderedElement>();
    },
  };
  return { rp, frames, commits };
}
const box = { x: 100, y: 100, w: 50, h: 50 };
const opts = { bboxOf: () => box, dependentsOf: (id: string) => (id === "d" ? ["eq"] : []), sourceIds: ["d"], bboxesFor: () => () => box };

describe("tween helpers", () => {
  test("moveFrame, transformFrame and morphFrame interpolate", () => {
    expect(moveFrame({ ids: ["d"], path: [[0, 0], [10, 20]] }, INITIAL_STATE, 0.5)).toEqual({ d: [5, 10] });
    const t = transformFrame([{ id: "d", from: { offset: [0, 0], turn: { deg: 0, pivot: [0, 0] } }, to: { offset: [10, 0], turn: { deg: 90, pivot: [0, 0] } } }], 0.5);
    expect(t.offsets.d).toEqual([5, 0]);
    expect(t.turns.d.deg).toBe(45);
    expect(t.squash).toEqual({});
    const f = transformFrame([{ id: "d", from: { offset: [0, 0], turn: { deg: 0, pivot: [0, 0] } }, to: { offset: [0, 0], turn: { deg: 180, pivot: [0, 0], mirror: true } }, flip: { at: [0, 0], angle: 90 } }], 0.25);
    expect(f.turns.d.deg).toBe(0);
    expect(f.squash.d).toEqual({ at: [0, 0], angle: 90, k: 0.5 });
    expect(morphFrame([{ id: "d", leaves: [{ leafId: "d", from: [[0, 0]], to: [[10, 10]] }] }], INITIAL_STATE, 0.5)).toEqual({ d: { d: [[5, 5]] } });
  });
});

describe("relayout steps in the player", () => {
  test("a move with dependents tweens through the reprojector with the pose in the overrides, then commits the boundary key once", async () => {
    const plan = planCommands([{ draw: ["d", "eq"] }, { move: { target: "d", by: [40, 0], duration: 0.1 } }], ["d", "eq"], opts);
    const { rp, frames, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const xs = frames.map((f) => (f.overrides as { poses: { d: { offset: [number, number] } } }).poses.d.offset[0]);
    expect(Math.max(...xs)).toBeCloseTo(40, 5);
    expect(Math.min(...xs)).toBeLessThan(40);
    for (const [i, f] of frames.entries()) expect((f.offsets.d as [number, number])[0]).toBe(xs[i]);
    expect(commits).toHaveLength(1);
    expect((commits[0].overrides as { poses: { d: { offset: [number, number] } } }).poses.d.offset).toEqual([40, 0]);
    expect(player.state).toBe("done");
  });
  test("a plain move never calls the reprojector", async () => {
    const plan = planCommands([{ draw: ["n"] }, { move: { target: "n", by: [40, 0], duration: 0.05 } }], ["n"], opts);
    const { rp, frames, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames).toEqual([]);
    expect(commits).toEqual([]);
  });
  test("scrubbing across a relayout boundary commits exactly when the key changes", () => {
    const plan = planCommands([{ draw: ["d", "eq"] }, { move: { target: "d", by: [40, 0] } }, { draw: ["n"] }, { move: { target: "n", by: [1, 1] } }], ["d", "eq", "n"], opts);
    const { rp, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    player.renderUpTo(1);
    expect(commits).toHaveLength(0);
    player.renderUpTo(2);
    expect(commits).toHaveLength(1);
    player.renderUpTo(4); // n moved: not a source → same key
    expect(commits).toHaveLength(1);
    player.renderUpTo(0);
    expect(commits).toHaveLength(2);
    expect(commits[1].overrides).toBeUndefined();
  });
  test("an animate with a trail hands the trail's progress to every frame, ending at 1", async () => {
    // The traced point has to move, or the trail has no length to advance along.
    const anchorsAt = (params: Record<string, number>) => (id: string) => (id === "p" ? ([500 + 100 * (params["vars.t"] ?? 0), 375] as [number, number]) : null);
    const plan = planCommands([{ draw: ["p"] }, { animate: { t: 1 }, trail: { of: "p" }, duration: 0.05 }], ["p"], { varsBase: { t: 0 }, animateBase: null, anchorsAt, bboxOf: () => box });
    const { rp, frames } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    const progress = frames.map((f) => f.trailProgress?.p_trail ?? -1);
    expect(progress.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
