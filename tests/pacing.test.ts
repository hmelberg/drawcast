// A draw step's wall-clock is the SUM of its elements' durations — and a
// group counts as one element whose duration is the sum of its leaves. So a
// figure with a 26-rung DNA helix or a 36-lipid bilayer spends half a minute
// drawing one command, one little stroke at a time. Pacing caps that: a step
// that would run long is compressed into its budget, elements keeping their
// relative weight. Steps that already fit — the median bundled step is 1.4s —
// come back untouched.

import { describe, expect, test } from "vitest";
import { DRAW_BUDGET_MS, SILENT_DRAW_BUDGET_MS, pacedDurations } from "../src/render/pacing";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("pacedDurations", () => {
  test("a step that already fits its budget is returned unchanged", () => {
    const d = [900, 300, 200];
    expect(pacedDurations(d, { narrated: true, parallel: false })).toEqual(d);
  });

  test("a long sequential step is compressed to exactly the budget", () => {
    const d = Array.from({ length: 33 }, () => 824); // the DNA helix's rungs
    const paced = pacedDurations(d, { narrated: true, parallel: false });
    expect(sum(paced)).toBeCloseTo(DRAW_BUDGET_MS, 6);
  });

  test("elements keep their relative weight when compressed", () => {
    const paced = pacedDurations([6000, 3000, 1000], { narrated: true, parallel: false });
    expect(paced[0] / paced[1]).toBeCloseTo(2, 6);
    expect(paced[1] / paced[2]).toBeCloseTo(3, 6);
  });

  test("a silent step gets a tighter budget than a narrated one — nothing is covering the dead air", () => {
    const d = Array.from({ length: 20 }, () => 800);
    expect(sum(pacedDurations(d, { narrated: false, parallel: false }))).toBeCloseTo(SILENT_DRAW_BUDGET_MS, 6);
    expect(SILENT_DRAW_BUDGET_MS).toBeLessThan(DRAW_BUDGET_MS);
  });

  test("a parallel step is measured by its slowest element, not the sum", () => {
    // Twenty 800ms strokes drawn at once take 800ms of wall-clock — well
    // inside budget, so compressing them would be wrong.
    const d = Array.from({ length: 20 }, () => 800);
    expect(pacedDurations(d, { narrated: false, parallel: true })).toEqual(d);
  });

  test("a parallel step whose slowest element blows the budget is still compressed", () => {
    const paced = pacedDurations([9000, 3000], { narrated: false, parallel: true });
    expect(Math.max(...paced)).toBeCloseTo(SILENT_DRAW_BUDGET_MS, 6);
  });

  test("an empty step and an all-zero step are safe (no division by zero)", () => {
    expect(pacedDurations([], { narrated: true, parallel: false })).toEqual([]);
    expect(pacedDurations([0, 0], { narrated: true, parallel: false })).toEqual([0, 0]);
  });
});

// ---- end to end, on a virtual clock ----
//
// The pure function above is only half the claim; this drives the real Player
// with a stubbed rAF so the assertion is what a viewer actually waits through.

import { vi } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import type { Command } from "../src/spec/types";

class SilentSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

function fakeElement(id: string, durationMs: number): RenderedElement {
  return { id, durationMs, setProgress: () => {}, finish: () => {}, hide: () => {} };
}

/** Runs the commands on a fake 16ms-per-frame clock; returns the virtual ms elapsed. */
async function virtualMs(commands: Command[], elements: Map<string, RenderedElement>): Promise<number> {
  let clock = 0;
  const started = clock;
  vi.stubGlobal("performance", { now: () => clock });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    clock += 16;
    setTimeout(() => cb(clock), 0);
    return 0;
  });
  try {
    const plan = planCommands(commands, [...elements.keys()]);
    await new Player(plan, elements, new SilentSpeech(), null, { mode: "silent" }).play();
    return clock - started;
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("the Player honours the budget", () => {
  test("a 27-second group — the DNA helix's rungs — lands inside the silent budget", async () => {
    const elapsed = await virtualMs([{ draw: ["rungs"] }], new Map([["rungs", fakeElement("rungs", 27200)]]));
    expect(elapsed).toBeGreaterThan(SILENT_DRAW_BUDGET_MS * 0.8);
    expect(elapsed).toBeLessThan(SILENT_DRAW_BUDGET_MS + 200);
  });

  test("an ordinary step still takes its authored time", async () => {
    const elapsed = await virtualMs([{ draw: ["curve"] }], new Map([["curve", fakeElement("curve", 900)]]));
    expect(elapsed).toBeGreaterThan(800);
    expect(elapsed).toBeLessThan(1100);
  });
});
