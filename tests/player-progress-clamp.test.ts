// An animation frame stamped before the animation began (rAF's time is the
// frame's start) must not drive progress below 0: a 0.01 s heading zoom got
// p ≈ −4.8, eased to 46, and a negative SVG viewBox (course lecture 4).

import { expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";

class QuietSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

test("progress stays within 0..1 when the first frame is stamped early", async () => {
  const plan = planCommands([], [], {});
  const p = new Player(plan, new Map(), new QuietSpeech(), null, { mode: "narrated", breath: false });
  let first = true;
  p.raf = (cb) =>
    void setTimeout(() => {
      const now = performance.now();
      cb(first ? now - 500 : now + 4);
      first = false;
    }, 1);
  const seen: number[] = [];
  const run = (p as unknown as { progress(ms: number, s: AbortSignal, f: (t: number) => void): Promise<void> }).progress.bind(p);
  await run(10, new AbortController().signal, (t) => void seen.push(t));
  expect(seen.length).toBeGreaterThan(0);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
  expect(seen[seen.length - 1]).toBe(1);
});
