// A drawcast that ends by wiping the stage — a trailing clear, an erase of
// the last thing drawn — used to end on nothing: the poster (the finished
// figure, controls.ts) was blank, and so was the frame the viewer was left
// looking at when the narration stopped. The player round's rule: the last
// frame holds whatever was on screen. The plan knows where that frame is
// (heldFrom / sceneAt), and the player paints it for every boundary past
// it — scrubs, the poster, the end of a live run alike.
import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { heldFrom, planCommands, sceneAt } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class SilentSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

/** An element that remembers whether it is drawn. */
function fakeElement(id: string): RenderedElement & { drawn: boolean } {
  return {
    id,
    durationMs: 10,
    drawn: false,
    setProgress(t: number) {
      this.drawn = t > 0;
    },
    finish() {
      this.drawn = true;
    },
    hide() {
      this.drawn = false;
    },
  };
}

function makePlayer(commands: Command[], ids: string[]) {
  const elements = new Map(ids.map((id) => [id, fakeElement(id)] as const));
  const player = new Player(planCommands(commands, ids), elements, new SilentSpeech(), null, { mode: "silent" });
  return { player, elements };
}

const IDS = ["axis", "curve"];

describe("heldFrom / sceneAt", () => {
  test("a plan that ends with something on screen holds nothing", () => {
    const plan = planCommands([{ show: ["axis"] }, { show: ["curve"] }], IDS);
    expect(heldFrom(plan)).toBeNull();
    expect(sceneAt(plan, plan.steps.length).visible).toEqual(["axis", "curve"]);
  });

  test("a trailing clear holds the frame before it", () => {
    const plan = planCommands([{ show: ["axis"] }, { show: ["curve"] }, { clear: {} }, { speak: "The end." }], IDS);
    expect(heldFrom(plan)).toBe(2);
    // Every boundary past the held one paints it — the clear's and the speak's.
    expect(sceneAt(plan, 3).visible).toEqual(["axis", "curve"]);
    expect(sceneAt(plan, 4).visible).toEqual(["axis", "curve"]);
    // Boundaries before it are untouched.
    expect(sceneAt(plan, 1).visible).toEqual(["axis"]);
    expect(sceneAt(plan, 0).visible).toEqual([]);
  });

  test("a clear in the middle still clears — only the END is held", () => {
    const plan = planCommands([{ show: ["axis"] }, { clear: {} }, { show: ["curve"] }], IDS);
    expect(heldFrom(plan)).toBeNull();
    expect(sceneAt(plan, 2).visible).toEqual([]);
  });

  test("a plan that never draws anything holds nothing", () => {
    const plan = planCommands([{ speak: "Only words." }], IDS);
    expect(heldFrom(plan)).toBeNull();
  });
});

describe("the player paints the held frame", () => {
  test("the poster shows the last drawn frame, not the wiped stage", () => {
    const { player, elements } = makePlayer([{ show: ["axis"] }, { show: ["curve"] }, { clear: {} }], IDS);
    player.showPoster();
    expect(player.state).toBe("done");
    expect(elements.get("axis")!.drawn).toBe(true);
    expect(elements.get("curve")!.drawn).toBe(true);
  });

  test("a live run ends with the drawing still up", async () => {
    const { player, elements } = makePlayer([{ show: ["axis"] }, { show: ["curve"] }, { clear: {} }, { erase: ["axis"] }], IDS);
    await player.play();
    expect(player.state).toBe("done");
    expect(elements.get("axis")!.drawn).toBe(true);
    expect(elements.get("curve")!.drawn).toBe(true);
  });

  test("a mid-run clear still wipes: the hold is for the end only", async () => {
    const { player, elements } = makePlayer([{ show: ["axis"] }, { clear: {} }, { show: ["curve"] }], IDS);
    await player.play();
    expect(elements.get("axis")!.drawn).toBe(false);
    expect(elements.get("curve")!.drawn).toBe(true);
  });

  test("scrubbing back to the start still empties the stage", () => {
    // One element only: the planner draws every element the commands never
    // mention at the END, which would put something on screen after the clear.
    const { player, elements } = makePlayer([{ show: ["axis"] }, { clear: {} }], ["axis"]);
    player.showPoster();
    expect(elements.get("axis")!.drawn).toBe(true);
    player.renderUpTo(0);
    expect(player.state).toBe("idle");
    expect(elements.get("axis")!.drawn).toBe(false);
  });
});
