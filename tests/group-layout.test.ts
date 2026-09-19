import { describe, expect, test } from "vitest";
import { DEFAULT_GAP, naturalNodeSize, slotCentres } from "../src/layout/group-layout";

const size = (w: number, h: number) => ({ w, h });

describe("slot centres", () => {
  test("a row places members left to right, one gap apart, centred on the cross axis", () => {
    const c = slotCentres("row", [size(100, 40), size(60, 80)]);
    expect(c[1][0] - c[0][0]).toBeCloseTo(100 / 2 + DEFAULT_GAP + 60 / 2, 5);
    expect(c[0][1]).toBeCloseTo(c[1][1], 5);
  });

  test("a column places them top to bottom", () => {
    const c = slotCentres("column", [size(100, 40), size(60, 80)]);
    expect(c[0][1] - c[1][1]).toBeCloseTo(40 / 2 + DEFAULT_GAP + 80 / 2, 5);
    expect(c[0][0]).toBeCloseTo(c[1][0], 5);
  });

  test("the gap is the one thing you usually do not write", () => {
    const wide = slotCentres("row", [size(100, 40), size(100, 40)], { gap: 100 });
    const narrow = slotCentres("row", [size(100, 40), size(100, 40)]);
    expect(wide[1][0] - wide[0][0]).toBeCloseTo(narrow[1][0] - narrow[0][0] + (100 - DEFAULT_GAP), 5);
  });

  test("align start lines a row up by its members' tops", () => {
    const c = slotCentres("row", [size(100, 40), size(60, 80)], { align: "start" });
    expect(c[0][1] + 40 / 2).toBeCloseTo(c[1][1] + 80 / 2, 5);
  });

  test("a grid wraps at columns, row by row", () => {
    const c = slotCentres("grid", [size(50, 50), size(50, 50), size(50, 50)], { columns: 2 });
    expect(c[0][1]).toBeCloseTo(c[1][1], 5);
    expect(c[2][1]).toBeLessThan(c[0][1]);
    expect(c[2][0]).toBeCloseTo(c[0][0], 5);
  });

  test("one member is its own centre", () => {
    expect(slotCentres("row", [size(80, 20)])).toHaveLength(1);
  });

  test("no members is no slots", () => {
    expect(slotCentres("row", [])).toEqual([]);
  });
});

describe("the natural size of a node", () => {
  test("a rect grows with its text", () => {
    const small = naturalNodeSize({ id: "a", type: "node", shape: "rect", text: "Hi" })!;
    const big = naturalNodeSize({ id: "b", type: "node", shape: "rect", text: "Husholdninger" })!;
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBeCloseTo(small.h, 5);
  });

  test("a declared width wins", () => {
    expect(naturalNodeSize({ id: "a", type: "node", shape: "rect", text: "Hi", width: 300 })!.w).toBe(300);
  });

  test("only nodes have one", () => {
    expect(naturalNodeSize({ id: "t", type: "text", text: "hi" })).toBeNull();
  });
});

import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const ROW: Spec = {
  elements: [
    { id: "a", type: "node", shape: "rect", text: "Innsats" },
    { id: "b", type: "node", shape: "rect", text: "Produksjon" },
    { id: "g", type: "group", members: ["a", "b"], layout: "row" },
  ],
  commands: [{ draw: ["g"] }],
};

describe("the fields", () => {
  test("a group with a layout validates", () => {
    expect(validateSpec(ROW).ok).toBe(true);
  });

  test("layout on something that is not a group is refused", () => {
    const r = validateSpec({ elements: [{ id: "t", type: "text", text: "hi", x: 1, y: 2, layout: "row" }], commands: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("layout");
  });
});

describe("equalize", () => {
  test("a row gives its boxes one size, the largest needed", () => {
    const b = elementBBoxes(layoutSpec(ROW));
    expect(b.get("a")!.w).toBeCloseTo(b.get("b")!.w, 0);
    expect(b.get("a")!.h).toBeCloseTo(b.get("b")!.h, 0);
  });

  test("equalize false leaves every box its own size", () => {
    const spec = JSON.parse(JSON.stringify(ROW)) as Spec;
    spec.elements![2].equalize = false;
    const b = elementBBoxes(layoutSpec(spec));
    expect(b.get("a")!.w).toBeLessThan(b.get("b")!.w);
  });

  test("a group with no layout is untouched", () => {
    const spec = JSON.parse(JSON.stringify(ROW)) as Spec;
    delete spec.elements![2].layout;
    const b = elementBBoxes(layoutSpec(spec));
    expect(b.get("a")!.w).toBeLessThan(b.get("b")!.w);
  });
});
