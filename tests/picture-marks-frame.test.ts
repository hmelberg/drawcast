import { describe, expect, test } from "vitest";
import { arrowGeometry, markFrameAt, washFor, markReleaseAt, MARK_GLIDE_MS, MARK_IN_MS, MARK_RELEASE_MS } from "../src/render/marks";
import type { BBox } from "../src/layout/geometry";
import { FIGURE_GROUND } from "../src/layout/ink";

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

  test("depth deepens from 0.28 to 0.5 over the step; glow breathes", () => {
    const step = { mark: "glow" as const, frame: FRAME, stops: [{ box: A, at: 0 }] };
    expect(markFrameAt(step, 0, 2000).depth).toBeCloseTo(0.28, 6);
    expect(markFrameAt(step, 2000, 2000).depth).toBeCloseTo(0.5, 6);
    expect(markFrameAt(step, 5000, 2000).depth).toBeCloseTo(0.5, 6);
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

describe("the arrow glides (fix round 1)", () => {
  test("a glide across the frame's middle moves tip and tail smoothly from A's arrow to B's", () => {
    // Left-low box points up-right; right-high box points down-left.
    const left = { x: 150, y: 150, w: 80, h: 80 };
    const right = { x: 780, y: 480, w: 100, h: 100 };
    const step = { mark: "arrow" as const, frame: FRAME, stops: [{ box: right, at: 0 }], from: left };
    const a = arrowGeometry(left, FRAME);
    const b = arrowGeometry(right, FRAME);
    expect(a.tail[0] > a.tip[0]).not.toBe(b.tail[0] > b.tip[0]); // the sides really flip
    const samples = Array.from({ length: 10 }, (_, k) => markFrameAt(step, (k * MARK_GLIDE_MS) / 9, 2000));
    expect(samples[0].tip).toEqual(a.tip);
    expect(samples[0].tail).toEqual(a.tail);
    expect(samples[9].tip).toEqual(b.tip);
    expect(samples[9].tail).toEqual(b.tail);
    // The box itself moves ~700 units in 550 ms; at 10 samples the ends move
    // with it, never a jump on top of that.
    const boxStep = (k: number) => Math.hypot(samples[k].box.x - samples[k - 1].box.x, samples[k].box.y - samples[k - 1].box.y);
    for (let k = 1; k < 10; k++) {
      const dTip = Math.hypot(samples[k].tip![0] - samples[k - 1].tip![0], samples[k].tip![1] - samples[k - 1].tip![1]);
      const dTail = Math.hypot(samples[k].tail![0] - samples[k - 1].tail![0], samples[k].tail![1] - samples[k - 1].tail![1]);
      expect(dTip).toBeLessThan(boxStep(k) + 20);
      expect(dTail).toBeLessThan(boxStep(k) + 20);
    }
  });

  test("a short glide (same side) moves the ends less than 20 units per sample", () => {
    const b1 = { x: 200, y: 200, w: 60, h: 60 };
    const b2 = { x: 300, y: 260, w: 60, h: 60 };
    const step = { mark: "arrow" as const, frame: FRAME, stops: [{ box: b2, at: 0 }], from: b1 };
    const samples = Array.from({ length: 10 }, (_, k) => markFrameAt(step, (k * MARK_GLIDE_MS) / 9, 2000));
    for (let k = 1; k < 10; k++) {
      expect(Math.hypot(samples[k].tip![0] - samples[k - 1].tip![0], samples[k].tip![1] - samples[k - 1].tip![1])).toBeLessThan(20);
      expect(Math.hypot(samples[k].tail![0] - samples[k - 1].tail![0], samples[k].tail![1] - samples[k - 1].tail![1])).toBeLessThan(20);
    }
  });

  test("resting and released, the arrow is arrowGeometry of its box", () => {
    const step = { mark: "arrow" as const, frame: FRAME, stops: [{ box: A, at: 0 }, { box: B, at: 0.5 }] };
    expect(markFrameAt(step, 300, 2000)).toMatchObject(arrowGeometry(A, FRAME));
    expect(markReleaseAt(step, 100, 2000)).toMatchObject(arrowGeometry(B, FRAME));
  });
});

describe("the glow keeps breathing through its release (fix round 1)", () => {
  test("breathe at release start equals breathe at the step's end", () => {
    const step = { mark: "glow" as const, frame: FRAME, stops: [{ box: A, at: 0 }] };
    for (const dur of [1000, 1900, 2345]) {
      expect(markReleaseAt(step, 0, dur).breathe).toBeCloseTo(markFrameAt(step, dur, dur).breathe, 9);
    }
  });
});

describe("arrows reach wide and tall parts from inside the picture (tuning)", () => {
  const inside = (p: [number, number], f: BBox) => p[0] >= f.x && p[0] <= f.x + f.w && p[1] >= f.y && p[1] <= f.y + f.h;

  test("a full-width thin bar at the bottom: from above, near its left fifth, all inside the frame", () => {
    const bar = { x: FRAME.x, y: FRAME.y + 10, w: FRAME.w, h: 30 };
    const { tip, tail } = arrowGeometry(bar, FRAME);
    expect(inside(tip, FRAME)).toBe(true);
    expect(inside(tail, FRAME)).toBe(true);
    expect(tip[0]).toBeGreaterThanOrEqual(bar.x);
    expect(tip[0]).toBeLessThanOrEqual(bar.x + bar.w / 5);
    expect(tip[1]).toBeGreaterThan(bar.y + bar.h);
    expect(tail[1]).toBeGreaterThan(tip[1]);
  });

  test("a wide bar near the frame's top is reached from below", () => {
    const bar = { x: 200, y: FRAME.y + FRAME.h - 60, w: 500, h: 30 };
    const { tip, tail } = arrowGeometry(bar, FRAME);
    expect(tip[1]).toBeLessThan(bar.y);
    expect(tail[1]).toBeLessThan(tip[1]);
    expect(inside(tail, FRAME)).toBe(true);
  });

  test("a tall thin box: the tail goes out to the side, the tip near its upper end", () => {
    const post = { x: 200, y: 150, w: 30, h: 400 };
    const { tip, tail } = arrowGeometry(post, FRAME);
    expect(tip[0]).toBeGreaterThan(post.x + post.w);
    expect(tail[0] - tip[0]).toBeGreaterThanOrEqual(60);
    expect(Math.abs(tail[1] - tip[1])).toBeLessThan(Math.abs(tail[0] - tip[0]));
    expect(tip[1]).toBeGreaterThan(post.y + post.h / 2);
    expect(inside(tail, FRAME)).toBe(true);
  });

  test("tip and tail are always clamped into the frame", () => {
    const corner = { x: FRAME.x + FRAME.w - 20, y: FRAME.y + FRAME.h - 400, w: 20, h: 400 };
    const { tip, tail } = arrowGeometry(corner, FRAME);
    expect(inside(tip, FRAME)).toBe(true);
    expect(inside(tail, FRAME)).toBe(true);
  });
});

describe("washFor: the light follows the picture's tone", () => {
  test("a dark picture gets a torch, a light or unknown one the paper wash", () => {
    expect(washFor(0.3)).toEqual({ color: "#1b140e", lift: 0.16 });
    expect(washFor(0.8)).toEqual({ color: FIGURE_GROUND, lift: 0.1 });
    expect(washFor(null)).toEqual({ color: FIGURE_GROUND, lift: 0.1 });
  });
});


test("a turned picture's step: every frame and the release say turned", () => {
  const box: BBox = { x: 10, y: 10, w: 20, h: 20 };
  const step = { mark: "light" as const, frame: { x: 0, y: 0, w: 100, h: 100 }, stops: [{ box, at: 0 }], turned: true };
  expect(markFrameAt(step, 100, 1000).turned).toBe(true);
  expect(markReleaseAt(step, 100).turned).toBe(true);
  expect(markFrameAt({ ...step, turned: undefined }, 100, 1000).turned).toBeUndefined();
});
