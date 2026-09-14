import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { controlsPane, CTL_ROW_H } from "../src/layout/code-controls-pane";
import type { Spec } from "../src/spec/types";

const OK = JSON.stringify({ ok: true, stdout: "42", stderr: "", figures: [] });
const spec = (el: object): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", show: "left", width: 900, pane: "controls", code_result: OK, ...el }], commands: [{ draw: ["sim"] }] }) as unknown as Spec;
const ids = (s: Spec) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).map((d) => d.id);

describe("controlsPane (pure)", () => {
  const code = "n = (1, 50)\nmodel = [\"SIR\", \"SEIR\"]\nlog = False\nname = \"x\"\nroll = Button(\"Roll\")";
  const names = ["n", "model", "log", "name", "roll"];
  test("one row per control, in order, with the panel id and per-control groups", () => {
    const p = controlsPane("sim", "python", code, names, { x: 100, top: 600, w: 400 }, 17, undefined, undefined);
    expect(p.order).toEqual(["sim_ctls", "sim_ctl_n", "sim_ctl_model", "sim_ctl_log", "sim_ctl_name", "sim_ctl_roll"]);
    expect(p.height).toBeCloseTo(5 * 17 * CTL_ROW_H, 5);
  });
  test("a slider's knob sits at the default's fraction of the track", () => {
    const p = controlsPane("sim", "python", "n = (0, 100)", ["n"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined);
    const knob = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__knob") as StrokeDrawable;
    const track = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__track") as StrokeDrawable;
    const tx0 = Math.min(...track.pts.map((q) => q[0]));
    const tx1 = Math.max(...track.pts.map((q) => q[0]));
    const kx = knob.pts.reduce((a, q) => a + q[0], 0) / knob.pts.length;
    expect((kx - tx0) / (tx1 - tx0)).toBeCloseTo(0.5, 1); // default 50 of 0..100
    const val = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__value") as TextDrawable;
    expect(val.text).toBe("50");
  });
  test("a rewritten value moves the knob", () => {
    const p = controlsPane("sim", "python", "n = 90", ["n"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined);
    // a bare number is a number field — drawn as a boxed value, no track
    expect(flattenDrawables(p.drawables).some((d) => d.id === "sim_ctl_n__track")).toBe(false);
    expect((flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__value") as TextDrawable).text).toBe("90");
  });
  test("choice chips: the default is filled", () => {
    const p = controlsPane("sim", "python", "m = [\"a\", \"b\"]", ["m"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined);
    const chips = flattenDrawables(p.drawables).filter((d) => d.id.startsWith("sim_ctl_m__chip_"));
    expect(chips.map((d) => d.id)).toEqual(["sim_ctl_m__chip_0", "sim_ctl_m__chip_1"]);
    expect(chips[0].kind).toBe("area"); // filled = chosen
    expect(chips[1].kind).toBe("stroke");
  });
});

describe("pane: controls in the panel layout", () => {
  test("mints _ctls and _ctl_<name>, no _line_N, and registers the pane box", () => {
    const s = spec({ controls: ["n", "log"], code: "n = (1, 50)\nlog = False\nprint(n)" });
    const all = ids(s);
    expect(all).toContain("sim_ctls");
    expect(all).toContain("sim_ctl_n");
    expect(all).toContain("sim_ctl_log");
    expect(all.some((i) => /^sim_line_\d+$/.test(i))).toBe(false);
    expect(all).toContain("sim_out");
    expect(layoutSpec(s, heuristicMeasure).panes?.sim).toBeDefined();
  });
  test("pane: code (or absent) still draws lines", () => {
    expect(ids(spec({ pane: "code", controls: ["n"], code: "n = (1, 50)\nprint(n)" }))).toContain("sim_line_1");
  });
});
