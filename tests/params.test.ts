import { describe, expect, test } from "vitest";
import { readParam, withOverrides } from "../src/render/params";

describe("readParam", () => {
  test("top-level and nested numeric reads", () => {
    expect(readParam({ azimuth: 32 }, "azimuth")).toBe(32);
    expect(readParam({ demand_shift: { amount: 0 } }, "demand_shift.amount")).toBe(0);
  });
  test("missing, non-numeric, and non-finite → null", () => {
    expect(readParam(undefined, "a")).toBeNull();
    expect(readParam({}, "demand_shift.amount")).toBeNull();
    expect(readParam({ demand: { steepness: "steep" } }, "demand.steepness")).toBeNull();
    expect(readParam({ a: NaN }, "a")).toBeNull();
    expect(readParam({ a: 5 }, "a.b")).toBeNull();
  });
});

describe("withOverrides", () => {
  test("deep-sets without mutating and creates intermediate objects", () => {
    const base = { demand: { steepness: 1 }, other: true };
    const out = withOverrides(base, { "demand.steepness": 2, "demand_shift.amount": 10 });
    expect(out).toEqual({ demand: { steepness: 2 }, other: true, demand_shift: { amount: 10 } });
    expect(base.demand.steepness).toBe(1);
    expect((base as Record<string, unknown>).demand_shift).toBeUndefined();
  });
  test("non-object collision: the original value wins", () => {
    expect(withOverrides({ a: 5 }, { "a.b": 1 })).toEqual({ a: 5 });
  });
  test("undefined base works", () => {
    expect(withOverrides(undefined, { azimuth: 90 })).toEqual({ azimuth: 90 });
  });
});
