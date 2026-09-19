import { describe, expect, test } from "vitest";
import { EMPHASIS_HOLD_AT_MS, EMPHASIS_RELEASE_MS, EMPHASIS_SWELL_MS, emphasisLevel, releaseLevel } from "../src/render/emphasis";

/** Local maxima of a sampled curve — the throbs a viewer counts. */
function peaks(levels: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < levels.length - 1; i++) {
    if (levels[i] > levels[i - 1] && levels[i] >= levels[i + 1]) out.push(levels[i]);
  }
  return out;
}

const sample = (ms: number, stepMs = 5) => {
  const out: number[] = [];
  for (let t = 0; t <= ms; t += stepMs) out.push(emphasisLevel(t));
  return out;
};

describe("emphasisLevel — three swells, then a hold", () => {
  test("starts dark", () => {
    expect(emphasisLevel(0)).toBe(0);
  });

  test("throbs exactly three times before settling", () => {
    // a little past the hold, since the third peak IS the moment the hold starts
    const p = peaks(sample(EMPHASIS_HOLD_AT_MS + 200));
    expect(p).toHaveLength(3);
    for (const v of p) expect(v).toBeCloseTo(1, 2);
  });

  test("the troughs between the throbs rise instead of falling back to nothing", () => {
    expect(emphasisLevel(EMPHASIS_SWELL_MS)).toBeCloseTo(1 / 3, 2);
    expect(emphasisLevel(2 * EMPHASIS_SWELL_MS)).toBeCloseTo(2 / 3, 2);
  });

  test("holds at full strength once the swells are done, however long the sentence runs", () => {
    expect(emphasisLevel(EMPHASIS_HOLD_AT_MS)).toBe(1);
    expect(emphasisLevel(EMPHASIS_HOLD_AT_MS + 10)).toBe(1);
    expect(emphasisLevel(30_000)).toBe(1);
  });

  test("never throbs again after the hold begins", () => {
    expect(peaks(sample(12_000))).toHaveLength(3);
  });

  test("the third throb runs straight into the hold, with no dip on the way", () => {
    const from = Math.round((2 * EMPHASIS_SWELL_MS) / 5) * 5;
    const tail = sample(EMPHASIS_HOLD_AT_MS + 500).slice(from / 5);
    for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeGreaterThanOrEqual(tail[i - 1]);
  });
});

describe("releaseLevel — the fade the end of the voice starts", () => {
  test("leaves the level it was released from and reaches nothing", () => {
    expect(releaseLevel(1, 0)).toBe(1);
    expect(releaseLevel(1, 1)).toBe(0);
  });

  test("falls from wherever the swells had got to when the voice stopped early", () => {
    const caught = emphasisLevel(EMPHASIS_SWELL_MS / 2);
    expect(releaseLevel(caught, 0)).toBe(caught);
    expect(releaseLevel(caught, 0.5)).toBeLessThan(caught);
    expect(releaseLevel(caught, 1)).toBe(0);
  });

  test("the release is shorter than a single swell — it lands on the word", () => {
    expect(EMPHASIS_RELEASE_MS).toBeLessThan(EMPHASIS_SWELL_MS);
  });
});
