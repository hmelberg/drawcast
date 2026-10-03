// The fill advisory (lint/fill.ts, page frame spec 2026-10-04 §6).
import { describe, expect, test } from "vitest";
import { fillIssue, fullestFrames } from "../src/lint/fill";
import { contentBox } from "../src/layout/page";

describe("fill advisory", () => {
  const c = contentBox();
  test("a small figure alone on the page is flagged; the heading does not count", () => {
    const boxes: [string, { x: number; y: number; w: number; h: number }][] = [
      ["dot", { x: 450, y: 380, w: 0.3 * c.w, h: 0.3 * c.h }],
      ["card_0_title", { x: 200, y: 700, w: 600, h: 40 }],
    ];
    const issue = fillIssue(boxes, { heading: true });
    expect(issue?.rule).toBe("fill");
    expect(issue?.severity).toBe("warn");
    expect(issue?.message).toMatch(/^small figure on an empty page/);
  });
  test("wide OR tall enough passes; an empty page is not judged", () => {
    expect(fillIssue([["bar", { x: 60, y: 300, w: 0.5 * c.w, h: 20 }]], { heading: true })).toBeNull();
    expect(fillIssue([["col", { x: 400, y: 160, w: 20, h: 0.5 * c.h }]], { heading: true })).toBeNull();
    expect(fillIssue([], { heading: true })).toBeNull();
  });
  test("only what is visible counts", () => {
    const boxes: [string, { x: number; y: number; w: number; h: number }][] = [
      ["small", { x: 450, y: 380, w: 50, h: 50 }],
      ["big", { x: 60, y: 160, w: 800, h: 400 }],
    ];
    expect(fillIssue(boxes, { heading: true, visible: (id) => id === "small" })).not.toBeNull();
    expect(fillIssue(boxes, { heading: true })).toBeNull();
  });
  test("a page is judged at its fullest: before something is taken away, and at the end", () => {
    expect(fullestFrames([1, 2, 3, 1, 2])).toEqual([2, 4]);
    expect(fullestFrames([5])).toEqual([0]);
  });
});
