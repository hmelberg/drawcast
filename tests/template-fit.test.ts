import { describe, expect, test } from "vitest";
import { fitSceneLayout, floorTextSizes, resolveTemplateBox, FIT_PAD } from "../src/layout/template-fit";
import { fitRegion } from "../src/layout/regions";
import { heuristicMeasure } from "../src/layout/measure";
import { FONT_FLOOR } from "../src/lint/lint";
import { resolveStyle } from "../src/layout/resolve";
import type { SceneLayout } from "../src/scenes/types";
import type { Drawable, TextDrawable, StrokeDrawable } from "../src/layout/model";
import type { LabelRequest } from "../src/layout/labels";

// A toy scene: a 400 × 200 rectangle of ink at (100, 100), a 30-unit
// text at its centre, a label anchored at its right edge, one anchor
// and one curve sample — everything a template can hand back.
function scene(): SceneLayout {
  const rect: StrokeDrawable = {
    id: "body", kind: "stroke", z: 1, pts: [[100, 100], [500, 100], [500, 300], [100, 300]], closed: true,
    style: resolveStyle(undefined, {}),
  } as StrokeDrawable;
  const text: TextDrawable = { id: "t", kind: "text", z: 2, pos: [300, 200], text: "S", fontSize: 30, anchor: "middle", style: resolveStyle(undefined, {}) } as TextDrawable;
  const label = { id: "lab", anchor: [500, 200], side: "right", text: "Susceptible", fontSize: 17 } as unknown as LabelRequest;
  return {
    drawables: [rect, text],
    labels: [label],
    anchors: { body_center: [300, 200] },
    order: ["body", "t", "lab"],
    curveSamples: { curve: [[100, 100], [500, 300]] },
  };
}

describe("resolveTemplateBox", () => {
  test("a region name resolves to that region", () => {
    expect(resolveTemplateBox("right")).toEqual(fitRegion("right"));
  });
  test("a rectangle is accepted as a copy, anything else is null", () => {
    const r = { x: 10, y: 20, w: 300, h: 200 };
    const out = resolveTemplateBox(r);
    expect(out).toEqual(r);
    expect(out).not.toBe(r);
    expect(resolveTemplateBox("middle")).toBeNull();
    expect(resolveTemplateBox({ x: 10, y: 20, w: 0, h: 200 })).toBeNull();
    expect(resolveTemplateBox({ x: 10, y: 20 })).toBeNull();
    expect(resolveTemplateBox(undefined)).toBeNull();
    expect(resolveTemplateBox(42)).toBeNull();
  });
});

describe("fitSceneLayout", () => {
  test("scales the ink union (padded) uniformly into the box and centres it", () => {
    const sc = scene();
    const box = { x: 520, y: 95, w: 360, h: 560 };
    const fit = fitSceneLayout(sc, box, heuristicMeasure)!;
    // union = rect padded by FIT_PAD: (100-24, 100-24) to (500+24, 300+24) → 448 × 248
    const s = Math.min(box.w / (400 + 2 * FIT_PAD), box.h / (200 + 2 * FIT_PAD));
    expect(fit.s).toBeCloseTo(s, 6);
    expect(fit.box).toEqual(box);
    const rect = sc.drawables[0] as StrokeDrawable;
    const xs = rect.pts.map((p) => p[0]), ys = rect.pts.map((p) => p[1]);
    // width-limited: the padded union spans the box width; the ink is inset by the pad
    expect(Math.min(...xs)).toBeCloseTo(box.x + FIT_PAD * s, 3);
    expect(Math.max(...xs)).toBeCloseTo(box.x + box.w - FIT_PAD * s, 3);
    // centred vertically
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(box.y + box.h / 2, 3);
  });

  test("text, labels, anchors and curve samples travel with the ink", () => {
    const sc = scene();
    const box = { x: 520, y: 95, w: 360, h: 560 };
    const { s, dx, dy } = fitSceneLayout(sc, box, heuristicMeasure)!;
    const m = ([x, y]: [number, number]) => [x * s + dx, y * s + dy];
    expect((sc.drawables[1] as TextDrawable).pos).toEqual(m([300, 200]));
    expect(sc.labels[0].anchor).toEqual(m([500, 200]));
    expect(sc.anchors.body_center).toEqual(m([300, 200]));
    expect(sc.curveSamples!.curve).toEqual([m([100, 100]), m([500, 300])]);
  });

  test("text shrinks with the figure but never below FONT_FLOOR; labels likewise", () => {
    const sc = scene();
    const { s } = fitSceneLayout(sc, { x: 520, y: 95, w: 360, h: 560 }, heuristicMeasure)!;
    expect(s).toBeLessThan(1);
    const t = sc.drawables[1] as TextDrawable;
    expect(t.fontSize).toBeCloseTo(Math.max(FONT_FLOOR, 30 * s), 6);
    // 17 * s would be below the floor for this box; the label holds at the floor
    expect(17 * s).toBeLessThan(FONT_FLOOR);
    expect(sc.labels[0].fontSize).toBe(FONT_FLOOR);
  });

  test("a box larger than the figure scales UP — a fit is a fit", () => {
    const sc = scene();
    const { s } = fitSceneLayout(sc, { x: 0, y: 0, w: 1000, h: 750 }, heuristicMeasure)!;
    expect(s).toBeGreaterThan(1);
  });

  test("a scene with no ink is left alone and returns null", () => {
    const sc: SceneLayout = { drawables: [], labels: [], anchors: {}, order: [] };
    expect(fitSceneLayout(sc, fitRegion("left"), heuristicMeasure)).toBeNull();
  });
});

describe("floorTextSizes", () => {
  test("walks into groups", () => {
    const inner = { id: "x", kind: "text", z: 2, pos: [0, 0], text: "x", fontSize: 5, anchor: "middle" } as unknown as TextDrawable;
    const ds: Drawable[] = [{ id: "g", kind: "group", z: 2, children: [inner] } as unknown as Drawable];
    floorTextSizes(ds);
    expect(inner.fontSize).toBe(FONT_FLOOR);
  });
});
