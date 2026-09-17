// Pure navigation rules for a multi-item playlist (player-nav round,
// 2026-09-17): the step buttons cross item borders instead of clamping at
// them, and the replay after the last item restarts the whole drawcast.
import { describe, expect, test } from "vitest";
import { edgeStep, replayTarget } from "../src/playlist/nav-model";

describe("edgeStep — step buttons at an item's border", () => {
  test("back at step 0 of a middle item lands on the previous item, at its end", () => {
    expect(edgeStep("back", { completed: 0, total: 5, idx: 2, count: 4 })).toEqual({ index: 1, at: "end" });
  });
  test("back mid-item is an ordinary step (null)", () => {
    expect(edgeStep("back", { completed: 3, total: 5, idx: 2, count: 4 })).toBeNull();
  });
  test("back at step 0 of the first item stays put", () => {
    expect(edgeStep("back", { completed: 0, total: 5, idx: 0, count: 4 })).toBeNull();
  });
  test("back on the title page (idx -1) stays put", () => {
    expect(edgeStep("back", { completed: 0, total: 3, idx: -1, count: 4 })).toBeNull();
  });
  test("forward at the last step of a middle item lands on the next item, at its start", () => {
    expect(edgeStep("forward", { completed: 5, total: 5, idx: 2, count: 4 })).toEqual({ index: 3, at: "start" });
  });
  test("forward mid-item is an ordinary step (null)", () => {
    expect(edgeStep("forward", { completed: 4, total: 5, idx: 2, count: 4 })).toBeNull();
  });
  test("forward at the end of the last item stays put", () => {
    expect(edgeStep("forward", { completed: 5, total: 5, idx: 3, count: 4 })).toBeNull();
  });
  test("forward at the end of the title page (idx -1) lands on the first item", () => {
    expect(edgeStep("forward", { completed: 3, total: 3, idx: -1, count: 4 })).toEqual({ index: 0, at: "start" });
  });
  test("a single-item playlist never crosses (count 1)", () => {
    expect(edgeStep("forward", { completed: 5, total: 5, idx: 0, count: 1 })).toBeNull();
    expect(edgeStep("back", { completed: 0, total: 5, idx: 0, count: 1 })).toBeNull();
  });
});

describe("replayTarget — play pressed after the whole drawcast finished", () => {
  test("after the last item has finished playing, replay starts at the title page when there is one", () => {
    expect(replayTarget({ finishedLast: true, hasTitle: true })).toBe("title");
  });
  test("…and at the first item when there is no title page", () => {
    expect(replayTarget({ finishedLast: true, hasTitle: false })).toBe("first");
  });
  test("a poster that was merely jumped to (not finished) plays itself: null", () => {
    expect(replayTarget({ finishedLast: false, hasTitle: true })).toBeNull();
  });
});
