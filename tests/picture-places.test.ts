import { describe, expect, test } from "vitest";
import { FULL_VIEW4, fractionBox, fractionPoint, isRect4, parsePlace } from "../src/spec/places";

describe("parsePlace", () => {
  test("a region, an anchor, a point and a box", () => {
    expect(parsePlace("md:command_line")).toEqual({ kind: "region", owner: "md", name: "command_line" });
    expect(parsePlace("md@top_right")).toEqual({ kind: "anchor", owner: "md", anchor: "top_right" });
    expect(parsePlace("md@[0.6, 0.1]")).toEqual({ kind: "point", owner: "md", at: [0.6, 0.1] });
    expect(parsePlace("md@[0.2,0.9,0.8,0.1]")).toEqual({ kind: "box", owner: "md", box: [0.2, 0.9, 0.8, 0.1] });
  });
  test("a plain id, and malformed places, are not places", () => {
    expect(parsePlace("md")).toBeNull();
    expect(parsePlace("label_md")).toBeNull();
    expect(parsePlace("md@[0.1]")).toBeNull();
    expect(parsePlace("md@[a, b]")).toBeNull();
    expect(parsePlace("md:")).toBeNull();
    expect(parsePlace(":x")).toBeNull();
  });
});

describe("fractionBox", () => {
  // A 400 × 200 picture whose top-left corner is at canvas (100, 500) — y up,
  // so it spans y 300..500.
  const frame = { rect: { x: 100, y: 300, w: 400, h: 200 }, view: FULL_VIEW4 };
  test("top-left origin, y down, onto a y-up canvas", () => {
    expect(fractionBox(frame, [0, 0, 1, 1])).toEqual({ x: 100, y: 300, w: 400, h: 200 });
    // The top-left quarter: x 100..300, and the TOP half is y 400..500.
    expect(fractionBox(frame, [0, 0, 0.5, 0.5])).toEqual({ x: 100, y: 400, w: 200, h: 100 });
    expect(fractionPoint(frame, [1, 1])).toEqual([500, 300]);
  });
  test("fractions are of the WHOLE picture, shown through view", () => {
    // Only the right half is shown, stretched over the same rect.
    const half = { rect: frame.rect, view: [0.5, 0, 0.5, 1] as [number, number, number, number] };
    expect(fractionBox(half, [0.5, 0, 0.5, 1])).toEqual({ x: 100, y: 300, w: 400, h: 200 });
    expect(fractionBox(half, [0.75, 0, 0.25, 0.5])).toEqual({ x: 300, y: 400, w: 200, h: 100 });
  });
  test("isRect4", () => {
    expect(isRect4([0, 0, 1, 1])).toBe(true);
    expect(isRect4([0, 0, 1])).toBe(false);
    expect(isRect4([0, 0, "1", 1])).toBe(false);
  });
});
