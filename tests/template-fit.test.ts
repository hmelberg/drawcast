import { describe, expect, test } from "vitest";
import { fitSceneLayout, fittedTextSize, floorTextSizes, resolveTemplateBox, FIT_PAD } from "../src/layout/template-fit";
import { TEXT_MIN } from "../src/layout/readable";
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
    const sc = { ...scene(), labels: [] };
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

  test("a label counts as ink at its preferred spot, so it lands inside the box too", () => {
    const box = { x: 520, y: 95, w: 360, h: 560 };
    const bare = fitSceneLayout({ ...scene(), labels: [] }, box, heuristicMeasure)!;
    const sc = scene();
    const fit = fitSceneLayout(sc, box, heuristicMeasure)!;
    // "Susceptible" to the right of the rectangle widens the union: the figure shrinks to make room…
    expect(fit.s).toBeLessThan(bare.s);
    // …so the label's anchor (the rectangle's right edge) sits further in from the box edge.
    const bareSc = { ...scene(), labels: [] };
    fitSceneLayout(bareSc, box, heuristicMeasure);
    const edge = (x: SceneLayout) => Math.max(...(x.drawables[0] as StrokeDrawable).pts.map((p) => p[0]));
    expect(box.x + box.w - edge(sc)).toBeGreaterThan(box.x + box.w - edge(bareSc) + 20);
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

  test("text shrinks with the figure but holds at the readable minimum (W30); smaller text keeps its own size", () => {
    const sc = scene();
    const { s } = fitSceneLayout(sc, { x: 520, y: 95, w: 360, h: 560 }, heuristicMeasure)!;
    expect(s).toBeLessThan(1);
    const t = sc.drawables[1] as TextDrawable;
    // Drawn at 30, it scales with the figure but never under TEXT_MIN.
    expect(t.fontSize).toBeCloseTo(Math.max(TEXT_MIN, 30 * s), 6);
    // A label drawn at 17 — under TEXT_MIN already — is not shrunk further.
    expect(17 * s).toBeLessThan(FONT_FLOOR);
    expect(sc.labels[0].fontSize).toBe(17);
  });

  test("with the lint's floor (a template that squeezes itself), text shrinks down to FONT_FLOOR as before", () => {
    const sc = scene();
    const { s } = fitSceneLayout(sc, { x: 520, y: 95, w: 360, h: 560 }, heuristicMeasure, FONT_FLOOR)!;
    const t = sc.drawables[1] as TextDrawable;
    expect(t.fontSize).toBeCloseTo(Math.max(FONT_FLOOR, 30 * s), 6);
    expect(sc.labels[0].fontSize).toBe(FONT_FLOOR);
  });

  test("fittedTextSize: scaled, then floored at min(own size, floor), never under FONT_FLOOR", () => {
    expect(fittedTextSize(22, 0.9)).toBeCloseTo(19.8, 6);
    expect(fittedTextSize(22, 0.7)).toBe(TEXT_MIN);
    expect(fittedTextSize(16, 0.7)).toBe(16);
    expect(fittedTextSize(10, 0.5)).toBe(FONT_FLOOR);
    expect(fittedTextSize(22, 0.5, FONT_FLOOR)).toBe(FONT_FLOOR);
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
