import { describe, expect, test } from "vitest";
import { hitElement, pointInRing } from "../src/ui/hit";
import { elementRings } from "../src/layout/layout";
import { defaultDrawOpts, defaultStyle, Z_AREA, type Drawable, type Pt } from "../src/layout/model";

/** A diamond inside a square box: the box corners are NOT in the shape. */
const diamond: Pt[] = [[50, 0], [100, 50], [50, 100], [0, 50]];
const bigSquare: Pt[] = [[0, 0], [200, 0], [200, 200], [0, 200]];

describe("pointInRing", () => {
  test("a point inside the outline is inside; a box corner outside it is not", () => {
    expect(pointInRing(diamond, [50, 50])).toBe(true);
    expect(pointInRing(diamond, [5, 5])).toBe(false); // inside the bbox, outside the shape
  });
});

describe("hitElement with outlines", () => {
  const boxes = new Map([
    ["small_diamond", { x: 0, y: 0, w: 100, h: 100 }],
    ["big_square", { x: 0, y: 0, w: 200, h: 200 }],
  ]);
  const rings = new Map([
    ["small_diamond", [diamond]],
    ["big_square", [bigSquare]],
  ]);

  test("a point in the smaller box but outside its outline resolves to the shape it is really in", () => {
    // [5, 5] sits inside small_diamond's BOX — today's rule answers "small_diamond".
    expect(hitElement(boxes, [5, 5], 0)).toBe("small_diamond");
    expect(hitElement(boxes, [5, 5], 0, rings)).toBe("big_square");
  });

  test("the smallest shape whose outline contains the point still wins", () => {
    expect(hitElement(boxes, [50, 50], 0, rings)).toBe("small_diamond");
  });

  test("an element with no outline falls back to its box", () => {
    const withBoxOnly = new Map([...boxes, ["label", { x: 300, y: 300, w: 20, h: 20 }]]);
    expect(hitElement(withBoxOnly, [310, 310], 0, rings)).toBe("label");
  });

  test("fat-finger slop still rescues a near miss on an outlined shape", () => {
    expect(hitElement(boxes, [-8, 50], 18, rings)).toBe("small_diamond");
  });
});

describe("hitElement across outlines and boxes", () => {
  // A code panel: the element `md` draws its frame as a closed stroke (so it
  // has a ring) and its lines are text drawables with boxes only.
  const frame: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];
  const boxes = new Map([
    ["md", { x: 0, y: 0, w: 400, h: 300 }],
    ["md_line_1", { x: 20, y: 250, w: 360, h: 20 }],
    ["md_line_4", { x: 20, y: 100, w: 360, h: 20 }],
  ]);
  const rings = new Map([["md", [frame]]]);

  test("a box-only element inside an outlined container wins when it is smaller", () => {
    expect(hitElement(boxes, [100, 110], 0, rings)).toBe("md_line_4");
    expect(hitElement(boxes, [100, 260], 0, rings)).toBe("md_line_1");
  });

  test("the container still answers between its lines", () => {
    expect(hitElement(boxes, [100, 180], 0, rings)).toBe("md");
  });

  test("an outlined element whose box contains the point but whose outline does not is never a candidate", () => {
    // [5, 5] is inside the diamond's BOX and outside its outline; the label's
    // box is larger, but it is the only real candidate.
    const withLabel = new Map([
      ["small_diamond", { x: 0, y: 0, w: 100, h: 100 }],
      ["label", { x: 0, y: 0, w: 150, h: 150 }],
    ]);
    expect(hitElement(withLabel, [5, 5], 0, new Map([["small_diamond", [diamond]]]))).toBe("label");
  });
});

test("elementRings collects closed outlines and ignores open strokes", () => {
  const area: Drawable = {
    id: "liver", kind: "area", pts: diamond, z: Z_AREA,
    style: defaultStyle({}), drawOpts: defaultDrawOpts("instant"),
  };
  const openCurve: Drawable = {
    id: "aorta", kind: "stroke", pts: [[0, 0], [10, 10]], z: Z_AREA,
    style: defaultStyle({}), drawOpts: defaultDrawOpts("instant"),
  };
  const map = elementRings({ drawables: [area, openCurve], order: ["liver", "aorta"] });
  expect(map.get("liver")).toEqual([diamond]);
  expect(map.has("aorta")).toBe(false);
});
