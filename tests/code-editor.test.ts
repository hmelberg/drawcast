// The in-place script editor: the pane rectangle the layout publishes for it,
// and where the card lands once that rectangle is in pixels. The DOM half
// (mounting, focus, the draft shared with the tray) is the live smoke's, as
// with every other stage overlay.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { LINE_PITCH } from "../src/layout/code";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { editorRect } from "../src/ui/code-editor";
import type { Spec } from "../src/spec/types";

const spec = (el: object): Spec =>
  ({ elements: [{ id: "c1", type: "code", language: "python", code: "print(1)", ...el }] }) as unknown as Spec;

const OK = JSON.stringify({ ok: true, stdout: "42", stderr: "", figures: [] });
const eight = Array.from({ length: 8 }, (_, i) => `line_${i} = ${i}`).join("\n");
const paneOf = (s: Spec) => layoutSpec(s, heuristicMeasure).panes?.["c1"];
const lineOf = (s: Spec, id: string) =>
  flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).find((d) => d.id === id) as TextDrawable;

describe("the pane rectangle the layout publishes", () => {
  test("covers the drawn lines, in every layout that draws code", () => {
    for (const show of ["left", "right", "above", "below", "code"]) {
      const s = spec({ show, code: eight, code_result: OK });
      const pane = paneOf(s)!;
      expect(pane, show).toBeDefined();
      const first = lineOf(s, "c1_line_1");
      const last = lineOf(s, "c1_line_8");
      // The lines start at the pane's left edge and sit inside it top to bottom.
      expect(first.pos[0]).toBeCloseTo(pane.x, 5);
      expect(first.pos[1]).toBeLessThanOrEqual(pane.y + pane.h);
      expect(last.pos[1]).toBeGreaterThanOrEqual(pane.y);
      expect(pane.w).toBeGreaterThan(0);
    }
  });

  test("no pane where no code is drawn — the tray's editor is the door there", () => {
    expect(paneOf(spec({ show: "output", code_result: OK }))).toBeUndefined();
    // …and a data-only element draws nothing at all.
    expect(paneOf(spec({ show: "none" }))).toBeUndefined();
  });

  test("a windowed pane's box is the WINDOW, not the whole script", () => {
    const windowed = paneOf(spec({ show: "left", code: eight, lines: 4, code_result: OK }))!;
    const whole = paneOf(spec({ show: "left", code: eight, code_result: OK }))!;
    expect(windowed.h).toBeLessThan(whole.h);
    // Four rows of the pitch the lines are stacked at, within a row's rounding.
    const fontSize = 17;
    expect(windowed.h).toBeCloseTo(4 * fontSize * LINE_PITCH - fontSize * (LINE_PITCH - 1.25), 5);
    // The box is where the four visible rows are: line 1 inside it, line 5
    // already below its floor, waiting for the plan to scroll it up.
    const s = spec({ show: "left", code: eight, lines: 4, code_result: OK });
    expect(lineOf(s, "c1_line_1").pos[1]).toBeLessThanOrEqual(windowed.y + windowed.h);
    expect(lineOf(s, "c1_line_1").pos[1]).toBeGreaterThan(windowed.y);
    expect(lineOf(s, "c1_line_5").pos[1]).toBeLessThan(windowed.y);
  });

  test("the box follows the panel's own font size and width", () => {
    const big = paneOf(spec({ show: "code", code: eight, font_size: 26, width: 600, code_result: OK }))!;
    const small = paneOf(spec({ show: "code", code: eight, font_size: 13, width: 600, code_result: OK }))!;
    expect(big.h).toBeGreaterThan(small.h);
    expect(big.w).toBeCloseTo(small.w, 5);
  });
});

describe("where the card lands", () => {
  const stage = { w: 800, h: 600 };
  const opts = { rowPx: 20, chinPx: 30, inset: 6 };

  test("a pane the size of a real script keeps its place, chrome and all", () => {
    const r = editorRect({ left: 100, top: 80, width: 300, height: 200 }, stage, opts);
    expect(r).toEqual({ left: 94, top: 74, width: 312, height: 242 });
  });

  test("a one-line script still gets something to type in", () => {
    const r = editorRect({ left: 100, top: 80, width: 300, height: 21 }, stage, opts);
    expect(r.height).toBe(20 * 6 + 12 + 30); // six rows, the card's chrome, the chin
  });

  test("a narrow pane widens to a usable width", () => {
    expect(editorRect({ left: 10, top: 10, width: 80, height: 200 }, stage, opts).width).toBe(240);
  });

  test("a pane at the bottom edge lifts so its chin stays on the picture", () => {
    const r = editorRect({ left: 100, top: 560, width: 300, height: 40 }, stage, opts);
    expect(r.top + r.height).toBeLessThanOrEqual(stage.h - 4);
    expect(r.top).toBeGreaterThanOrEqual(4);
  });

  test("a pane wider or taller than the figure is clamped to it, not spilled over it", () => {
    const r = editorRect({ left: -50, top: -20, width: 2000, height: 2000 }, stage, opts);
    expect(r.left).toBe(4);
    expect(r.top).toBe(4);
    expect(r.width).toBe(stage.w - 8);
    expect(r.height).toBe(stage.h - 8);
  });
});
