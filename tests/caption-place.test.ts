// Subtitles below the drawing when the stage has room, over it when not
// (render/caption-place.ts, Hans 2026-09-25).
import { describe, expect, test } from "vitest";
import { captionBelow } from "../src/render/caption-place";

const STRIP = 60; // two lines

describe("captionBelow", () => {
  test("a phone held upright: a tall stage under a 4:3 drawing → below", () => {
    expect(captionBelow({ w: 390, h: 700 }, STRIP, false)).toBe(true);
  });
  test("the same phone sideways, or a wide fullscreen: no room → over", () => {
    expect(captionBelow({ w: 844, h: 390 }, STRIP, false)).toBe(false);
    expect(captionBelow({ w: 1440, h: 1080 }, STRIP, false)).toBe(false);
  });
  test("an exact 4:3 stage (the desktop card) → over", () => {
    expect(captionBelow({ w: 800, h: 600 }, STRIP, false)).toBe(false);
  });
  test("hysteresis: it enters below with a margin to spare and leaves only when the strip no longer fits", () => {
    const w = 400, drawing = 300;
    expect(captionBelow({ w, h: drawing + STRIP + 4 }, STRIP, false)).toBe(false); // not enough to enter
    expect(captionBelow({ w, h: drawing + STRIP + 4 }, STRIP, true)).toBe(true); // …but enough to stay
    expect(captionBelow({ w, h: drawing + STRIP - 1 }, STRIP, true)).toBe(false);
  });
  test("an unmeasured stage keeps what it had", () => {
    expect(captionBelow({ w: 0, h: 0 }, STRIP, true)).toBe(true);
  });
});
