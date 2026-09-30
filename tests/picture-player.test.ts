// Final fix I5: a box highlight on several places draws one box per place,
// not one box around them all — the player paints each id on its own.
import { expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import { FULL_VIEW4 } from "../src/spec/places";

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

const rect = { x: 100, y: 300, w: 400, h: 200 };
const regions = { left: [0, 0, 0.5, 1] as [number, number, number, number], bottom: [0, 0.9, 1, 0.1] as [number, number, number, number] };
const opts = {
  bboxOf: (id: string) => (id === "md" ? rect : id === "t" ? { x: 0, y: 0, w: 10, h: 10 } : null),
  pictureOf: (id: string) => (id === "md" ? { frame: { rect, view: FULL_VIEW4 }, regions } : null),
};

test("highlight on two places: each painted with its own box, each ended", async () => {
  const plan = planCommands([{ draw: ["md"] }, { highlight: { target: ["md:left", "md:bottom"], duration: 0.3 } }] as never, ["md", "t"], opts as never);
  const painted: { ids: string[]; box: unknown }[] = [];
  const ended: string[][] = [];
  const effects = {
    setHighlight: (ids: string[], _e: string, _level: number, box: unknown) => painted.push({ ids, box }),
    endHighlight: (ids: string[]) => ended.push(ids),
    setPointer: () => undefined,
    setCamera: () => undefined,
  };
  await new Player(plan, new Map(), new SilentSpeech(), null, { mode: "narrated", breath: false, effects: effects as never }).play();
  const left = painted.filter((p) => p.ids.join() === "md:left");
  const bottom = painted.filter((p) => p.ids.join() === "md:bottom");
  expect(left.length).toBeGreaterThan(0);
  expect(bottom.length).toBeGreaterThan(0);
  expect(painted.every((p) => p.ids.length === 1)).toBe(true);
  expect(left[0].box).toEqual({ x: 100, y: 300, w: 200, h: 200 });
  expect((bottom[0].box as { h: number }).h).toBeCloseTo(20, 5);
  expect(ended).toContainEqual(["md:left"]);
  expect(ended).toContainEqual(["md:bottom"]);
});
