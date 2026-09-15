import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { controlsPane, controlsPaneHeight, CTL_ROW_H, RUN_ROW_ID } from "../src/layout/code-controls-pane";
import { withControlDefaults } from "../src/code/controls";
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
    // `sim_ctls` is a GROUP id (p.groups), not itself a row in `order` — a
    // group is never command-addressable as a drawable of its own (the same
    // rule a spec `type: "group"` element follows).
    expect(p.order).toEqual(["sim_ctl_n", "sim_ctl_model", "sim_ctl_log", "sim_ctl_name", "sim_ctl_roll"]);
    expect(p.groups).toEqual({ sim_ctls: p.order });
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
  test("the panel's text is set in the figure's own face, not the code font (spec 2026-09-15 §3.5)", () => {
    const p = controlsPane("sim", "python", code, names, { x: 100, top: 600, w: 400 }, 17, undefined, undefined);
    const texts = flattenDrawables(p.drawables).filter((d) => d.kind === "text") as TextDrawable[];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.font).toBeUndefined();
  });
  test("autorun: false draws a Run ▶ row last, and the height counts it", () => {
    const p = controlsPane("sim", "python", "n = (0, 100)", ["n"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined, undefined, { runRow: true });
    expect(p.order).toEqual(["sim_ctl_n", `sim_ctl_${RUN_ROW_ID}`]);
    expect(p.groups).toEqual({ sim_ctls: p.order });
    const pill = flattenDrawables(p.drawables).find((d) => d.id === `sim_ctl_${RUN_ROW_ID}__pill`);
    const cap = flattenDrawables(p.drawables).find((d) => d.id === `sim_ctl_${RUN_ROW_ID}__value`) as TextDrawable;
    expect(pill).toBeDefined();
    expect(cap.text).toBe("Run ▶");
    expect(p.height).toBeCloseTo(controlsPaneHeight(["n"], 20, 500, 1), 5);
    expect(p.height).toBeCloseTo(2 * 20 * CTL_ROW_H, 5);
  });
  test("a layout with autorun: false reserves the Run row in the pane", () => {
    const s = spec({ code: "n = (0, 100)", controls: ["n"], autorun: false });
    expect(ids(s)).toContain(`sim_ctl_${RUN_ROW_ID}__pill`);
  });
  test("controlsPaneHeight counts the Run row even with zero labels — the two must never disagree", () => {
    expect(controlsPaneHeight([], 20, 500, 1)).toBeCloseTo(20 * CTL_ROW_H, 5);
    const p = controlsPane("sim", "python", "", [], { x: 0, top: 0, w: 500 }, 20, undefined, undefined, undefined, { runRow: true });
    expect(p.height).toBeCloseTo(controlsPaneHeight([], 20, 500, 1), 5);
  });
});

describe("the label column sizes to the longest label, and a label past the cap wraps", () => {
  const LONG_LABEL = "12345678901234567890"; // 20 characters
  const longCode = `x = Slider(1, 100, default=10, label="${LONG_LABEL}")`;

  test("controlsPaneHeight: short labels keep the un-wrapped total (the previous height)", () => {
    expect(controlsPaneHeight(["n", "model", "log", "name", "roll"], 17, 400)).toBeCloseTo(5 * 17 * CTL_ROW_H, 5);
  });

  test("controlsPaneHeight: a label past 0.45*w wraps, adding 0.75 of a row", () => {
    const rowH = 17 * CTL_ROW_H;
    expect(controlsPaneHeight([LONG_LABEL], 17, 400)).toBeCloseTo(1.75 * rowH, 5);
  });

  test("controlsPaneHeight: the panel height equals the sum of row heights (short one-line, long wrapped)", () => {
    const rowH = 17 * CTL_ROW_H;
    expect(controlsPaneHeight(["n", LONG_LABEL], 17, 400)).toBeCloseTo(rowH + 1.75 * rowH, 5);
  });

  test("controlsPane: a 20-character label at w=400/fontSize=17 gets its own line, and the row is taller", () => {
    const p = controlsPane("sim", "python", longCode, ["x"], { x: 0, top: 0, w: 400 }, 17, undefined, undefined);
    const rowH = 17 * CTL_ROW_H;
    expect(p.height).toBeCloseTo(1.75 * rowH, 5);
    const label = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_x__label") as TextDrawable;
    const track = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_x__track") as StrokeDrawable;
    expect(label.text).toBe(LONG_LABEL);
    // The label's own line sits ABOVE the control's line (y-up: a bigger y).
    expect(label.pos[1]).toBeGreaterThan(track.pts[0][1]);
    // The track starts at the row's own left edge (box.x), full width — not
    // indented by a label column, since nothing shares this row with it.
    expect(Math.min(...track.pts.map((q) => q[0]))).toBeCloseTo(0, 5);
  });

  test("controlsPane: mixing a short label and a wrapped one — total height is their sum, short label keeps its column", () => {
    const code = `n = (1, 50)\n${longCode}`;
    const p = controlsPane("sim", "python", code, ["n", "x"], { x: 0, top: 0, w: 400 }, 17, undefined, undefined);
    const rowH = 17 * CTL_ROW_H;
    expect(p.height).toBeCloseTo(rowH + 1.75 * rowH, 5);
    // "n"'s row is unwrapped: its track does not start at the row's bare left
    // edge — it is indented by the (shared) label column, sized to "x"'s
    // longer label even though "n" is short.
    const nTrack = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__track") as StrokeDrawable;
    expect(Math.min(...nTrack.pts.map((q) => q[0]))).toBeGreaterThan(0);
  });
});

