import { describe, expect, test } from "vitest";
import { EASINGS, lerpBox } from "../src/render/effects";

// Final fix I, item 4: course lecture 4 logged `<svg> attribute viewBox: A
// negative value is not valid ("1707.0 0.0 -2414.1 -1810.5")`. A card
// heading's camera zoom lasts 0.01 s; the player's progress() takes its first
// rAF timestamp, which can stand ~48 ms BEFORE the performance.now() it
// started from, so p = -4.8, ease-in-out(-4.8) = 46.1, and the camera box was
// extrapolated 46× past its target — to a negative size. A box tween never
// leaves its two ends.
describe("lerpBox stays between its ends", () => {
  const rest = { x: 0, y: 0, w: 1000, h: 750 };
  const zoom = { x: 500 - 1000 / 1.08 / 2, y: 375 - 750 / 1.08 / 2, w: 1000 / 1.08, h: 750 / 1.08 };
  test("the L4 numbers: an eased t of 46 gives the target, not a negative box", () => {
    const t = EASINGS["ease-in-out"](-4.8);
    expect(t).toBeGreaterThan(40);
    const b = lerpBox(rest, zoom, t);
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
    expect(b).toEqual(zoom);
  });
  test("below 0 is the start; in between still interpolates", () => {
    expect(lerpBox(rest, zoom, -3)).toEqual(rest);
    expect(lerpBox({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 100, w: 0, h: 0 }, 0.5)).toEqual({ x: 50, y: 50, w: 50, h: 50 });
  });
});
