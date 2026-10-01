// The figure gates' layout rules (2026-10-03 fix wave): the answer dock
// never lies on the caption (the drawing gives up height when the caption
// sits under it), and a field opened on a blank goes next to it, never over it.
import { describe, expect, test } from "vitest";
import { dockShrink } from "../src/ui/gate-dock";
import { nearSpot, unionRect, type StageRect } from "../src/ui/number-edit";

const overlaps = (a: StageRect, b: StageRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("dockShrink: drawing + caption + dock fit the stage", () => {
  test("overlay captions step up instead: no shrink", () => {
    expect(dockShrink({ mode: "overlay", stageH: 500, svgH: 500, captionH: 40, dockH: 50 })).toBe(0);
  });
  test("strip: the shortfall, rounded up", () => {
    // 1280×800 cigarettes: stage 557, drawing 501, strip 34, dock 50 → 28.
    expect(dockShrink({ mode: "strip", stageH: 557, svgH: 501, captionH: 34, dockH: 50 })).toBe(28);
  });
  test("below with room to spare: none", () => {
    expect(dockShrink({ mode: "below", stageH: 600, svgH: 400, captionH: 60, dockH: 50 })).toBe(0);
  });
});

describe("nearSpot: next to the blank, never over it", () => {
  const stage = { w: 400, h: 300 };
  const box: StageRect = { left: 180, top: 40, right: 220, bottom: 60 };
  const spotRect = (s: { left: number; top: number }, size: { w: number; h: number }): StageRect => ({ left: s.left, top: s.top, right: s.left + size.w, bottom: s.top + size.h });

  test("below by default, centred", () => {
    const size = { w: 100, h: 30 };
    const s = nearSpot(box, size, stage);
    expect(s.side).toBe("below");
    expect(s.left).toBe(150);
    expect(overlaps(spotRect(s, size), box)).toBe(false);
  });
  test("above when the floor (caption, dock) leaves no room below", () => {
    const low: StageRect = { left: 180, top: 200, right: 220, bottom: 220 };
    const size = { w: 100, h: 40 };
    const s = nearSpot(low, size, { ...stage, floor: 80 });
    expect(s.side).toBe("above");
    expect(overlaps(spotRect(s, size), low)).toBe(false);
  });
  test("beside when neither above nor below fits", () => {
    const tall: StageRect = { left: 20, top: 10, right: 120, bottom: 200 };
    const size = { w: 100, h: 40 };
    const s = nearSpot(tall, size, { ...stage, floor: 80 });
    expect(s.side).toBe("right");
    expect(overlaps(spotRect(s, size), tall)).toBe(false);
  });
  test("clamped into the stage at the edges", () => {
    const edge: StageRect = { left: 380, top: 40, right: 398, bottom: 60 };
    const s = nearSpot(edge, { w: 100, h: 30 }, stage);
    expect(s.left + 100).toBeLessThanOrEqual(396);
  });
  test("the whole formula is kept clear, not only the box (a fraction's dx under it)", () => {
    const formula: StageRect = { left: 150, top: 30, right: 230, bottom: 90 };
    const size = { w: 120, h: 50 };
    const s = nearSpot(unionRect(box, formula)!, size, stage);
    expect(s.top).toBeGreaterThanOrEqual(90);
  });
  test("no room anywhere: under it all the same, over the floor", () => {
    const wide: StageRect = { left: 4, top: 20, right: 396, bottom: 60 };
    const size = { w: 300, h: 120 };
    const s = nearSpot(wide, size, { ...stage, floor: 150 });
    expect(s.side).toBe("over-floor");
    expect(overlaps(spotRect(s, size), wide)).toBe(false);
  });
});
