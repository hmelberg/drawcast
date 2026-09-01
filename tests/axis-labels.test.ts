// B13 — where an axes element's x_label / y_label land.
//
// Hans's rule, in his words: the captions are "a compromise of many factors"
// — a long caption set in line with the axis eats the figure, and a caption
// centred under the axis takes the space we want for markings at crossing
// points. So: right-justify the x label below the axis, but END IT AT THE
// ARROW rather than short of it, and tighten the vertical gap; centre a short
// y label on top of its arrow, and let a long one start at or left of the y
// axis. These tests pin the geometry that implements that.

import { describe, expect, test } from "vitest";
import { AXIS_OVERHANG, axisLabelPlacement, makeAxes } from "../src/layout/axes";
import { CANVAS, plotArea } from "../src/layout/canvas";
import { bboxOfText } from "../src/layout/geometry";
import { heuristicMeasure } from "../src/layout/measure";
import { leafDrawables, type TextDrawable } from "../src/layout/model";

const plot = plotArea(); // x0 120, y0 95, x1 930, y1 675
const X_TIP = plot.x1 + AXIS_OVERHANG; // 952
const Y_TIP = plot.y1 + AXIS_OVERHANG; // 697

/** The label's box, the way lint and the collision solver see it. */
function box(axis: "x" | "y", text: string, fontSize = 28) {
  const { pos, anchor } = axisLabelPlacement(axis, plot, text, fontSize);
  const t: TextDrawable = { id: "t", kind: "text", pos, text, fontSize, anchor } as TextDrawable;
  return bboxOfText(t, heuristicMeasure);
}

describe("x axis label", () => {
  test("a phrase is right-justified with its right edge ON the arrow tip", () => {
    const p = axisLabelPlacement("x", plot, "Quantity (Q)", 28);
    expect(p.inline).toBe(false);
    expect(p.anchor).toBe("end");
    expect(p.pos[0]).toBe(X_TIP);
    expect(box("x", "Quantity (Q)").x + box("x", "Quantity (Q)").w).toBe(X_TIP);
  });

  test("it sits tighter under the axis than the old 34.5-unit gap", () => {
    const b = box("x", "Quantity (Q)", 28);
    const gap = plot.y0 - (b.y + b.h);
    expect(gap).toBe(16);
    expect(gap).toBeLessThan(34.5); // the placement this replaced
  });

  test("the gap is measured from the box, so every font size clears the axis by the same amount", () => {
    for (const fs of [20, 21, 22, 24, 26, 28]) {
      const b = box("x", "Willingness to pay", fs);
      expect(plot.y0 - (b.y + b.h)).toBe(16);
    }
  });

  test("a one-symbol label goes in line with the axis, just past the arrow", () => {
    const p = axisLabelPlacement("x", plot, "x", 28);
    expect(p.inline).toBe(true);
    expect(p.anchor).toBe("start");
    expect(p.pos[0]).toBeGreaterThan(X_TIP); // clear of the arrowhead
    expect(p.pos[1]).toBe(plot.y0); // vertically centred on the axis line
  });

  test("an inline label never leaves the canvas", () => {
    const b = box("x", "x", 28);
    expect(b.x + b.w).toBeLessThanOrEqual(CANVAS.w);
  });

  test("a word too wide for the strip beyond the arrow drops back below the axis", () => {
    // ~3 characters is all the standard plot leaves to the right of the arrow.
    expect(axisLabelPlacement("x", plot, "Time", 28).inline).toBe(false);
    expect(axisLabelPlacement("x", plot, "Guns", 26).inline).toBe(false);
  });

  test("a phrase never goes inline even where the canvas would allow it", () => {
    // A short plot box leaves plenty of room past the arrow — but a phrase in
    // line with the axis is exactly what the below-right compromise avoids.
    const narrow = { ...plot, x1: 600 };
    expect(axisLabelPlacement("x", narrow, "Net monetary benefit", 21).inline).toBe(false);
    expect(axisLabelPlacement("x", narrow, "t", 21).inline).toBe(true);
  });
});

