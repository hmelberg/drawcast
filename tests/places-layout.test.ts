import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { autoRow, PLACE_MARGIN } from "../src/layout/places";

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

describe("auto-placement of positionless elements", () => {
  test("one free shape keeps the centre it has always had", () => {
    const r = layoutSpec({
      elements: [{ id: "a", type: "shape", shape: "rect", width: 120, height: 60 }],
      commands: [{ draw: ["a"] }],
    });
    const b = elementBBoxes(r).get("a")!;
    expect(b.x + b.w / 2).toBeCloseTo(500, 0);
    expect(b.y + b.h / 2).toBeCloseTo(375, 0);
  });

  test("three free shapes spread into a row instead of piling up", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", width: 120, height: 60 },
        { id: "b", type: "shape", shape: "rect", width: 120, height: 60 },
        { id: "c", type: "shape", shape: "rect", width: 120, height: 60 },
      ],
      commands: [{ draw: ["a", "b", "c"] }],
    });
    const boxes = elementBBoxes(r);
    const centres = ["a", "b", "c"].map((id) => boxes.get(id)!.x + boxes.get(id)!.w / 2);
    const slots = autoRow(3).map(([x]) => x);
    expect(centres[0]).toBeCloseTo(slots[0], 0);
    expect(centres[1]).toBeCloseTo(slots[1], 0);
    expect(centres[2]).toBeCloseTo(slots[2], 0);
    expect(centres[0]).toBeLessThan(centres[1]);
    expect(centres[1]).toBeLessThan(centres[2]);
  });

  test("an element with its own x is left exactly where it says", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 200, y: 600, width: 120, height: 60 },
        { id: "b", type: "shape", shape: "rect", width: 120, height: 60 },
        { id: "c", type: "shape", shape: "rect", width: 120, height: 60 },
      ],
      commands: [{ draw: ["a", "b", "c"] }],
    });
    const boxes = elementBBoxes(r);
    expect(boxes.get("a")!.x + boxes.get("a")!.w / 2).toBeCloseTo(200, 0);
    const slots = autoRow(2).map(([x]) => x);
    expect(boxes.get("b")!.x + boxes.get("b")!.w / 2).toBeCloseTo(slots[0], 0);
    expect(boxes.get("c")!.x + boxes.get("c")!.w / 2).toBeCloseTo(slots[1], 0);
  });

  test("an element placed with at is not part of the row", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", width: 120, height: 60, at: { place: "left" } },
        { id: "b", type: "shape", shape: "rect", width: 120, height: 60 },
      ],
      commands: [{ draw: ["a", "b"] }],
    });
    const boxes = elementBBoxes(r);
    expect(boxes.get("a")!.x).toBeCloseTo(PLACE_MARGIN, 0);
    expect(boxes.get("b")!.x + boxes.get("b")!.w / 2).toBeCloseTo(500, 0);
  });

  test("nodes keep their own ring and do not join the row", () => {
    const r = layoutSpec({
      elements: [
        { id: "n1", type: "node", shape: "rect", text: "A" },
        { id: "n2", type: "node", shape: "rect", text: "B" },
        { id: "t", type: "text", text: "hei", font_size: 26 },
      ],
      commands: [{ draw: ["n1", "n2", "t"] }],
    });
    const boxes = elementBBoxes(r);
    expect(boxes.get("t")!.x + boxes.get("t")!.w / 2).toBeCloseTo(500, 0);
    // Two free nodes sit at ring angles +90° and -90°: same x, mirrored in y.
    expect(boxes.get("n1")!.y).not.toBeCloseTo(boxes.get("n2")!.y, 0);
  });
});
