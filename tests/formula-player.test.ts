import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";

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
const box = { x: 100, y: 100, w: 200, h: 40 };

/** A RenderedElement stub that logs every finish()/hide() call, so a test can
 *  tell which one a scrub actually invoked on a given id. */
function loggingHandle(id: string): RenderedElement & { log: string[] } {
  const log: string[] = [];
  return {
    id,
    durationMs: 0,
    setProgress() {},
    finish() {
      log.push("finish");
    },
    hide() {
      log.push("hide");
    },
    setOffset() {},
    log,
  };
}

describe("formula morph in the player", () => {
  test("a tex morph tweens with math.t from 0 to 1 in the frame overrides and commits once with the new tex", async () => {
    const plan = planCommands([{ draw: ["eq"] }, { morph: { target: "eq", tex: "2x = 8", duration: 0.1 } }], ["eq"], {
      bboxOf: () => box,
      mathOf: () => "2x + 3 = 11",
      isElement: () => true,
      bboxesFor: () => () => box,
    });
    const { rp, frames, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    const ts = frames.map((f) => (f.overrides as { math: { eq: { t: number; from: string; tex: string } } }).math.eq);
    expect(ts[0].from).toBe("2x + 3 = 11");
    expect(ts[ts.length - 1].t).toBeCloseTo(1, 5);
    expect(Math.min(...ts.map((x) => x.t))).toBeLessThan(0.5);
    expect(commits).toHaveLength(1);
    expect((commits[0].overrides as { math: { eq: { tex: string; t?: number } } }).math.eq).toEqual({ tex: "2x = 8" });
  });
  test("a copy step commits the boundary key (the copy in it) and shows the id; a scrub back drops it", () => {
    const plan = planCommands([{ draw: ["eq"] }, { copy: { target: "eq" } }], ["eq"], { bboxOf: () => box, isElement: () => true, bboxesFor: () => () => box });
    const { rp, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    player.renderUpTo(2);
    expect((commits[0].overrides as { copies: Record<string, string> }).copies).toEqual({ eq_copy: "eq" });
    player.renderUpTo(1);
    expect(commits[1].overrides).toBeUndefined();
  });
  test("an erase on a copy stays erased at the next boundary instead of reappearing (review finding 1, 2026-09-10)", () => {
    const plan = planCommands(
      [{ draw: ["eq"] }, { copy: { target: "eq", as: "eq2" } }, { erase: ["eq2"] }, { copy: { target: "eq", as: "eq3" } }],
      ["eq"],
      { bboxOf: () => box, isElement: () => true, bboxesFor: () => () => box },
    );
    const handles = new Map<string, RenderedElement & { log: string[] }>([
      ["eq", loggingHandle("eq")],
      ["eq2", loggingHandle("eq2")],
      ["eq3", loggingHandle("eq3")],
    ]);
    const rp: Reprojector = {
      frame: () => {},
      commit: () => new Map(handles),
    };
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    player.renderUpTo(4);
    // eq2 was erased and must stay hidden, not be resurrected by finish()
    // (a copy id never lived in the plan-time mounted layout, so it used to
    // fall through the "minted by a param change" escape hatch every time).
    expect(handles.get("eq2")!.log.at(-1)).toBe("hide");
    expect(handles.get("eq")!.log.at(-1)).toBe("finish");
    expect(handles.get("eq3")!.log.at(-1)).toBe("finish");
  });
});
