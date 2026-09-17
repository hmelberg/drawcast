import { describe, expect, test } from "vitest";
import { columnSlots, fitPicture, hasDefaultColumnInsets, isDefaultColumn, INSET_GAP, INSET_H, INSET_MAX, INSET_RIGHT, INSET_STROKE_FLOOR, INSET_TOP, INSET_W } from "../src/layout/inset";
import { defaultStyle, type Drawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";

const stroke = (id: string, pts: [number, number][], strokeWidth = 2, roughness = 1.4): StrokeDrawable => ({
  id, kind: "stroke", pts, z: 1, style: defaultStyle({ strokeWidth, roughness }), drawOpts: { mode: "sketch", duration: 900 },
});
const text = (id: string, pos: [number, number], fontSize = 28): TextDrawable => ({
  id, kind: "text", pos, text: "hi", fontSize, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: { mode: "sketch", duration: 300 },
});

describe("default column slots (spec §4.5)", () => {
  test("k = 0..4 stack from the top down against the right edge at the fixed size", () => {
    const slots = columnSlots(5);
    expect(slots).toHaveLength(5);
    slots.forEach((s, k) => {
      expect(s.w).toBe(INSET_W);
      expect(s.h).toBe(INSET_H);
      expect(s.x + s.w).toBe(INSET_RIGHT);
      expect(s.y + s.h).toBe(INSET_TOP - k * (INSET_H + INSET_GAP));
    });
    expect(slots[4].y).toBeGreaterThanOrEqual(20);
  });
  test("more than INSET_MAX shrink uniformly and stay inside the canvas", () => {
    const slots = columnSlots(INSET_MAX + 2);
    expect(slots).toHaveLength(INSET_MAX + 2);
    const h = slots[0].h;
    for (const s of slots) {
      expect(s.h).toBe(h);
      expect(s.h).toBeLessThan(INSET_H);
      expect(s.w / s.h).toBeCloseTo(4 / 3, 5);
      expect(s.y).toBeGreaterThanOrEqual(20);
      expect(s.x + s.w).toBe(INSET_RIGHT);
    }
    expect(slots[slots.length - 1].y).toBeGreaterThanOrEqual(19.9);
  });
});

describe("isDefaultColumn", () => {
  test("an inset with no position is in the column; x/y or at takes it out", () => {
    expect(isDefaultColumn({ id: "a", type: "inset", of: "1" } as any)).toBe(true);
    expect(isDefaultColumn({ id: "a", type: "inset", of: "1", width: 300 } as any)).toBe(true);
    expect(isDefaultColumn({ id: "a", type: "inset", of: "1", x: 100, y: 100 } as any)).toBe(false);
    expect(isDefaultColumn({ id: "a", type: "inset", of: "1", at: { ref: "b", side: "right" } } as any)).toBe(false);
    expect(isDefaultColumn({ id: "a", type: "image", of: "1" })).toBe(false);
    expect(hasDefaultColumnInsets([{ id: "a", type: "inset", of: "1" } as any])).toBe(true);
    expect(hasDefaultColumnInsets([{ id: "a", type: "inset", of: "1", x: 1, y: 1 } as any])).toBe(false);
    expect(hasDefaultColumnInsets(undefined)).toBe(false);
  });
});

describe("fitPicture (spec §3 crop, §4.4)", () => {
  const picture = {
    drawables: [stroke("s", [[100, 100], [300, 100], [300, 250]]), text("t", [200, 260])] as Drawable[],
    ink: { x: 100, y: 100, w: 200, h: 160 },
  };
  const slot = { x: 820, y: 610, w: 160, h: 120 };

  test("crop: true fits the ink union (padded) into the slot's inner box", () => {
    const { children, s } = fitPicture(picture, slot, true);
    const st = children[0] as StrokeDrawable;
    for (const [x, y] of st.pts) {
      expect(x).toBeGreaterThanOrEqual(slot.x);
      expect(x).toBeLessThanOrEqual(slot.x + slot.w);
      expect(y).toBeGreaterThanOrEqual(slot.y);
      expect(y).toBeLessThanOrEqual(slot.y + slot.h);
    }
    // 200 × 160 of ink (+12 pad each side → 224 × 184) into 148 × 108: the height binds.
    expect(s).toBeCloseTo(108 / 184, 5);
  });
  test("crop: false fits the whole 1000 × 750 canvas, so the scale is the slot's", () => {
    const { s, dx, dy } = fitPicture(picture, slot, false);
    expect(s).toBeCloseTo(108 / 750, 5);
    // The canvas origin lands at the inner box's origin plus the centring slack.
    expect(dy).toBeCloseTo(slot.y + 6, 5);
    expect(dx).toBeCloseTo(slot.x + 6 + (148 - 1000 * s) / 2, 5);
  });
  test("stroke width and roughness are divided by the scale; width is floored; text scales; durations shrink", () => {
    const { children, s } = fitPicture(picture, slot, true);
    const st = children[0] as StrokeDrawable;
    expect(st.style.roughness).toBeCloseTo(1.4 * s, 5);
    expect(st.style.strokeWidth).toBe(Math.max(INSET_STROKE_FLOOR, 2 * s));
    const tx = children[1] as TextDrawable;
    expect(tx.fontSize).toBeCloseTo(28 * s, 5);
    expect(st.drawOpts.duration).toBe(Math.max(20, Math.round(900 * s)));
  });
  test("the input picture is untouched", () => {
    const before = JSON.stringify(picture);
    fitPicture(picture, slot, true);
    expect(JSON.stringify(picture)).toBe(before);
  });
});

describe("arrowheads shrink with the picture", () => {
  test("fitPicture scales a stroke's headSize with s, floored at ARROWHEAD_FLOOR", async () => {
    const { ARROWHEAD_SIZE, ARROWHEAD_FLOOR } = await import("../src/layout/model");
    const { scaleDrawables } = await import("../src/layout/place");
    const arrow = { ...stroke("a", [[100, 100], [300, 100]]), arrowhead: "end" as const };
    const plain = stroke("b", [[100, 100], [300, 100]]);
    const ds: Drawable[] = [arrow, plain];
    scaleDrawables(ds, 0.5, 0, 0);
    expect((ds[0] as StrokeDrawable).headSize).toBeCloseTo(ARROWHEAD_SIZE * 0.5, 5);
    expect((ds[1] as StrokeDrawable).headSize).toBeUndefined();
    scaleDrawables(ds, 0.01, 0, 0);
    expect((ds[0] as StrokeDrawable).headSize).toBe(ARROWHEAD_FLOOR);
    // Through fitPicture the same: a 1/6 thumbnail gets a 1/6 head.
    const pic = { drawables: [{ ...stroke("c", [[0, 0], [600, 0]]), arrowhead: "end" as const }] as Drawable[], ink: { x: 0, y: 0, w: 600, h: 450 } };
    const { children, s } = fitPicture(pic, { x: 820, y: 610, w: 160, h: 120 }, true);
    expect((children[0] as StrokeDrawable).headSize).toBeCloseTo(Math.max(ARROWHEAD_FLOOR, ARROWHEAD_SIZE * s), 5);
  });
});
