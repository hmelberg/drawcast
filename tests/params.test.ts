import { describe, expect, test } from "vitest";
import { readParam, withNewIdsVisible, withOverrides } from "../src/render/params";

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
  test("array indices are path segments: values.2 reads the third entry, nested too", () => {
    expect(readParam({ values: [3, 5, 8] }, "values.2")).toBe(8);
    expect(readParam({ values: [[3, 5], [4, 9]] }, "values.1.0")).toBe(4);
    expect(readParam({ series: [{ values: [1, 2] }] }, "series.0.values.1")).toBe(2);
    expect(readParam({ values: [3, 5] }, "values.7")).toBeNull();
    expect(readParam({ values: [3, 5] }, "values.x")).toBeNull();
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
  test("non-numeric overrides pass through (free-play previews: fen strings, move arrays)", () => {
    const base = { fen: "start", moves: ["e4", "e5"], plies_shown: 2 };
    const out = withOverrides(base, { fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: [], plies_shown: 0 });
    expect(out).toEqual({ fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: [], plies_shown: 0 });
    expect(base.moves).toEqual(["e4", "e5"]);
  });
  test("undefined base works", () => {
    expect(withOverrides(undefined, { azimuth: 90 })).toEqual({ azimuth: 90 });
  });
  test("array indices are overridable without mutating the array", () => {
    const base = { values: [3, 5, 8], series: [{ values: [1, 2] }] };
    const out = withOverrides(base, { "values.2": 40, "series.0.values.1": 9 });
    expect(out).toEqual({ values: [3, 5, 40], series: [{ values: [1, 9] }] });
    expect(base.values).toEqual([3, 5, 8]);
    expect(base.series[0].values).toEqual([1, 2]);
  });
  test("a non-integer segment into an array is a collision: the original wins; a missing path never creates an array", () => {
    expect(withOverrides({ values: [3, 5] }, { "values.x": 1 })).toEqual({ values: [3, 5] });
    expect(withOverrides({}, { "values.0": 1 })).toEqual({ values: { "0": 1 } });
  });
});

describe("withNewIdsVisible", () => {
  test("ids the preview mints are added; known-but-hidden ids stay hidden", () => {
    const base = new Set(["board", "piece_e2", "arrow_0"]);
    const visible = new Set(["board", "piece_e2"]); // arrow_0 drawn later — stays hidden
    const grown = withNewIdsVisible(base, ["board", "piece_e4", "arrow_0"], visible);
    expect(grown.has("piece_e4")).toBe(true);
    expect(grown.has("arrow_0")).toBe(false);
    expect(grown.has("board")).toBe(true);
  });
  test("no fresh ids: the original set is returned untouched", () => {
    const visible = new Set(["a"]);
    expect(withNewIdsVisible(new Set(["a", "b"]), ["a", "b"], visible)).toBe(visible);
  });
});
