import { describe, expect, it } from "vitest";
import { castUsd, creditRange, formatCreditRange, shortfall } from "../src/llm/credit-estimate";

describe("credit estimates", () => {
  it("turns dollars into a wide credit range at 4x and 100 credits a dollar", () => {
    expect(creditRange(0.5)).toEqual({ low: 120, high: 360 });
    expect(creditRange(0)).toEqual({ low: 1, high: 1 });
  });

  it("reads as a range, never a single promise", () => {
    expect(formatCreditRange({ low: 120, high: 360 })).toBe("about 120–360 credits");
    expect(formatCreditRange({ low: 1, high: 1 })).toBe("about 1 credit");
  });

  it("stops a run only when the balance is below the high end", () => {
    expect(shortfall(360, { low: 120, high: 360 })).toBeNull();
    expect(shortfall(359.5, { low: 120, high: 360 })).toContain("you have 359");
    expect(shortfall(-4, { low: 1, high: 2 })).toContain("you have 0");
  });

  it("prices a cast as its parts plus the planning call", () => {
    expect(castUsd("claude-opus-5-5", "high", false, 2)).toBeCloseTo(0.6 * 2 + 0.06);
  });
});