describe("y axis label", () => {
  test("a short label is centred on the arrow tip", () => {
    const p = axisLabelPlacement("y", plot, "Price (P)", 28);
    expect(p.anchor).toBe("middle");
    expect(p.pos[0]).toBe(plot.x0);
    const b = box("y", "Price (P)");
    expect(b.x + b.w / 2).toBeCloseTo(plot.x0, 6);
  });

  test("a short label CLEARS the arrow tip by the full gap, even on the standard plot", () => {
    // The regression Hans hit (2026-09-02): with only 33 units of headroom
    // the canvas-top clamp used to press the label box down ONTO the
    // arrowhead. PLOT_MARGIN.top now leaves room for arrow + gap + label,
    // so the gap is real everywhere — and the box still stays on canvas.
    const b = box("y", "Price (P)");
    expect(b.y - Y_TIP).toBe(12);
    expect(b.y + b.h).toBeLessThanOrEqual(CANVAS.h);
  });

  test("a long label ends at or left of the y axis and stays on canvas", () => {
    const b = box("y", "Interest rate (r)", 28);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(plot.x0); // starts at or left of the y
    expect(box("y", "Interest rate (r)", 28).x).toBeLessThan(box("y", "Price (P)", 28).x);
  });

  test("the short/long threshold is where centring would fall off the canvas", () => {
    // short ⟺ w ≤ 2 × (plot.x0 − 4) = 232 logical units ≈ 15 chars at 28pt.
    const fits = "x".repeat(15); // w = 218.4
    const spills = "x".repeat(17); // w = 247.5
    expect(heuristicMeasure(fits, 28).w).toBeLessThanOrEqual(232);
    expect(heuristicMeasure(spills, 28).w).toBeGreaterThan(232);
    expect(axisLabelPlacement("y", plot, fits, 28).pos[0]).toBe(plot.x0);
    expect(axisLabelPlacement("y", plot, spills, 28).pos[0]).toBeGreaterThan(plot.x0);
  });

  test("it hugs its own arrow when the plot box is short, not the canvas top", () => {
    const short = { ...plot, y1: 608 }; // the ceac plot box
    const p = axisLabelPlacement("y", short, "Probability cost-effective", 20);
    const b = bboxOfText({ id: "t", kind: "text", pos: p.pos, text: "Probability cost-effective", fontSize: 20, anchor: p.anchor } as TextDrawable, heuristicMeasure);
    expect(b.y - (short.y1 + AXIS_OVERHANG)).toBe(12);
  });

  test("a long label never crosses the canvas edge", () => {
    const b = box("y", "Cumulative share of total household income", 28);
    expect(b.x).toBeGreaterThanOrEqual(0);
  });
});

describe("makeAxes uses the shared placement", () => {
  test("its labels land exactly where axisLabelPlacement says", () => {
    const leaves = leafDrawables([makeAxes("axes", plot, "Quantity (Q)", "Price (P)")]);
    const x = leaves.find((d) => d.id === "axes_x_label") as TextDrawable;
    const y = leaves.find((d) => d.id === "axes_y_label") as TextDrawable;
    expect(x.pos).toEqual(axisLabelPlacement("x", plot, "Quantity (Q)", 28).pos);
    expect(x.anchor).toBe("end");
    expect(y.pos).toEqual(axisLabelPlacement("y", plot, "Price (P)", 28).pos);
    expect(y.anchor).toBe("middle");
  });

  test("the arrow tips the labels hang off are the axis strokes' own ends", () => {
    const leaves = leafDrawables([makeAxes("axes", plot, "q", "p")]);
    const xs = leaves.find((d) => d.id === "axes_x");
    const ys = leaves.find((d) => d.id === "axes_y");
    expect(xs && xs.kind === "stroke" && xs.pts[1]).toEqual([X_TIP, plot.y0]);
    expect(ys && ys.kind === "stroke" && ys.pts[1]).toEqual([plot.x0, Y_TIP]);
  });
});
