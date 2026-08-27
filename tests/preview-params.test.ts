// Slider preview must paint boundary+overrides via reprojector.frame and mark
// geometry dirty so renderUpTo(position) commits the boundary back even though
// its params compare equal (the stuck-preview regression class).
import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";

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

const BASE = { demand_shift: { amount: 0 } };

function fakeElement(id: string): RenderedElement {
  return { id, durationMs: 0, setProgress: () => {}, finish: () => {}, hide: () => {} } as unknown as RenderedElement;
}

function makePlayer() {
  const plan = planCommands([{ draw: ["demand"] }], ["demand"], { animateBase: BASE });
  return new Player(plan, new Map([["demand", fakeElement("demand")]]), new StubSpeech(), null, { mode: "silent" });
}

describe("previewParams", () => {
  test("paints boundary params merged with overrides", () => {
    const player = makePlayer();
    const { rp, frames } = makeReprojector();
    player.reprojector = rp;
    player.renderUpTo(1);
    player.previewParams({ "demand_shift.amount": 40 });
    expect(frames.at(-1)).toEqual({ "demand_shift.amount": 40 });
  });

  test("renderUpTo(position) after a preview commits the boundary back", () => {
    const player = makePlayer();
    const { rp, commits } = makeReprojector();
    player.reprojector = rp;
    player.renderUpTo(1);
    const before = commits.length;
    player.previewParams({ "demand_shift.amount": 40 });
    player.renderUpTo(player.position);
    expect(commits.length).toBe(before + 1); // dirty flag forced the commit
    expect(commits.at(-1)).toEqual({}); // boundary has no overrides
  });

  test("no reprojector: previewParams is a no-op", () => {
    const player = makePlayer();
    expect(() => player.previewParams({ x: 1 })).not.toThrow();
  });
});
