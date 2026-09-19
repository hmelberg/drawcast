import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { PLACE_MARGIN } from "../src/layout/places";

describe("at.place in layoutSpec", () => {
  test("left seats a rect's left edge on the margin, vertically centred", () => {
    const r = layoutSpec({
      elements: [{ id: "a", type: "shape", shape: "rect", width: 120, height: 60, at: { place: "left" } }],
      commands: [{ draw: ["a"] }],
    });
    const b = elementBBoxes(r).get("a")!;
    expect(b.x).toBeCloseTo(PLACE_MARGIN, 0);
    expect(b.y + b.h / 2).toBeCloseTo(375, 0);
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
  });

  test("top_right tucks a text into the top-right corner", () => {
    const r = layoutSpec({
      elements: [{ id: "t", type: "text", text: "BNP = summen", font_size: 26, at: { place: "top_right" } }],
      commands: [{ draw: ["t"] }],
    });
    const b = elementBBoxes(r).get("t")!;
    expect(b.x + b.w).toBeCloseTo(1000 - PLACE_MARGIN, 0);
    expect(b.y + b.h).toBeCloseTo(750 - PLACE_MARGIN, 0);
  });

  test("a placed element's own anchor still overrides", () => {
    const r = layoutSpec({
      elements: [{ id: "a", type: "shape", shape: "rect", width: 120, height: 60, at: { place: "left" }, anchor: "center" }],
      commands: [{ draw: ["a"] }],
    });
    const b = elementBBoxes(r).get("a")!;
    expect(b.x + b.w / 2).toBeCloseTo(PLACE_MARGIN, 0);
  });

  test("a place on an element that draws nothing of its own is reported, not silent", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 500, y: 375, width: 100, height: 40 },
        { id: "l", type: "label", attach_to: "a", text: "hei", at: { place: "left" } },
      ],
      commands: [{ draw: ["a", "l"] }],
    });
    expect(r.issues.some((i) => i.rule === "placement" && i.ids.includes("l"))).toBe(true);
  });
});
