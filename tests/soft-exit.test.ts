// The playlist's soft exit: instead of a hard DOM teardown between items, the
// finished drawing un-draws itself. fadeOutAll is the player-level primitive;
// the clear verb's floor keeps instant elements (text) from vanishing in 0 ms.

import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class Silent extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

function fakeEl(id: string, durationMs: number): RenderedElement & { log: number[] } {
  const log: number[] = [];
  return {
    id,
    durationMs,
    log,
    setProgress: (t: number) => log.push(t),
    finish: () => log.push(1),
    hide: () => {},
  };
}

describe("Player.fadeOutAll — the playlist's soft exit", () => {
  test("un-draws what is visible; hidden elements stay untouched", async () => {
    const a = fakeEl("a", 100);
    const b = fakeEl("b", 100);
    const plan = planCommands([{ draw: ["a", "b"] }, { hide: ["b"] }], ["a", "b"]);
    const player = new Player(
      plan,
      new Map<string, RenderedElement>([
        ["a", a],
        ["b", b],
      ]),
      new Silent(),
      null,
      { mode: "silent" },
    );
    player.renderUpTo(plan.steps.length);
    a.log.length = 0;
    b.log.length = 0;
    await player.fadeOutAll(30);
    expect(a.log.at(-1)).toBe(0); // fully un-drawn
    expect(a.log.length).toBeGreaterThan(1); // animated, not snapped
    expect(b.log).toEqual([]); // was hidden — untouched
  });
});

describe("clear — instant elements still fade out", () => {
  test("a zero-duration element gets a real fade on clear, not a snap", async () => {
    const t = fakeEl("t", 0);
    const u = fakeEl("u", 0);
    // Something is drawn AFTER the clear: a clear that would end the drawcast
    // on an empty stage is not performed at all — the last frame holds
    // (tests/player-hold-frame.test.ts) — so the fade under test needs a
    // clear in the middle of the story.
    const plan = planCommands([{ show: ["t"] }, { clear: {} }, { show: ["u"] }], ["t", "u"]);
    const player = new Player(
      plan,
      new Map<string, RenderedElement>([
        ["t", t],
        ["u", u],
      ]),
      new Silent(),
      null,
      { mode: "silent" },
    );
    await player.play();
    expect(t.log.filter((v) => v > 0 && v < 1).length).toBeGreaterThan(0);
    expect(t.log.at(-1)).toBe(0);
  });
});
