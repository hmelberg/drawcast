// The viewer's paused view (ui/view-pan.ts) lives on the player: over the
// plan's camera while paused, refused while playing, handed back on play.
import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { BackendEffects, RenderedElement } from "../src/render/backend";
import type { BBox } from "../src/layout/geometry";
import { restView } from "../src/render/camera";

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

const el = (id: string): RenderedElement => ({ id, durationMs: 0, setProgress: () => {}, finish: () => {}, hide: () => {} });

function setup(world?: BBox) {
  const cams: (BBox | null)[] = [];
  const effects = { setHighlight: () => {}, clearHighlight: () => {}, setPointer: () => {}, setCamera: (b: BBox | null) => cams.push(b) } as unknown as BackendEffects;
  const plan = planCommands([{ draw: ["a"] }, { camera: { zoom: 2, duration: 0.01 } }, { draw: ["b"] }], ["a", "b"], {
    bboxOf: () => ({ x: 400, y: 300, w: 50, h: 50 }),
    ...(world ? { world } : {}),
  });
  const player = new Player(plan, new Map([["a", el("a")], ["b", el("b")]]), new Silent(), null, { mode: "silent", effects, world });
  return { player, cams, plan };
}

describe("Player view camera", () => {
  test("paused, the viewer's view is shown over the plan's and reported", () => {
    const { player, cams } = setup();
    player.renderUpTo(2);
    const seen: (BBox | null)[] = [];
    player.onViewChange((b) => seen.push(b));
    const v = { x: 10, y: 10, w: 200, h: 150 };
    expect(player.setViewCamera(v)).toBe(true);
    expect(player.viewCamera).toEqual(v);
    expect(cams.at(-1)).toEqual(v);
    expect(seen.at(-1)).toEqual(v);
    // null puts the plan's camera back — the zoom-2 box.
    player.setViewCamera(null);
    expect(cams.at(-1)).toEqual(player.planCamera);
    expect(player.planCamera.w).toBe(500);
  });
  test("a scrub hands the screen back to the plan", () => {
    const { player } = setup();
    player.renderUpTo(1);
    player.setViewCamera({ x: 10, y: 10, w: 200, h: 150 });
    player.renderUpTo(2);
    expect(player.viewCamera).toBeNull();
  });
  test("play glides back to the plan's camera before stepping on", async () => {
    const { player, cams } = setup();
    player.renderUpTo(1);
    const v = { x: 10, y: 10, w: 200, h: 150 };
    player.setViewCamera(v);
    await player.play();
    expect(player.viewCamera).toBeNull();
    // It moved through in-between boxes (a glide, not a snap).
    const i = cams.indexOf(v);
    const next = cams.slice(i + 1, i + 3);
    expect(next.length).toBe(2);
    expect(next.every((b) => b !== null && b.w > 200 && b.w < 1000)).toBe(true);
    expect(player.state).toBe("done");
  });
  test("refused while playing", () => {
    const { player } = setup();
    void player.play();
    expect(player.setViewCamera({ x: 0, y: 0, w: 100, h: 75 })).toBe(false);
    player.pause();
  });
  test("with a world the rest box is the world's fit", () => {
    const world = { x: 0, y: -375, w: 3000, h: 1125 };
    const { player } = setup(world);
    expect(player.restBox).toEqual(restView(world));
    player.renderUpTo(0);
    expect(player.planCamera).toEqual(restView(world));
  });
});