describe("pane: controls in the panel layout", () => {
  test("mints _ctl_<name> rows, no _line_N, registers the pane box, and sim_ctls as a group", () => {
    const s = spec({ controls: ["n", "log"], code: "n = (1, 50)\nlog = False\nprint(n)" });
    const all = ids(s);
    expect(all).toContain("sim_ctl_n");
    expect(all).toContain("sim_ctl_log");
    expect(all.some((i) => /^sim_line_\d+$/.test(i))).toBe(false);
    expect(all).toContain("sim_out");
    const layout = layoutSpec(s, heuristicMeasure);
    expect(layout.panes?.sim).toBeDefined();
    // sim_ctls is a GROUP id (expandGroup, render/plan.ts), not a drawable of
    // its own — it must not show up in the drawables tree at all.
    expect(all).not.toContain("sim_ctls");
    expect(layout.groups?.sim_ctls).toEqual(["sim_ctl_n", "sim_ctl_log"]);
  });
  test("pane: code (or absent) still draws lines", () => {
    expect(ids(spec({ pane: "code", controls: ["n"], code: "n = (1, 50)\nprint(n)" }))).toContain("sim_line_1");
  });
  test("commands: [] draws each row's ink exactly once (no double-ink from the implicit final draw)", () => {
    const s: Spec = {
      elements: [{ id: "sim", type: "code", language: "python", show: "left", width: 900, pane: "controls", code_result: OK, controls: ["n"], code: "n = (1, 50)\nprint(n)" }],
      commands: [],
    } as unknown as Spec;
    const rowDrawables = flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).filter((d) => d.id.startsWith("sim_ctl_n__"));
    const counts = new Map<string, number>();
    for (const d of rowDrawables) counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    expect(counts.size).toBeGreaterThan(0);
    for (const [id, n] of counts) expect(n, `${id} drawn ${n} times`).toBe(1);
  });
});

describe("code_src is the panel's shape source, independent of the rewritten el.code (final wave item 1)", () => {
  const authored = 'beta = Slider(0.1, 1.0, step=0.05, label="Willingness to pay")';
  // What render/code.ts's resolveCode leaves in el.code AFTER the rewrite —
  // a bare default value, every tuple/label already gone.
  const rewritten = withControlDefaults("python", authored, ["beta"]);

  test("with code_src holding the authored script, the panel draws a real slider with its authored label", () => {
    const s = spec({ controls: ["beta"], code: rewritten, code_src: authored });
    const all = ids(s);
    expect(all).toContain("sim_ctl_beta__track");
    const label = flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).find((d) => d.id === "sim_ctl_beta__label") as TextDrawable;
    expect(label.text).toBe("Willingness to pay");
  });

  test("without code_src, the same rewritten text alone is just a bare number — a number box, not a slider (documents the dependency)", () => {
    const s = spec({ controls: ["beta"], code: rewritten });
    const all = ids(s);
    expect(all).not.toContain("sim_ctl_beta__track");
    expect(all).toContain("sim_ctl_beta__box");
  });
});
