import { describe, expect, test } from "vitest";
import { fitRegion } from "../src/layout/regions";

describe("fitRegion", () => {
  test("halves share the band and do not overlap", () => {
    const l = fitRegion("left"), r = fitRegion("right");
    expect(l).toEqual({ x: 60, y: 95, w: 420, h: 560 });
    expect(r).toEqual({ x: 520, y: 95, w: 420, h: 560 });
    expect(l.x + l.w + 40).toBe(r.x);
  });
  test("top is the upper band (y-up), bottom the lower", () => {
    expect(fitRegion("top")).toEqual({ x: 60, y: 395, w: 880, h: 260 });
    expect(fitRegion("bottom")).toEqual({ x: 60, y: 95, w: 880, h: 260 });
    expect(fitRegion("full")).toEqual({ x: 60, y: 95, w: 880, h: 560 });
  });
});
