// The code panel round: layouts (show names where the code sits), the
// scrolling window (lines), its clip and published bottoms, the output
// tail, and the plan's scroll offsets. Pure node: layout geometry and plan
// states; the player tween and the clip rendering are the live smoke's.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { planCommands } from "../src/render/plan";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = []): Spec =>
  ({ elements: [{ id: "c1", type: "code", language: "python", code: "print(1)", ...el }], commands }) as unknown as Spec;

const OK = JSON.stringify({ ok: true, stdout: Array.from({ length: 12 }, (_, i) => `row ${i}`).join("\n"), stderr: "", figures: [] });
const eight = Array.from({ length: 8 }, (_, i) => `line_${i} = ${i}`).join("\n");
const leaf = (s: Spec, id: string) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).find((d) => d.id === id)!;
const textOf = (s: Spec, id: string) => leaf(s, id) as TextDrawable;

describe("code panel layouts", () => {
  test("left and right mirror each other; above and below stack at full width", () => {
    const L = textOf(spec({ show: "left", code: eight, code_result: OK }), "c1_line_1");
    const R = textOf(spec({ show: "right", code: eight, code_result: OK }), "c1_line_1");
    expect(R.pos[0]).toBeGreaterThan(L.pos[0]);
    const aLine = textOf(spec({ show: "above", code: eight, code_result: OK }), "c1_line_1");
    const aOut = textOf(spec({ show: "above", code: eight, code_result: OK }), "c1__out0");
    expect(aLine.pos[1]).toBeGreaterThan(aOut.pos[1]);
    expect(aLine.pos[0]).toBe(aOut.pos[0]);
    const bLine = textOf(spec({ show: "below", code: eight, code_result: OK }), "c1_line_1");
    const bOut = textOf(spec({ show: "below", code: eight, code_result: OK }), "c1__out0");
    expect(bLine.pos[1]).toBeLessThan(bOut.pos[1]);
  });
  test("a window positions every line at its natural row, clips each, and publishes bottoms and height", () => {
    const l = layoutSpec(spec({ show: "left", code: eight, lines: 4, code_result: OK }), heuristicMeasure);
    const win = l.windows!["c1"];
    expect(win.ids).toEqual(Array.from({ length: 8 }, (_, i) => `c1_line_${i + 1}`));
    expect(win.bottoms.length).toBe(8);
    for (let i = 1; i < 8; i++) expect(win.bottoms[i]).toBeGreaterThan(win.bottoms[i - 1]);
    expect(win.bottoms[3]).toBeLessThanOrEqual(win.height + 0.01);
    expect(win.bottoms[4]).toBeGreaterThan(win.height);
    const all = flattenDrawables(l.drawables);
    const line5 = all.find((d) => d.id === "c1_line_5")!;
    const line1 = all.find((d) => d.id === "c1_line_1")!;
    expect(line5.clip).toBeDefined();
    expect(line1.clip).toEqual(line5.clip);
    expect(layoutSpec(spec({ show: "left", code: eight, code_result: OK }), heuristicMeasure).windows).toEqual({});
  });
  test("with a window the panel is the window's height, not the script's", () => {
    const frameH = (s: Spec) => (leaf(s, "c1__frame") as { shapeHint?: { h: number } }).shapeHint!.h;
    expect(frameH(spec({ show: "above", code: eight, lines: 3, code_result: OK }))).toBeLessThan(frameH(spec({ show: "above", code: eight, code_result: OK })));
  });
  test("with a window the output keeps its LAST rows behind a leading ellipsis", () => {
    const l = layoutSpec(spec({ show: "below", code: eight, lines: 3, font_size: 40, code_result: OK }), heuristicMeasure);
    const outs = flattenDrawables(l.drawables).filter((d) => d.id.startsWith("c1__out")) as TextDrawable[];
    expect(outs[0].text).toBe("…");
    expect(outs[outs.length - 1].text).toBe("row 11");
  });
});

describe("plan — the window scrolls as lines are drawn, and back on erase", () => {
  const win = { c1: { ids: ["c1_line_1", "c1_line_2", "c1_line_3", "c1_line_4", "c1_line_5"], bottoms: [20, 40, 60, 80, 100], height: 60 } };
  const ids = ["c1", ...win.c1.ids, "c1_out"];
  test("offsets follow the highest visible line", () => {
    const plan = planCommands(
      [{ draw: ["c1", "c1_line_1", "c1_line_2", "c1_line_3"] }, { draw: ["c1_line_4"] }, { draw: ["c1_line_5"] }, { erase: ["c1_line_5"] }] as never,
      ids,
      { windows: win },
    );
    const dy = (s: number, id: string) => plan.states[s].offsets[id]?.[1] ?? 0;
    expect(dy(0, "c1_line_1")).toBe(0);
    expect(dy(1, "c1_line_1")).toBe(20);
    expect(dy(1, "c1_line_5")).toBe(20);
    expect(dy(2, "c1_line_1")).toBe(40);
    expect(dy(3, "c1_line_1")).toBe(20);
    expect(plan.states[2].offsets["c1_out"]).toBeUndefined();
  });
  test("a real layout's window plans a scroll only past the window", () => {
    const l = layoutSpec(spec({ show: "left", code: eight, lines: 4, code_result: OK }), heuristicMeasure);
    const cmds = Array.from({ length: 8 }, (_, i) => ({ draw: [`c1_line_${i + 1}`] }));
    const plan = planCommands(cmds as never, l.order, { windows: l.windows });
    expect(plan.states[3].offsets["c1_line_1"]).toBeUndefined();
    expect(plan.states[4].offsets["c1_line_1"]![1]).toBeGreaterThan(0);
    expect(plan.states[7].offsets["c1_line_8"]![1]).toBeGreaterThan(plan.states[4].offsets["c1_line_1"]![1]);
  });
});

describe("code panel vocabulary", () => {
  test("show names where the code sits; split is gone", () => {
    for (const s of ["output", "left", "right", "above", "below", "code", "none"]) expect(validateSpec(spec({ show: s })).ok).toBe(true);
    expect(validateSpec(spec({ show: "split" })).ok).toBe(false);
  });
  test("lines is an integer of at least 3", () => {
    expect(validateSpec(spec({ lines: 6 })).ok).toBe(true);
    expect(validateSpec(spec({ lines: 2 })).ok).toBe(false);
    expect(validateSpec(spec({ lines: 4.5 })).ok).toBe(false);
  });
  test("lint: a stacked layout with a long script and no window is called out; a narrow side-by-side too", () => {
    const long = Array.from({ length: 14 }, (_, i) => `x${i} = ${i}`).join("\n");
    expect(lintCommands(spec({ show: "above", code: long })).some((i) => i.rule === "code-use" && /set lines/.test(i.message))).toBe(true);
    expect(lintCommands(spec({ show: "above", code: long, lines: 6 })).some((i) => /set lines/.test(i.message))).toBe(false);
    expect(lintCommands(spec({ show: "right", width: 400 })).some((i) => i.rule === "code-use")).toBe(true);
  });
});
