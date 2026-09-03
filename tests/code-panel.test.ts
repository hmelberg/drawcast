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
import { resolveDrawOpts } from "../src/layout/resolve";
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
  test("lines beyond the window are clipped away, so the lint does not see them on the frame or off the canvas", () => {
    for (const show of ["left", "above", "below"]) {
      const l = layoutSpec(spec({ show, code: eight, lines: 4, code_result: OK }), heuristicMeasure);
      expect(l.issues.map((i) => i.message), show).toEqual([]);
    }
    const thirty = Array.from({ length: 30 }, (_, i) => `y${i} = ${i}`).join("\n");
    const l = layoutSpec(spec({ show: "left", code: thirty, lines: 5, code_result: OK }), heuristicMeasure);
    expect(l.issues.filter((i) => i.rule === "out-of-canvas")).toEqual([]);
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

describe("screen vocabulary", () => {
  test("frame values validate; junk does not", () => {
    for (const f of ["panel", "window", "screen", "laptop", "none"]) expect(validateSpec(spec({ frame: f })).ok).toBe(true);
    expect(validateSpec(spec({ frame: "tv" })).ok).toBe(false);
  });
  test("draw.mode type validates on any element but is only honoured on code lines", () => {
    expect(validateSpec(spec({ draw: { mode: "type" } })).ok).toBe(true);
    const s = { elements: [{ id: "t", type: "text", text: "hi", x: 100, y: 100, draw: { mode: "type" } }], commands: [] } as unknown as Spec;
    expect(validateSpec(s).ok).toBe(true);
    expect(lintCommands(s).some((i) => /type/.test(i.message))).toBe(true);
    expect(resolveDrawOpts({ mode: "type" }).mode).toBe("sketch");
    expect(resolveDrawOpts({ mode: "type" }, { mode: "type", duration: 500 }).mode).toBe("type");
  });
});

describe("the screen", () => {
  const ids = (s: Spec) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).map((d) => d.id);
  test("each frame value draws its own chrome ids, and none draws no frame", () => {
    expect(ids(spec({ frame: "window", code_result: OK }))).toContain("c1__bar");
    expect(ids(spec({ frame: "screen", code_result: OK }))).toEqual(expect.arrayContaining(["c1__bezel", "c1__stand"]));
    expect(ids(spec({ frame: "laptop", code_result: OK }))).toEqual(expect.arrayContaining(["c1__bezel", "c1__keys", "c1__key_space"]));
    expect(ids(spec({ frame: "none", code_result: OK }))).not.toContain("c1__frame");
    expect(ids(spec({ code_result: OK }))).toContain("c1__frame");
  });
  test("chrome reserves its space: the assembly stays centred on y and the content moves inside it", () => {
    const plain = textOf(spec({ show: "left", code: eight, code_result: OK }), "c1_line_1");
    const laptop = textOf(spec({ show: "left", code: eight, code_result: OK, frame: "laptop" }), "c1_line_1");
    expect(laptop.pos[1]).toBeGreaterThan(plain.pos[1]);
    const bezel = leaf(spec({ show: "left", code: eight, code_result: OK, frame: "screen" }), "c1__bezel") as { shapeHint?: { h: number } };
    const frame = leaf(spec({ show: "left", code: eight, code_result: OK, frame: "screen" }), "c1__frame") as { shapeHint?: { h: number } };
    expect(bezel.shapeHint!.h).toBeGreaterThan(frame.shapeHint!.h);
    for (const f of ["window", "screen", "laptop"]) {
      expect(layoutSpec(spec({ show: "left", code: eight, code_result: OK, frame: f }), heuristicMeasure).issues.filter((i) => i.severity === "error"), f).toEqual([]);
    }
  });
  test("draw.mode type gives each code line a typing duration and leaves the frame sketched", () => {
    const l = flattenDrawables(layoutSpec(spec({ show: "left", code: "x = 1\nlonger_line = 12345678", draw: { mode: "type" }, code_result: OK }), heuristicMeasure).drawables);
    const l1 = l.find((d) => d.id === "c1_line_1")!;
    const l2 = l.find((d) => d.id === "c1_line_2")!;
    expect(l1.drawOpts.mode).toBe("type");
    expect(l2.drawOpts.duration).toBeGreaterThan(l1.drawOpts.duration);
    expect(l.find((d) => d.id === "c1__frame")!.drawOpts.mode).toBe("sketch");
  });
});

describe("explore: { code } — the editor verb", () => {
  test("validates and reaches the plan step with the element id", () => {
    const s = spec({ show: "left", code: "x = 1" }, [{ draw: ["c1"] }, { explore: { code: "c1" } }]);
    expect(validateSpec(s).ok).toBe(true);
    const plan = planCommands(s.commands, ["c1", "c1_line_1", "c1_out"]);
    const step = plan.steps.find((st) => st.kind === "explore") as { kind: "explore"; code?: string } | undefined;
    expect(step?.code).toBe("c1");
    expect(validateSpec(spec({}, [{ explore: { code: 7 } }])).ok).toBe(false);
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
