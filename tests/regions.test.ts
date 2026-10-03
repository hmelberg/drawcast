import { describe, expect, test } from "vitest";
import { fitRegion } from "../src/layout/regions";

describe("fitRegion", () => {
  test("halves share the band and do not overlap", () => {
    const l = fitRegion("left"), r = fitRegion("right");
    // The page frame's fit band (layout/page.ts): y 160–655, clear of the
    // caption band below and the heading strip above (was y 95, h 560).
    expect(l).toEqual({ x: 60, y: 160, w: 420, h: 495 });
    expect(r).toEqual({ x: 520, y: 160, w: 420, h: 495 });
    expect(l.x + l.w + 40).toBe(r.x);
  });
  test("top is the upper band (y-up), bottom the lower", () => {
    expect(fitRegion("top")).toEqual({ x: 60, y: 427.5, w: 880, h: 227.5 });
    expect(fitRegion("bottom")).toEqual({ x: 60, y: 160, w: 880, h: 227.5 });
    expect(fitRegion("full")).toEqual({ x: 60, y: 160, w: 880, h: 495 });
  });
});
