// equation_plot (2026-09-27): a general equation, drawn with its parameters'
// values written in, and changed by the paused viewer — scrubbing or typing
// the equation's numbers, a drawn panel of sliders and boxes, or dragging
// the curve itself.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { scenes } from "../src/scenes/registry";
import { autoYRange, dragParam, extremaOf, readModel, rootsOf, solveParam, type EquationPlotParams } from "../src/scenes/equation_plot/model";
import { layoutEquationPlot, clipCurve } from "../src/scenes/equation_plot/layout";
import { lintEquationPlot } from "../src/scenes/equation_plot/lint";
import { eqParts, eqPatch, eqTarget, panPatch, shownRanges, zoomPatch } from "../src/scenes/equation_plot/widget";
import { scrubValue, sliderPointerValue } from "../src/scenes/params-ui/controls";
import { SURFACE_PART } from "../src/scenes/widget-types";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, runWidget, partAt } from "../src/scenes/widget-run";
import { layoutSpec } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { widgetHostFor } from "../src/ui/widget-host";
import { readParam, withOverrides } from "../src/render/params";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";
import type { RenderHandle } from "../src/render";

const module = scenes["equation_plot"];
const PARABOLA: EquationPlotParams = {
  equation: "y = a*x^2 + b*x + c",
  params: { a: { value: 1, min: -3, max: 3 }, b: { value: 0, min: -5, max: 5 }, c: { value: -2, min: -5, max: 5 } },
  marks: ["roots", "extrema", "y_intercept"],
};
const SINE: EquationPlotParams = {
  equation: "y = A*sin(k*x + phi)",
  params: { A: { value: 2, min: 0, max: 4, label: "amplitude A" }, k: { value: 1, min: 0.2, max: 3 }, phi: { value: 0, min: -3.14, max: 3.14, step: 0.05 } },
  controls: "panel",
  x_range: [-6.28, 6.28],
  y_range: [-5, 5],
};

