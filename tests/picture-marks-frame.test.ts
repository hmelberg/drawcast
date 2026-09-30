import { describe, expect, test } from "vitest";
import { arrowGeometry, markFrameAt, markReleaseAt, MARK_GLIDE_MS, MARK_IN_MS, MARK_RELEASE_MS } from "../src/render/marks";
import type { BBox } from "../src/layout/geometry";

const FRAME: BBox = { x: 100, y: 100, w: 800, h: 500 };
const A: BBox = { x: 200, y: 200, w: 100, h: 100 };
const B: BBox = { x: 600, y: 400, w: 200, h: 60 };
const C: BBox = { x: 400, y: 150, w: 50, h: 50 };

describe("markFrameAt", () => {
  test("the timings are the ones the spec fixes", () => {
    expect([MARK_IN_MS, MARK_GLIDE_MS, MARK_RELEASE_MS]).toEqual([450, 550, 280]);
  });

  test("without from: appears at stop 0, level and write rising over 450 ms", () => {
    const step = { mark: "light" as const, frame: FRAME, stops: [{ box: A, at: 0 }] };
    const f0 = markFrameAt(step, 0, 2000);
    expect(f0.level).toBe(0);
    expect(f0.write).toBe(0);
    expect(f0.box).toEqual(A);
    const mid = markFrameAt(step, 200, 2000);
    expect(mid.level).toBeGreaterThan(0);
    expect(mid.level).toBeLessThan(1);
    const f1 = markFrameAt(step, 450, 2000);
    expect(f1.level).toBe(1);
    expect(f1.write).toBe(1);
    expect(f1.box).toEqual(A);
    expect(f1.kind).toBe("light");
    expect(f1.frame).toEqual(FRAME);
  });

  test("with from: starts present at from and glides to stop 0 over 550 ms", () => {
    const step = { mark: "ring" as const, frame: FRAME, stops: [{ box: A, at: 0 }], from: B };
    const f0 = markFrameAt(step, 0, 2000);
    expect(f0.box).toEqual(B);
    expect(f0.level).toBe(1);
    expect(f0.write).toBe(1);
    expect(markFrameAt(step, 550, 2000).box).toEqual(A);
    expect(markFrameAt(step, 1500, 2000).box).toEqual(A);
  });

  test("three stops: each glides in from the one before, ease-in-out", () => {
    const step = { mark: "arrow" as const, frame: FRAME, stops: [{ box: A, at: 0 }, { box: B, at: 1 / 3 }, { box: C, at: 2 / 3 }] };
    expect(markFrameAt(step, 1000, 3000).box).toEqual(A);
    const half = markFrameAt(step, 1275, 3000).box;
    for (const k of ["x", "y", "w", "h"] as const) expect(half[k]).toBeCloseTo((A[k] + B[k]) / 2, 6);
    expect(markFrameAt(step, 1550, 3000).box).toEqual(B);
    expect(markFrameAt(step, 2000, 3000).box).toEqual(B);
    expect(markFrameAt(step, 3000, 3000).box).toEqual(C);
  });

  test("a gap shorter than a glide squeezes the glide into it", () => {
    const step = { mark: "light" as const, frame: FRAME, stops: [{ box: A, at: 0 }, { box: B, at: 0.5 }, { box: C, at: 0.6 }] };
    // Stop 1 begins at 500 ms and has 100 ms before stop 2 begins.
    expect(markFrameAt(step, 600, 1000).box).toEqual(B);
  });

  test("depth deepens from 0.35 to 0.62 over the step; glow breathes", () => {
    const step = { mark: "glow" as const, frame: FRAME, stops: [{ box: A, at: 0 }] };
    expect(markFrameAt(step, 0, 2000).depth).toBeCloseTo(0.35, 6);
    expect(markFrameAt(step, 2000, 2000).depth).toBeCloseTo(0.62, 6);
    expect(markFrameAt(step, 5000, 2000).depth).toBeCloseTo(0.62, 6);
    expect(markFrameAt(step, 0, 2000).breathe).toBeCloseTo(1, 6);
    expect(markFrameAt(step, 400, 2000).breathe).toBeCloseTo(1.08, 6);
    expect(markFrameAt(step, 1200, 2000).breathe).toBeCloseTo(0.92, 6);
  });
});

describe("markReleaseAt", () => {
  test("level falls 1 → 0 over 280 ms, at the step's last box", () => {
    const step = { mark: "light" as const, frame: FRAME, stops: [{ box: A, at: 0 }, { box: B, at: 0.5 }] };
    const r0 = markReleaseAt(step, 0);
    expect(r0.level).toBe(1);
    expect(r0.box).toEqual(B);
    expect(markReleaseAt(step, 140).level).toBeGreaterThan(0);
    expect(markReleaseAt(step, 140).level).toBeLessThan(1);
    expect(markReleaseAt(step, 280).level).toBe(0);
    expect(markReleaseAt(step, 400).level).toBe(0);
  });
});

describe("arrowGeometry", () => {
  const inside = (p: [number, number], f: BBox) => p[0] >= f.x && p[0] <= f.x + f.w && p[1] >= f.y && p[1] <= f.y + f.h;

  test("default: the tail goes up and right, the tip just outside the box", () => {
    const box = { x: 200, y: 200, w: 100, h: 100 };
    const { tip, tail } = arrowGeometry(box, FRAME);
    expect(tip[0]).toBeGreaterThan(box.x + box.w);
    expect(tail[0]).toBeGreaterThan(tip[0]);
    expect(tail[1]).toBeGreaterThan(tip[1]);
    expect(inside(tail, FRAME)).toBe(true);
  });

  test("a box in the top-right corner points in from the left or below, inside the frame", () => {
    const box = { x: 780, y: 480, w: 100, h: 100 };
    const { tip, tail } = arrowGeometry(box, FRAME);
    expect(tail[0] < tip[0] || tail[1] < tip[1]).toBe(true);
    expect(inside(tail, FRAME)).toBe(true);
    // The tip is outside the box.
    const inBox = tip[0] > box.x && tip[0] < box.x + box.w && tip[1] > box.y && tip[1] < box.y + box.h;
    expect(inBox).toBe(false);
  });
});
