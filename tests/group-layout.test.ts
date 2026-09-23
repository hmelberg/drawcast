import { describe, expect, test } from "vitest";
import { bestColumns, DEFAULT_GAP, naturalNodeSize, slotCentres } from "../src/layout/group-layout";

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

describe("how many columns a grid takes when it is not told", () => {
  const FULL = { w: 880, h: 560 };
  const squares = (n: number, side = 200) => Array.from({ length: n }, () => size(side, side));

  test("a row while the members fit at their own size", () => {
    expect(bestColumns(squares(3), FULL)).toBe(3);
    expect(bestColumns(Array.from({ length: 4 }, () => size(130, 62)), FULL)).toBe(4);
  });

  test("four pictures that no longer fit in a row make two by two", () => {
    expect(bestColumns(squares(4), FULL)).toBe(2);
  });

  test("five pictures make three over two — the bridge gallery", () => {
    expect(bestColumns(squares(5), FULL, 60)).toBe(3);
  });

  test("nine make three by three", () => {
    expect(bestColumns(squares(9, 150), FULL)).toBe(3);
  });

  test("wide, flat items stack into a list", () => {
    expect(bestColumns(Array.from({ length: 5 }, () => size(300, 60)), FULL)).toBe(1);
  });

  test("the region's shape decides: a tall narrow region takes fewer columns", () => {
    expect(bestColumns(squares(4), { w: 420, h: 560 })).toBeLessThanOrEqual(2);
    expect(bestColumns(squares(6), { w: 420, h: 560 })).toBe(2);
  });

  test("one member is one column; none is one column", () => {
    expect(bestColumns([size(80, 20)], FULL)).toBe(1);
    expect(bestColumns([], FULL)).toBe(1);
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

describe("a structure with no coordinates anywhere", () => {
  const CHAIN: Spec = {
    elements: [
      { id: "a", type: "node", shape: "rect", text: "Innsats" },
      { id: "b", type: "node", shape: "rect", text: "Produksjon" },
      { id: "c", type: "node", shape: "rect", text: "Resultat" },
      { id: "g", type: "group", members: ["a", "b", "c"], layout: "row" },
      { id: "e1", type: "arrow", from: { ref: "a" }, to: { ref: "b" } },
      { id: "e2", type: "arrow", from: { ref: "b" }, to: { ref: "c" } },
    ],
    commands: [{ draw: ["g", "e1", "e2"] }],
  };

  test("a row runs left to right, one gap apart, level", () => {
    const r = layoutSpec(CHAIN);
    const b = elementBBoxes(r);
    expect(b.get("a")!.x).toBeLessThan(b.get("b")!.x);
    expect(b.get("b")!.x).toBeLessThan(b.get("c")!.x);
    expect(b.get("b")!.x - (b.get("a")!.x + b.get("a")!.w)).toBeCloseTo(DEFAULT_GAP, 0);
    expect(b.get("a")!.y).toBeCloseTo(b.get("c")!.y, 0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("the arrows run between the boxes where they ended up", () => {
    const b = elementBBoxes(layoutSpec(CHAIN));
    const arrow = b.get("e1")!;
    expect(arrow.x).toBeGreaterThanOrEqual(b.get("a")!.x);
    expect(arrow.x + arrow.w).toBeLessThanOrEqual(b.get("b")!.x + b.get("b")!.w + 1);
  });

  test("a column stacks downward", () => {
    const spec = JSON.parse(JSON.stringify(CHAIN)) as Spec;
    spec.elements![3].layout = "column";
    const b = elementBBoxes(layoutSpec(spec));
    expect(b.get("a")!.y).toBeGreaterThan(b.get("b")!.y);
    expect(b.get("a")!.x).toBeCloseTo(b.get("b")!.x, 0);
  });

  test("gap is honoured", () => {
    const spec = JSON.parse(JSON.stringify(CHAIN)) as Spec;
    spec.elements![3].gap = 120;
    const b = elementBBoxes(layoutSpec(spec));
    expect(b.get("b")!.x - (b.get("a")!.x + b.get("a")!.w)).toBeCloseTo(120, 0);
  });

  test("a column nested in a row moves as one thing", () => {
    const spec: Spec = {
      elements: [
        { id: "a", type: "node", shape: "rect", text: "Søk" },
        { id: "b", type: "node", shape: "rect", text: "Filtrer" },
        { id: "c", type: "node", shape: "rect", text: "Rangér" },
        { id: "inner", type: "group", members: ["b", "c"], layout: "column" },
        { id: "outer", type: "group", members: ["a", "inner"], layout: "row" },
      ],
      commands: [{ draw: ["outer"] }],
    };
    const b = elementBBoxes(layoutSpec(spec));
    // The column's two boxes stay aligned with each other, and both sit right of a.
    expect(b.get("b")!.x).toBeCloseTo(b.get("c")!.x, 0);
    expect(b.get("b")!.x).toBeGreaterThan(b.get("a")!.x);
  });

  test("layout then fit: the arrangement is scaled into its region", () => {
    const spec = JSON.parse(JSON.stringify(CHAIN)) as Spec;
    spec.elements![3].fit = "left";
    const b = elementBBoxes(layoutSpec(spec));
    expect(b.get("c")!.x + b.get("c")!.w).toBeLessThan(520);
  });

  test("a member drawn two beats later does not move the ones already there", () => {
    const together = elementBBoxes(layoutSpec(CHAIN));
    const staged = JSON.parse(JSON.stringify(CHAIN)) as Spec;
    staged.commands = [{ draw: ["a"] }, { draw: ["b"] }, { draw: ["c"] }, { draw: ["e1", "e2"] }];
    const later = elementBBoxes(layoutSpec(staged));
    for (const id of ["a", "b", "c"]) {
      expect(later.get(id)!.x).toBeCloseTo(together.get(id)!.x, 5);
      expect(later.get(id)!.y).toBeCloseTo(together.get(id)!.y, 5);
    }
  });
});

describe("a gallery with no columns written", () => {
  // Five pictures of 200 × 200, built anywhere; the engine lays them out.
  const pic = (id: string, x: number) => ({ id, type: "shape" as const, shape: "rect" as const, x, y: 300, width: 200, height: 200 });
  const gallery = (layout: "grid" | "row", fit?: "full" | "left"): Spec => ({
    elements: [
      ...["p1", "p2", "p3", "p4", "p5"].map((id, i) => pic(id, 100 + i * 10)),
      { id: "g", type: "group", members: ["p1", "p2", "p3", "p4", "p5"], layout, gap: 60, ...(fit ? { fit } : {}) },
    ],
    commands: [{ draw: ["g"] }],
  });

  test("a grid with no columns lays five pictures out three over two", () => {
    const b = elementBBoxes(layoutSpec(gallery("grid", "full")));
    expect(b.get("p1")!.y).toBeCloseTo(b.get("p3")!.y, 0);
    expect(b.get("p4")!.y).toBeLessThan(b.get("p1")!.y);
    expect(b.get("p4")!.x).toBeCloseTo(b.get("p1")!.x, 0);
  });

  test("the grid shows each picture larger than the row would", () => {
    const grid = elementBBoxes(layoutSpec(gallery("grid", "full"))).get("p1")!;
    const row = elementBBoxes(layoutSpec(gallery("row", "full"))).get("p1")!;
    expect(grid.w).toBeGreaterThan(row.w * 1.3);
  });

  test("an explicit row of five pictures warns that a grid would read larger", () => {
    const issues = layoutSpec(gallery("row", "full")).issues.filter((i) => i.rule === "layout-shape");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toContain("grid");
  });

  test("a row that fits, and a grid, say nothing", () => {
    expect(layoutSpec(gallery("grid", "full")).issues.filter((i) => i.rule === "layout-shape")).toEqual([]);
    const three: Spec = {
      elements: [pic("p1", 100), pic("p2", 110), pic("p3", 120), { id: "g", type: "group", members: ["p1", "p2", "p3"], layout: "row", fit: "full" }],
      commands: [{ draw: ["g"] }],
    };
    expect(layoutSpec(three).issues.filter((i) => i.rule === "layout-shape")).toEqual([]);
  });

  test("written columns still win", () => {
    const spec = gallery("grid", "full");
    spec.elements![5].columns = 5;
    const b = elementBBoxes(layoutSpec(spec));
    expect(b.get("p5")!.y).toBeCloseTo(b.get("p1")!.y, 0);
  });
});
