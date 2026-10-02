// Confetti above the caption (round 5 fix wave, M6): the burst is drawn only
// above the caption band, from an origin kept over it, so the words being
// said are never under falling pieces.

import { describe, expect, test } from "vitest";
import { confettiFloor, confettiOrigin, confettiPieces, pieceAt } from "../src/ui/rewards";

describe("the confetti's floor", () => {
  test("the caption's top when one shows, else the stage's bottom", () => {
    expect(confettiFloor(600, 520)).toBe(520);
    expect(confettiFloor(600, null)).toBe(600);
    // A caption measured off the stage (hidden, not laid out) is no floor.
    expect(confettiFloor(600, 0)).toBe(600);
    expect(confettiFloor(600, 640)).toBe(600);
  });

  test("an origin in or under the band is lifted over it", () => {
    expect(confettiOrigin([300, 560], 520)).toEqual([300, 480]);
    expect(confettiOrigin([300, 200], 520)).toEqual([300, 200]);
    expect(confettiOrigin([300, 30], 20)).toEqual([300, 0]);
  });

  test("every piece starts above the floor", () => {
    const floor = 520;
    const ps = confettiPieces(60, confettiOrigin([300, 590], floor), 7);
    for (const p of ps) expect(pieceAt(p, 0).y).toBeLessThan(floor);
  });
});
