import { describe, expect, test } from "vitest";
import { frameDrawables } from "../src/render/frame";
import { INITIAL_STATE, type SceneState } from "../src/render/plan";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultStyle, type Drawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";

const stroke = (id: string, pts: [number, number][]): StrokeDrawable => ({
  id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: { mode: "sketch", duration: 400 },
});
const text = (id: string, pos: [number, number]): TextDrawable => ({
  id, kind: "text", pos, text: "t", fontSize: 26, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: { mode: "sketch", duration: 200 },
});
const layout = {
  drawables: [
    stroke("a", [[0, 0], [100, 0]]),
    stroke("a_text", [[0, 10], [10, 10]]), // a sub-drawable rides with a
    stroke("b", [[0, 0], [0, 100]]),
    text("c", [50, 50]),
    stroke("d", [[500, 500], [600, 600]]),
    { id: "g", kind: "group", z: 1, style: defaultStyle(), drawOpts: { mode: "sketch", duration: 0 }, children: [stroke("g__leaf", [[1, 1], [2, 2]])] } as Drawable,
  ],
};

describe("frameDrawables (spec §4.3)", () => {
  test("visible leaves only, in visible order, posed and faded, re-homed under prefix__p ids", () => {
    const state: SceneState = {
      ...INITIAL_STATE,
      visible: ["b", "a", "c", "g"], // d is hidden
      offsets: { a: [10, 20] },
      turns: { b: { deg: 90, pivot: [0, 0] } },
      opacities: { c: 0.5 },
    };
    const { drawables, boxes } = frameDrawables(layout, state, "pic", heuristicMeasure);
    // b first (visible order), then a + a_text, then c, then g.
    expect(drawables.map((d) => d.id)).toEqual(["pic__p0", "pic__p1", "pic__p2", "pic__p3", "pic__p4"]);
    const b = drawables[0] as StrokeDrawable;
    expect(b.pts[1][0]).toBeCloseTo(-100, 5); // rotated 90° about the origin: (0,100) → (-100,0)
    expect(b.pts[1][1]).toBeCloseTo(0, 5);
    const a = drawables[1] as StrokeDrawable;
    expect(a.pts[0]).toEqual([10, 20]);
    const c = drawables[3] as TextDrawable;
    expect(c.style.opacity).toBeCloseTo(0.5, 5);
    expect(drawables.some((d) => d.id.includes("d"))).toBe(false);
    // The group is re-homed with its children.
    const g = drawables[4];
    expect(g.kind).toBe("group");
    if (g.kind === "group") expect(g.children[0].id).toBe("pic__p5");
    // Boxes per visible element id, posed.
    expect(boxes.a.x).toBe(10);
    expect(boxes.b.x).toBeCloseTo(-100, 5);
    expect(boxes.d).toBeUndefined();
  });
  test("an element at opacity 0 is left out", () => {
    const state: SceneState = { ...INITIAL_STATE, visible: ["a"], opacities: { a: 0 } };
    expect(frameDrawables(layout, state, "p", heuristicMeasure).drawables).toEqual([]);
  });
  test("a text override from the state is applied", () => {
    const state: SceneState = { ...INITIAL_STATE, visible: ["c"], texts: { c: { c: "changed" } } };
    const t = frameDrawables(layout, state, "p", heuristicMeasure).drawables[0] as TextDrawable;
    expect(t.text).toBe("changed");
  });
});
