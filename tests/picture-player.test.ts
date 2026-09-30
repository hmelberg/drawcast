// Spec §13: a box highlight on several places is ONE box mark on the picture
// that travels from place to place — not one box around them all.
import { expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { MarkFrame } from "../src/render/marks";
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

test("a box highlight on two places: one box mark visiting each place, no highlight painted, ended once", async () => {
  const plan = planCommands([{ draw: ["md"] }, { highlight: { target: ["md:left", "md:bottom"], effect: "box", duration: 1.2 } }] as never, ["md", "t"], opts as never);
  const highlighted: string[][] = [];
  const marks: MarkFrame[] = [];
  const ended: string[] = [];
  const effects = {
    setHighlight: (ids: string[]) => highlighted.push(ids),
    endHighlight: () => undefined,
    setMark: (_owner: string, f: MarkFrame) => marks.push(f),
    endMark: (owner: string) => ended.push(owner),
    setPointer: () => undefined,
    setCamera: () => undefined,
  };
  await new Player(plan, new Map(), new SilentSpeech(), null, { mode: "narrated", breath: false, effects: effects as never }).play();
  expect(highlighted).toEqual([]);
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every((f) => f.kind === "box")).toBe(true);
  expect(marks.some((f) => JSON.stringify(f.box) === JSON.stringify({ x: 100, y: 300, w: 200, h: 200 }))).toBe(true);
  expect(marks.some((f) => f.box.w === 400 && Math.abs(f.box.h - 20) < 1e-6)).toBe(true);
  expect(ended).toEqual(["md"]);
});
