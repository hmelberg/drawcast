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
