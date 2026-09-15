// The controls host's DOM-free core: a logical point on the drawn panel
// becomes a commit through the tray's own closures. Geometry comes from a
// real layout (layoutSpec + heuristicMeasure), never from numbers typed here.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type StrokeDrawable, type AreaDrawable } from "../src/layout/model";
import { bboxOfPts } from "../src/layout/geometry";
import { parseControls, type ControlSpec } from "../src/code/controls";
import { RUN_ROW_ID } from "../src/layout/code-controls-pane";
import { controlsHostFor, sliderValueAt, type ControlsHostDeps } from "../src/ui/controls-host";
import type { Spec, SpecElement } from "../src/spec/types";

const OK = JSON.stringify({ ok: true, stdout: "42", stderr: "", figures: [] });
const CODE = 'n = (0, 100)\nmodel = ["SIR", "SEIR"]\nlog = False\nname = "x"\ngo = Button("Go")';
const NAMES = ["n", "model", "log", "name", "go"];

function setup(extra: object = {}) {
  const el = { id: "sim", type: "code", language: "python", show: "left", width: 900, pane: "controls", controls: NAMES, code: CODE, code_src: CODE, code_result: OK, ...extra } as unknown as SpecElement;
  const spec = { elements: [el], commands: [{ draw: ["sim"] }] } as unknown as Spec;
  const layout = layoutSpec(spec, heuristicMeasure);
  const controls = parseControls("python", CODE, NAMES).controls;
  const commits: { name: string; raw: string | boolean; immediate: boolean }[] = [];
  const runs: string[] = [];
  const edits: { name: string }[] = [];
  const deps: ControlsHostDeps = {
    panels: () => [{ el, controls }],
    layout: () => layout,
    visible: () => true,
    enabled: () => true,
    commit: (_el, c, raw, immediate) => commits.push({ name: c.name, raw, immediate }),
    run: (e) => runs.push(e.id),
    editText: (_el, c) => edits.push({ name: c.name }),
  };
  const leaves = flattenDrawables(layout.drawables);
  const leaf = (id: string) => leaves.find((d) => d.id === id) as StrokeDrawable | AreaDrawable;
  const centre = (id: string): [number, number] => {
    const b = bboxOfPts(leaf(id).pts);
    return [b.x + b.w / 2, b.y + b.h / 2];
  };
  return { el, layout, controls, deps, commits, runs, edits, leaf, centre };
}

describe("sliderValueAt", () => {
  const c = (o: Partial<ControlSpec>): ControlSpec => ({ name: "n", kind: "slider", label: "n", default: 0, line: 0, start: 0, end: 0, birthplace: "assign", min: 0, max: 100, ...o });
  test("a fraction maps linearly and clamps", () => {
    expect(sliderValueAt(c({}), 0.3)).toBeCloseTo(30, 6);
    expect(sliderValueAt(c({}), -0.2)).toBe(0);
    expect(sliderValueAt(c({}), 1.7)).toBe(100);
  });
  test("snaps to the step and to integers", () => {
    expect(sliderValueAt(c({ step: 5 }), 0.33)).toBe(35);
    expect(sliderValueAt(c({ integer: true }), 0.337)).toBe(34);
    expect(sliderValueAt(c({ min: 0.1, max: 1.0, step: 0.05, decimals: 2 }), 0.5)).toBeCloseTo(0.55, 6);
  });
});

