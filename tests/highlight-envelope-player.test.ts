// The player is what gives a narrated highlight its shape in TIME: it samples
// render/emphasis.ts every frame, so a glow eases in once and a pulse throbs three times, then
// HOLDS at full for the rest of the sentence, then releases when the voice
// stops. The old loop repeated a 1.5 s swell instead — five of them on a
// median line — and could only notice the voice at a cycle boundary, so it
// went on breathing 0.67 s past the end of the sentence on average.

import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import { EMPHASIS_EASE_MS, EMPHASIS_HOLD_AT_MS, EMPHASIS_RELEASE_MS, EMPHASIS_SWELL_MS } from "../src/render/emphasis";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class StubSpeech extends SpeechManager {
  resolvers: (() => void)[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return new Promise((res) => this.resolvers.push(res));
  }
  override cancel(): void {}
  /** The voice stops — as a sentence ending mid-hold does. */
  finish(): void {
    this.resolvers.forEach((r) => r());
    this.resolvers = [];
  }
}

const recorder = () => {
  const levels: number[] = [];
  const ended: string[][] = [];
  return {
    levels,
    ended,
    effects: {
      setHighlight: (_ids: string[], _e: string, level: number) => levels.push(level),
      endHighlight: (ids: string[]) => ended.push(ids),
      setPointer: () => undefined,
      setCamera: () => undefined,
    },
  };
};

const peaks = (levels: number[]) => levels.filter((v, i) => i > 0 && i < levels.length - 1 && v > levels[i - 1] && v >= levels[i + 1]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function narrated(rec: ReturnType<typeof recorder>, speech: StubSpeech, effect?: "pulse" | "glow") {
  const plan = planCommands([{ draw: ["t"] }, { highlight: { target: ["t"], ...(effect ? { effect } : {}) }, speak: "about this curve" }] as Command[], ["t"], {
    bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }),
  });
  return new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false, effects: rec.effects as never });
}
/** pulse is the effect that keeps the three throbs (glow eases in once — below). */
const narratedGlow = (rec: ReturnType<typeof recorder>, speech: StubSpeech) => narrated(rec, speech, "pulse");

describe("glow — the default — eases in once and holds, no throbs", () => {
  for (const effect of ["glow", undefined] as const) {
    test(`${effect ?? "no effect"}: rises straight to full within the ease and stays there`, async () => {
      const rec = recorder();
      const speech = new StubSpeech();
      const player = narrated(rec, speech, effect);
      const done = player.play();
      await wait(EMPHASIS_EASE_MS + 400);
      // Never dips: every frame at least the one before (a throb would fall back).
      for (let i = 1; i < rec.levels.length; i++) expect(rec.levels[i]).toBeGreaterThanOrEqual(rec.levels[i - 1]);
      expect(rec.levels[rec.levels.length - 1]).toBe(1);
      speech.finish();
      await done;
      expect(rec.levels[rec.levels.length - 1]).toBeCloseTo(0, 3);
      expect(rec.ended).toContainEqual(["t"]);
    });
  }
});

describe("a narrated pulse throbs three times, then holds", () => {
  test("it reaches and stays at full strength while the voice runs", async () => {
    const rec = recorder();
    const speech = new StubSpeech();
    const player = narratedGlow(rec, speech);
    const done = player.play();
    await wait(EMPHASIS_HOLD_AT_MS + 250);
    expect(peaks(rec.levels)).toHaveLength(3);
    const held = rec.levels.slice(-10);
    expect(held.length).toBe(10);
    for (const v of held) expect(v).toBe(1);
    speech.finish();
    await done;
  });

  test("the release starts when the voice stops, not at the end of a cycle", async () => {
    const rec = recorder();
    const speech = new StubSpeech();
    const player = narratedGlow(rec, speech);
    const done = player.play();
    await wait(EMPHASIS_HOLD_AT_MS + 250);
    const atVoiceEnd = rec.levels.length;
    speech.finish();
    await done;
    const after = rec.levels.slice(atVoiceEnd);
    // Frames after the voice: a fade to nothing, no throb, and over before
    // one swell has passed.
    expect(after.length).toBeGreaterThan(0);
    expect(after[after.length - 1]).toBeCloseTo(0, 3);
    expect(peaks(after)).toHaveLength(0);
    expect(rec.ended).toContainEqual(["t"]);
  });

  test("a sentence that ends during the throbs releases from where it had got to, without climbing back", async () => {
    const rec = recorder();
    const speech = new StubSpeech();
    const player = narratedGlow(rec, speech);
    const done = player.play();
    await wait(EMPHASIS_SWELL_MS); // past the first peak, short of the hold
    const at = rec.levels.length;
    const caught = rec.levels[at - 1];
    speech.finish();
    await done;
    expect(caught).toBeLessThan(1);
    const after = rec.levels.slice(at);
    expect(after.length).toBeGreaterThan(0);
    // It never rides out the throb it was in: under the old repeat-a-cycle
    // loop everything after the voice climbed back to a full peak.
    expect(Math.max(...after)).toBeLessThan(0.9);
    // And the release begins here rather than later — within a frame of the
    // level the voice caught it at, whichever way the curve was heading.
    expect(after[0]).toBeLessThan(caught + 0.05);
    expect(rec.levels[rec.levels.length - 1]).toBeCloseTo(0, 3);
  });

  test("a voice that stops before the first throb has peaked still flashes at full", async () => {
    // The silent player is the real case: nothing to wait for at all.
    const rec = recorder();
    const speech = new StubSpeech();
    const player = narratedGlow(rec, speech);
    const done = player.play();
    await wait(60);
    speech.finish();
    await done;
    expect(Math.max(...rec.levels)).toBeCloseTo(1, 2);
    expect(rec.levels[rec.levels.length - 1]).toBeCloseTo(0, 3);
  });

  test("the whole effect is over within a release of the voice ending", async () => {
    const rec = recorder();
    const speech = new StubSpeech();
    const player = narratedGlow(rec, speech);
    const done = player.play();
    await wait(EMPHASIS_HOLD_AT_MS + 250);
    const t0 = Date.now();
    speech.finish();
    await done;
    expect(Date.now() - t0).toBeLessThan(EMPHASIS_RELEASE_MS + 250);
  });
});