const asRec = (p: EquationPlotParams) => p as unknown as Record<string, unknown>;
const pageOf = (p: EquationPlotParams) => layoutSpec({ template: "equation_plot", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: EquationPlotParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageOf(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const valueOf = (params: unknown, name: string): number => {
  const v = (params as { params: Record<string, unknown> }).params[name];
  return typeof v === "number" ? v : (v as { value: number }).value;
};

beforeAll(async () => {
  await ensureEngines(["mathjax"]);
});

describe("reading the params", () => {
  test("every free name but the variable is a parameter; an undeclared one is 1 and editable", () => {
    const m = readModel({ equation: "y = a*x + b", params: { a: 2 } });
    expect(m.params.map((p) => [p.name, p.value, p.editable, p.declared])).toEqual([
      ["a", 2, true, true],
      ["b", 1, true, false],
    ]);
  });
  test("f(t) makes t the variable", () => {
    const m = readModel({ equation: "N(t) = N0*exp(r*t)" });
    expect(m.variable).toBe("t");
    expect(m.params.map((p) => p.name)).toEqual(["N0", "r"]);
  });
  test("restriction: editable lists, fixed, and a step from the range", () => {
    const m = readModel({ equation: "y = a*x^2 + b*x + c", params: { a: { value: 1, min: -3, max: 3 }, c: { value: 0, fixed: true } }, editable: ["a", "c"] });
    expect(m.params.map((p) => p.editable)).toEqual([true, false, false]);
    expect(m.byName.get("a")!.step).toBe(0.2);
    expect(m.byName.get("a")!.control).toBe("slider");
    expect(m.byName.get("b")!.control).toBe("box");
  });
});

describe("marks", () => {
  test("roots, a touching root, turning points", () => {
    expect(rootsOf((x) => x * x - 2, [-5, 5]).map((r) => r.toFixed(6))).toEqual(["-1.414214", "1.414214"]);
    expect(rootsOf((x) => (x - 1) ** 2, [-5, 5]).map((r) => r.toFixed(4))).toEqual(["1.0000"]);
    expect(rootsOf((x) => 1 / x, [-5, 5])).toEqual([]);
    const e = extremaOf((x) => Math.sin(x), [-6.28, 6.28]);
    expect(e.map((p) => p.kind)).toEqual(["max", "min", "max", "min"]);
    expect(e[1].x).toBeCloseTo(-Math.PI / 2, 5);
    expect(extremaOf((x) => x * x, [-5, 5]).map((p) => [p.kind, Math.abs(p.x) < 1e-6])).toEqual([["min", true]]);
  });
  test("a pole cuts the curve into pieces", () => {
    const xs = [-2, -1, -0.5, 0.5, 1, 2];
    expect(clipCurve(xs, xs.map((x) => 1 / x), -1.5, 1.5)).toHaveLength(2);
  });
});

describe("the layout", () => {
  test("ids, marks and values", () => {
    const l = layoutEquationPlot(PARABOLA);
    for (const id of ["axes", "x_label", "y_label", "x_ticks", "y_ticks", "curve_0", "eq", "eq_param_a", "eq_param_b", "eq_param_c", "root_1", "root_2", "min_1", "y_intercept"]) expect(l.order).toContain(id);
    expect(l.values).toMatchObject({ a: 1, b: 0, c: -2, root_1: -1.414214, root_2: 1.414214, min_1_x: 0, min_1_y: -2, y_intercept: -2 });
    expect(l.drawnWith?.eq).toEqual(["eq_param_a", "eq_param_b", "eq_param_c"]);
    expect(l.groups?.equations).toEqual(["eq", "eq_param_a", "eq_param_b", "eq_param_c"]);
  });
  test("a parameter written twice has two parts; a second curve its own line", () => {
    const l = layoutEquationPlot({ equation: ["y = a*x + a", "y = a - x"], params: { a: 2 } });
    for (const id of ["eq", "eq_1", "eq_param_a", "eq_param_a_2", "eq_param_a_3", "curve_0", "curve_1"]) expect(l.order).toContain(id);
    expect(l.groups?.curves).toEqual(["curve_0", "curve_1"]);
  });
  test("the panel: a slider per bounded param, a box when asked", () => {
    const l = layoutEquationPlot({ ...SINE, params: { ...SINE.params, k: { value: 1, control: "box" } } });
    for (const id of ["slider_A", "knob_A", "name_A", "value_A", "box_k", "value_k", "slider_phi"]) expect(l.order).toContain(id);
    expect(l.groups?.panel).toContain("knob_phi");
  });
  test("the y range is calm: round, and still under a small change", () => {
    const r1 = layoutEquationPlot({ equation: "y = a*sin(x)", params: { a: 2 } }).frame!.y;
    const r2 = layoutEquationPlot({ equation: "y = a*sin(x)", params: { a: 2.1 } }).frame!.y;
    expect(r1).toEqual([-3, 3]);
    expect(r2).toEqual(r1);
    expect(autoYRange([[0, 100]])).toEqual([0, 120]);
  });
  test("a tick number a curve runs through, or an axis caption covers, stands aside", () => {
    const texts = (p: EquationPlotParams, id: string) => {
      const g = layoutEquationPlot(p).drawables.find((d) => d.id === id) as { children: { kind: string; text?: string }[] };
      return g.children.filter((c) => c.kind === "text").map((c) => c.text);
    };
    // y = x keeps clear of the numbers under the x axis; a steep line through x = -4 runs over "-4".
    expect(texts({ equation: "y = x", x_range: [-5, 5], y_range: [-5, 5] }, "x_ticks")).toContain("-4");
    expect(texts({ equation: "y = 10*(x + 4)", x_range: [-5, 5], y_range: [-5, 5] }, "x_ticks")).not.toContain("-4");
    // A long caption under the axis end takes the last number's place.
    expect(texts({ equation: "y = 100*x", x_range: [0, 40], y_range: [0, 5000], x_label: "years" }, "x_ticks")).not.toContain("40");
  });
  test("{eq.<key>} reads the live values in drawn text", () => {
    const spec = { template: "equation_plot", params: PARABOLA, elements: [{ id: "note", type: "text", text: "a = {eq.a}, root {eq.root_2:2}", x: 500, y: 40 }], commands: [] };
    const page = layoutSpec(spec as unknown as RenderHandle["spec"]);
    const note = page.drawables.find((d) => d.id === "note") as { text: string };
    expect(note.text).toBe("a = 1, root 1.41");
  });
});

describe("lint", () => {
  test("clean examples, and the problems it names", () => {
    for (const ex of module.manifest.examples) expect(lintEquationPlot(ex.params as unknown as EquationPlotParams), ex.request).toEqual([]);
    const msgs = (p: EquationPlotParams) => lintEquationPlot(p).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs({ equation: "y = 2*" })[0]).toMatch(/^error: .*unexpected end/);
    expect(msgs({ equation: "y = sinn(x)" })[0]).toMatch(/^error: .*unknown function "sinn"/);
    expect(msgs({ equation: "y = a*x", params: { a: { value: 9, min: 0, max: 5 } } })[0]).toMatch(/^error: param "a": value 9 is outside/);
    expect(msgs({ equation: "y = sqrt(x - 100)" })[0]).toMatch(/^error: the equation is undefined over the whole x range/);
    expect(msgs({ equation: "y = ax + b" })[0]).toMatch(/^warn: "ax" is read as one parameter — for a product write a\*x/);
    expect(msgs({ equation: "y = a*x", editable: ["q"] })[0]).toMatch(/^warn: editable: "q" is not a parameter/);
  });
});

describe("the widget", () => {
  test("parts follow the controls and the restriction", () => {
    expect(eqParts(sceneOf(PARABOLA))).toEqual(["eq_param_a", "eq_param_b", "eq_param_c", "curve_0"]);
    expect(eqParts(sceneOf({ ...PARABOLA, editable: ["c"], drag: false }))).toEqual(["eq_param_c"]);
    const panel = eqParts(sceneOf(SINE));
    expect(panel.slice(0, 3)).toEqual(["knob_A", "knob_k", "knob_phi"]);
    expect(panel).not.toContain("eq_param_A");
    expect(panel).toContain("value_A");
  });
  test("scrubbing a number: a step per STEP_UNITS of travel, clamped", () => {
    const m = readModel(PARABOLA);
    const a = m.byName.get("a")!;
    expect(scrubValue(a, STEP_UNITS * 3)).toBe(1.6);
    expect(scrubValue(a, -STEP_UNITS * 100)).toBe(-3);
    const sc = sceneOf(PARABOLA);
    const from = centre(sc, "eq_param_c");
    const run = runWidget(module, asRec(PARABOLA), [dragMoveEvent("eq_param_c", from, [from[0] + STEP_UNITS * 5, from[1]], sc)], { layout: pageOf(PARABOLA) });
    expect(run.errors).toEqual([]);
    expect(valueOf(run.params, "c")).toBe(-1);
    // The author's object form is kept, with the new value in it.
    expect((run.params.params as Record<string, unknown>).c).toEqual({ value: -1, min: -5, max: 5 });
  });
  test("tap to type: a field with the parameter's bounds, and the typed value lands", () => {
    const sc = sceneOf(PARABOLA);
    const body = module.widget!();
    expect(body.editable!("eq_param_a", centre(sc, "eq_param_a"), sc)).toEqual({ value: 1, label: "a", step: 0.2, min: -3, max: 3 });
    expect(body.editable!("curve_0", [0, 0], sc)).toBeNull();
    const run = runWidget(module, asRec(PARABOLA), [inputEvent("eq_param_b", 2.5)], { layout: pageOf(PARABOLA) });
    expect(valueOf(run.params, "b")).toBe(2.5);
  });
  test("a fixed parameter is written but cannot be worked", () => {
    const P = { ...PARABOLA, params: { ...PARABOLA.params, c: { value: -2, fixed: true } } };
    const m = readModel(P);
    expect(eqTarget("eq_param_c", m)).toBeNull();
    const run = runWidget(module, asRec(P), [inputEvent("eq_param_a", 2)], { layout: pageOf(P) });
    expect(valueOf(run.params, "a")).toBe(2);
  });
  test("the panel: a press on a knob takes the slider, and the value follows the pointer along the track", () => {
    const sc = sceneOf(SINE);
    const knob = centre(sc, "knob_A");
    // The track runs through the knob, and a line within reach wins: either
    // way the slider is what the press holds.
    expect(["knob_A", "slider_A"]).toContain(partAt(sc, knob, 18, module.widget!().parts));
    expect(partAt(sc, [knob[0], knob[1] + 9], 18, module.widget!().parts)).toMatch(/^(knob|slider)_A$/);
    const track = sc.lines.get("slider_A")![0];
    const [x0, x1] = [Math.min(...track.map((p) => p[0])), Math.max(...track.map((p) => p[0]))];
    const to: Pt = [x0 + 0.75 * (x1 - x0), knob[1]];
    const run = runWidget(module, asRec(SINE), [dragMoveEvent("knob_A", knob, to, sc)], { layout: pageOf(SINE) });
    expect(valueOf(run.params, "A")).toBe(3);
    const m = readModel(SINE);
    expect(sliderPointerValue(m.byName.get("A")!, x1 + 50, x0, x1)).toBe(4);
    // Controls "panel": the equation's numbers are not a handle.
    expect(eqTarget("eq_param_A", m)).toBeNull();
  });
});

describe("dragging the curve", () => {
  test("the rule: the editable parameter that moves the curve most at the grabbed x", () => {
    const m = readModel(PARABOLA);
    const c = m.curves[0];
    expect(dragParam(m, c, 3)!.name).toBe("a"); // ∂/∂a = 9, ∂/∂b = 3, ∂/∂c = 1
    expect(dragParam(m, c, 0.5)!.name).toBe("c"); // 0.25, 0.5, 1
    expect(dragParam(readModel({ ...PARABOLA, drag: ["b", "c"] }), c, 0)!.name).toBe("c"); // b does not move it at x = 0
    expect(dragParam(readModel({ ...PARABOLA, drag: false }), c, 3)).toBeNull();
  });
  test("the solve puts the curve through the pointer, clamped to the range", () => {
    const m = readModel(PARABOLA);
    const c = m.curves[0];
    const a = m.byName.get("a")!;
    // Through (2, 6): a·4 − 2 = 6 → a = 2.
    expect(solveParam(c, m.env, 2, 6, a)).toBe(2);
    // Out of reach: a·4 − 2 = 30 wants 8, the range stops at 3.
    expect(solveParam(c, m.env, 2, 30, a)).toBe(3);
    // A nonlinear parameter: sin(k·1) = 0.5 near k = 1 → k = π/6 ≈ 0.52 (step 0.1 rounds to 0.5).
    const s = readModel({ equation: "y = sin(k*x)", params: { k: { value: 1, min: 0.2, max: 3 } } });
    expect(solveParam(s.curves[0], s.env, 1, 0.5, s.byName.get("k")!)).toBe(0.5);
  });
  test("a live drag on the curve moves it through the pointer", () => {
    const sc = sceneOf(PARABOLA);
    const from = sc.toLogical([3, 7]); // on the curve: 9 − 2
    const to = sc.toLogical([3, 16]);
    const run = runWidget(module, asRec(PARABOLA), [dragMoveEvent("curve_0", from, to, sc)], { layout: pageOf(PARABOLA) });
    expect(run.errors).toEqual([]);
    expect(valueOf(run.params, "a")).toBe(2); // 9a − 2 = 16
    // 2x² − 2 reaches 48: the range on screen, [−5, 30], widens to round ticks
    // that hold it — and a drag that fits keeps it as it is.
    expect(layoutEquationPlot(PARABOLA).frame!.y).toEqual([-5, 30]);
    expect(run.params.y_range).toEqual([-10, 60]);
    const small = runWidget(module, asRec(PARABOLA), [dragMoveEvent("curve_0", sc.toLogical([0.5, -1.75]), sc.toLogical([0.5, -0.75]), sc)], { layout: pageOf(PARABOLA) });
    expect(valueOf(small.params, "c")).toBe(-1);
    expect(small.params.y_range).toEqual([-5, 30]);
  });
  test("a point riding a parameter drags along the curve", () => {
    const P: EquationPlotParams = { equation: "y = x^2", params: { p: { value: 1, min: -4, max: 4 } }, marks: [{ kind: "point", at: "p" }] };
    const sc = sceneOf(P);
    expect(eqParts(sc)).toContain("point");
    const from = centre(sc, "point");
    const to = sc.toLogical([2, 1]);
    const run = runWidget(module, asRec(P), [dragMoveEvent("curve_0", from, [to[0], from[1]], sc)], { layout: pageOf(P) });
    expect(valueOf(run.params, "p")).toBe(2);
  });
});

describe("the y range while the viewer works", () => {
  test("still while the curve fits, widened to round ticks when it leaves", () => {
    const P: EquationPlotParams = { equation: "y = a*sin(x)", params: { a: { value: 2, min: 0, max: 10 } } };
    expect(eqPatch(P, "a", 2.2, true).y_range).toEqual([-3, 3]);
    expect(eqPatch(P, "a", 6, true).y_range).toEqual([-8, 8]);
    // Shrinking back leaves it where it was.
    expect(eqPatch({ ...P, y_range: [-7, 7] }, "a", 1, true).y_range).toEqual([-7, 7]);
    // An author's range is never touched.
    expect(eqPatch({ ...P, y_range: [-3, 3] }, "a", 6, false).y_range).toBeUndefined();
  });
});

describe("the movie: animate sweeps a parameter", () => {
  test("params.<name>.value animates from the drawn value, and the numbers follow", () => {
    const spec = { template: "equation_plot", params: SINE, commands: [{ animate: { "params.A.value": 3.5 }, duration: 2 }] };
    expect(validateSpec(spec).ok).toBe(true);
    expect(readParam(asRec(SINE), "params.A.value")).toBe(2);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(SINE) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts["params.A.value"]).toBe(2);
    const mid = withOverrides(asRec(SINE), { "params.A.value": 3 }) as unknown as EquationPlotParams;
    const l = layoutEquationPlot(mid);
    expect(l.values!.A).toBe(3);
    const knob = (p: EquationPlotParams) => {
      const k = layoutEquationPlot(p).drawables.find((d) => d.id === "knob_A") as { shapeHint: { c: Pt } };
      return k.shapeHint.c[0];
    };
    expect(knob(mid)).toBeGreaterThan(knob(SINE));
    // A bare-number parameter animates by its own path.
    expect(readParam({ params: { a: 2 } }, "params.a")).toBe(2);
  });
});

describe("the tray", () => {
  test("a slider per editable, bounded, written parameter, at the path animate uses", () => {
    const P: EquationPlotParams = { equation: "y = a*x + b + c + d", params: { a: { value: 1, min: 0, max: 2, label: "slope a" }, b: 3, c: { value: 0, min: -1, max: 1, fixed: true } } };
    expect(module.sliders!(asRec(P))).toEqual([{ path: "params.a.value", label: "slope a", min: 0, max: 2, step: 0.05 }]);
    expect(readParam(asRec(P), "params.a.value")).toBe(1);
  });
});

describe("the domain: zoom and pan the plot's own axes", () => {
  test("zoom about a point, pan by the hand's travel, both axes", () => {
    expect(shownRanges(PARABOLA)).toEqual({ x: [-5, 5], y: [-5, 30] });
    expect(zoomPatch(PARABOLA, [0, 0], 2)).toEqual({ x_range: [-2.5, 2.5], y_range: [-2.5, 15] });
    expect(panPatch(PARABOLA, [1, 5], [2, 5])).toEqual({ x_range: [-6, 4], y_range: [-5, 30] });
  });
  test("the body: blank paper in the plot is its surface; a drag there pans, a zoom event zooms, rest goes back", () => {
    const sc = sceneOf(PARABOLA);
    const body = module.widget!();
    const state = body.init(sc);
    const surf = body.surface!(sc)!;
    const plot = layoutEquationPlot(PARABOLA).frame!.box;
    expect([surf.x, surf.y, surf.x + surf.w, surf.y + surf.h].map(Math.round)).toEqual([plot.x0, plot.y0, plot.x1, plot.y1].map(Math.round));
    const from = sc.toLogical([-3, 20]);
    const to = sc.toLogical([-2, 20]);
    const pan = body.on({ type: "drag_move", id: SURFACE_PART, from, fromDomain: sc.toDomain(from), point: to, domain: sc.toDomain(to) }, state, sc);
    expect((pan.effects as { patch: Record<string, unknown> }[])[0].patch).toEqual({ x_range: [-6, 4], y_range: [-5, 30] });
    const zoom = body.on({ type: "zoom", point: sc.toLogical([0, 0]), domain: [0, 0], factor: 2 }, pan.state, sc);
    const zoomed = { ...PARABOLA, ...(zoom.effects as { patch: Record<string, unknown> }[])[0].patch } as EquationPlotParams;
    expect(zoomed.x_range).toEqual([-2.5, 2.5]);
    // The zoomed curve is re-sampled across the new range, not magnified.
    const curve = layoutEquationPlot(zoomed).curveSamples!.curve_0;
    expect([curve[0][0], curve.at(-1)![0]].map(Math.round)).toEqual([plot.x0, plot.x1].map(Math.round));
    expect(body.rest!(sceneOf(zoomed), zoom.state)).toEqual({ x_range: undefined, y_range: undefined });
    expect(body.rest!(sc, zoom.state)).toBeNull(); // at the authored ranges already
    expect(body.rest!(sceneOf(zoomed), state)).toBeNull(); // nothing moved yet
  });
  test("the host: a press on blank plot paper is the body's drag; ctrl-wheel zooms; the pill's patch resets", () => {
    const spec = { template: "equation_plot", params: PARABOLA, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const previews: Record<string, unknown>[] = [];
    let painted: ReturnType<typeof layoutSpec> | null = null;
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: Record<string, unknown>) => {
        painted = layoutSpec({ ...spec, params: { ...PARABOLA, ...o } } as unknown as RenderHandle["spec"]);
        previews.push(o);
      },
      paintedLayout: () => painted,
      glow: async () => undefined,
      tapAt: async () => undefined,
      caption: () => undefined,
      getParamOverrides: () => ({}),
    };
    const plan = { steps: [], states: [{ ...INITIAL_STATE, visible: layout.order }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
    const hd = { spec, layout, plan, timeline } as unknown as RenderHandle;
    const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined), warn: () => undefined })!;
    const sc = sceneOf(PARABOLA);
    const blank = sc.toLogical([-4, 25]); // far from the curve, in the plot
    expect(host.grabbable(blank)).toBe(false);
    expect(host.press(blank)).toBe(true);
    host.move([blank[0] + 81, blank[1]]); // one x unit is 81 logical units here
    expect(host.release([blank[0] + 81, blank[1]])).toBe("drag");
    expect((previews.at(-1) as { x_range: number[] }).x_range).toEqual([-6, 4]);
    // A tap on blank paper is still the play toggle's.
    expect(host.press(blank)).toBe(true);
    expect(host.release(blank)).toBe("pass");
    // Outside the plot (the margin left of the y axis) nothing is the body's.
    expect(host.press([40, 300])).toBe(false);
    expect(host.zoomAt([40, 300], 2)).toBe(false);
    expect(host.zoomAt(blank, 2)).toBe(true);
    expect(host.restPatch()).toEqual({ x_range: undefined, y_range: undefined });
    expect(host.toRest()).toBe(true);
    expect(host.restPatch()).toBeNull();
  });
});
