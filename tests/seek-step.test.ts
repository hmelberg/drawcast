import { describe, expect, test } from "vitest";
import { seekStep } from "../src/ui/controls";

// C7: one rule for the click handler and the hover preview — the chip's
// promise IS where the click goes.
describe("seekStep", () => {
  test("maps the bar's width onto whole steps, clamped to the ends", () => {
    expect(seekStep(0, 0, 100, 10)).toBe(0);
    expect(seekStep(50, 0, 100, 10)).toBe(5);
    expect(seekStep(100, 0, 100, 10)).toBe(10);
    expect(seekStep(-20, 0, 100, 10)).toBe(0);
    expect(seekStep(140, 0, 100, 10)).toBe(10);
  });

  test("a zero-width bar (hidden mid-layout) cannot divide by zero", () => {
    expect(seekStep(50, 0, 0, 10)).toBe(0);
  });
});