describe("controls host core", () => {
  test("panelAt: inside the pane rectangle, and nowhere else", () => {
    const { layout, deps, centre } = setup();
    const host = controlsHostFor(deps);
    const pane = layout.panes!.sim;
    expect(host.panelAt([pane.x + pane.w / 2, pane.y + pane.h / 2])).toBe("sim");
    expect(host.panelAt([pane.x + pane.w + 50, pane.y + pane.h / 2])).toBeNull();
    // Geometry note: the pane rectangle's raw center is not guaranteed to
    // fall on a row's actual ink — with this fixture's 5 controls it lands
    // vertically on the middle row (the "log" toggle), whose pill is a
    // fixed, narrow width, and horizontally on the pane's overall midpoint,
    // which sits well past that pill's right edge. So `over` is checked at
    // a point known (from the real layout) to sit on drawn control ink.
    expect(host.over(centre("sim_ctl_n__track"))).toBe(true);
  });
  test("a slider press at 30 % of the track commits 30, not immediately, and returns a drag gesture", () => {
    const { deps, commits, leaf } = setup();
    const host = controlsHostFor(deps);
    const track = leaf("sim_ctl_n__track");
    const xs = track.pts.map((q) => q[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y = track.pts[0][1];
    const g = host.press([x0 + 0.3 * (x1 - x0), y]);
    expect(g?.control.name).toBe("n");
    expect(commits).toEqual([{ name: "n", raw: "30", immediate: false }]);
    host.drag(g!, [x0 + 0.5 * (x1 - x0), y]);
    expect(commits.at(-1)).toEqual({ name: "n", raw: "50", immediate: false });
    host.release(g!, [x1 + 999, y]); // past the end: clamps, and the release is immediate
    expect(commits.at(-1)).toEqual({ name: "n", raw: "100", immediate: true });
  });
  test("a press on the row band above the track line still counts as the slider", () => {
    const { deps, commits, leaf } = setup();
    const host = controlsHostFor(deps);
    const track = leaf("sim_ctl_n__track");
    const y = track.pts[0][1];
    const x0 = Math.min(...track.pts.map((q) => q[0]));
    host.press([x0, y + 6]);
    expect(commits.length).toBe(1);
    expect(commits[0].raw).toBe("0");
  });
  test("a choice click on the second chip commits that option, immediately, with no gesture", () => {
    const { deps, commits, centre } = setup();
    const host = controlsHostFor(deps);
    expect(host.press(centre("sim_ctl_model__chip_1"))).toBeNull();
    expect(commits).toEqual([{ name: "model", raw: "SEIR", immediate: true }]);
  });
  test("a toggle click flips from its current value", () => {
    const { deps, commits, centre } = setup();
    const host = controlsHostFor(deps);
    host.press(centre("sim_ctl_log__pill"));
    expect(commits).toEqual([{ name: "log", raw: true, immediate: true }]);
  });
  test("a text box click asks the caller for the transient input, with the box", () => {
    const { deps, commits, edits, centre } = setup();
    const host = controlsHostFor(deps);
    host.press(centre("sim_ctl_name__box"));
    expect(edits).toEqual([{ name: "name" }]);
    expect(commits).toEqual([]);
  });
  test("a button press commits once, immediately", () => {
    const { deps, commits, centre } = setup();
    const host = controlsHostFor(deps);
    host.press(centre("sim_ctl_go__pill"));
    expect(commits).toEqual([{ name: "go", raw: true, immediate: true }]);
  });
  test("the drawn Run ▶ row forces a run", () => {
    const { deps, runs, centre } = setup({ autorun: false });
    const host = controlsHostFor(deps);
    host.press(centre(`sim_ctl_${RUN_ROW_ID}__pill`));
    expect(runs).toEqual(["sim"]);
  });
  test("nothing happens on a hidden panel, or while disabled", () => {
    const a = setup();
    a.deps.visible = () => false;
    expect(controlsHostFor(a.deps).press(a.centre("sim_ctl_model__chip_1"))).toBeNull();
    expect(a.commits).toEqual([]);
    const b = setup();
    b.deps.enabled = () => false;
    controlsHostFor(b.deps).press(b.centre("sim_ctl_model__chip_1"));
    expect(b.commits).toEqual([]);
    expect(controlsHostFor(b.deps).over(b.centre("sim_ctl_model__chip_1"))).toBe(false);
  });
  // Controller ruling (2026-09-15): the brief's original test pressed the
  // pane's bottom-right corner, which the last row's full-width button pill
  // plus the BAND_PAD band would cover — it would fail for the wrong reason.
  // The label column is a cleaner "not a control" probe: it is text with no
  // `pts`, so no row band extends over it.
  test("the label column is not a control", () => {
    const { deps, commits, layout, leaf } = setup();
    const host = controlsHostFor(deps);
    const pane = layout.panes!.sim;
    const track = leaf("sim_ctl_n__track");
    const y = track.pts[0][1];
    expect(host.press([pane.x + 1, y])).toBeNull();
    expect(commits).toEqual([]);
    expect(host.over([pane.x + 1, y])).toBe(false);
  });
});
