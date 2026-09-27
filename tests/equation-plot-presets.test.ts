// equation_plot presets (2026-09-28): the common science curves ready-made —
// equation, parameters, axes and the textbook's marks — with every field the
// author writes winning. Also the pieces they needed: hline / vline marks, a
// point's axis-foot words, a mark `at` that is an expression, mark ids, and a
// log x axis.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { scenes } from "../src/scenes/registry";
import { PRESETS, PRESET_NAMES, expandEquationPreset, withPreset } from "../src/scenes/equation_plot/presets";
import { logTicks, readModel, type EquationPlotParams } from "../src/scenes/equation_plot/model";
import { layoutEquationPlot } from "../src/scenes/equation_plot/layout";
import { lintEquationPlot } from "../src/scenes/equation_plot/lint";
import { eqParts, eqTarget, panPatch, zoomPatch } from "../src/scenes/equation_plot/widget";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, runWidget } from "../src/scenes/widget-run";
import { layoutSpec } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import { expandSpec } from "../src/spec/expand";
import { planCommands } from "../src/render/plan";
import { readParam } from "../src/render/params";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import manifest from "../src/scenes/equation_plot/manifest.json";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";
import type { RenderHandle } from "../src/render";
import type { Spec } from "../src/spec/types";

const module = scenes["equation_plot"];
const asRec = (p: EquationPlotParams) => p as unknown as Record<string, unknown>;
const pageOf = (p: EquationPlotParams) => layoutSpec({ template: "equation_plot", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: EquationPlotParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageOf(p) })!;
const valueOf = (params: unknown, name: string): number => {
  const v = (params as { params: Record<string, unknown> }).params[name];
  return typeof v === "number" ? v : (v as { value: number }).value;
};
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};

beforeAll(async () => {
  await ensureEngines(["mathjax"]);
});

describe("every preset", () => {
  test("the manifest lists exactly the presets, each with its line", () => {
    const schema = manifest.params_schema.properties.preset;
    expect(schema.enum).toEqual(PRESET_NAMES);
    for (const n of PRESET_NAMES) expect(schema.description).toContain(`${n}:`);
  });
  test.each(PRESET_NAMES)("%s: lints clean, validates, and draws its curves, equation lines and marks", (name) => {
    const P: EquationPlotParams = { preset: name };
    expect(lintEquationPlot(P)).toEqual([]);
    expect(validateSpec({ template: "equation_plot", params: P, commands: [{ speak: "Look." }] }).ok).toBe(true);
    const l = layoutEquationPlot(P);
    const base = PRESETS[name].params;
    const eqs = Array.isArray(base.equation) ? base.equation : [base.equation];
    eqs.forEach((_, i) => {
      expect(l.order).toContain(`curve_${i}`);
      expect(l.order).toContain(i === 0 ? "eq" : `eq_${i}`);
    });
    for (const mk of base.marks ?? []) if (typeof mk === "object" && mk.id) expect(l.order, mk.id).toContain(mk.id);
    // Every parameter is written in the equation or on the panel, with its preset value.
    const m = readModel(P);
    for (const p of m.params) expect(l.values![p.name]).toBe(p.value);
    // A laid-out preset reads nothing outside the page.
    for (const id of l.order) {
      const a = l.anchors[id];
      if (a) expect(a[0] >= 0 && a[0] <= 1000 && a[1] >= 0 && a[1] <= 750, `${name} ${id} at ${a}`).toBe(true);
    }
  });
  test("resolving is idempotent", () => {
    for (const n of PRESET_NAMES) {
      const once = withPreset({ preset: n, params: { x: 1 } as never, marks: [{ kind: "vline", at: 1 }] });
      expect(withPreset(once)).toEqual(once);
    }
  });
});

describe("the marks sit where the textbook puts them", () => {
  test("Michaelis–Menten: Vmax asymptote, Km at half of Vmax, with its words at the axes", () => {
    const l = layoutEquationPlot({ preset: "michaelis_menten" });
    expect(l.values).toMatchObject({ vmax: 10, km_x: 2, km_y: 5, V_max: 10, K_m: 2 });
    for (const id of ["vmax", "vmax_label", "km", "km_x_label", "km_y_label"]) expect(l.order).toContain(id);
    expect(l.attached!.km).toEqual(expect.arrayContaining(["km_x_label", "km_y_label"]));
    // "Km" stands under the x axis right below the point; "Vmax/2" left of the y axis at its height.
    const km = l.anchors.km;
    const xl = l.drawables.find((d) => d.id === "km_x_label") as { pos: Pt; text: string };
    const yl = l.drawables.find((d) => d.id === "km_y_label") as { pos: Pt; text: string };
    expect(xl.text).toBe("Km");
    expect(xl.pos[0]).toBeCloseTo(km[0], 6);
    expect(yl.text).toBe("Vmax/2");
    expect(yl.pos[1]).toBeCloseTo(km[1] - 7, 6);
    // The y range holds the asymptote, with room above it.
    expect(l.frame!.y[1]).toBeGreaterThan(10);
  });
  test("inhibitors: competitive moves Km, non-competitive lowers Vmax", () => {
    const c = layoutEquationPlot({ preset: "michaelis_menten_competitive" });
    expect(c.values!.km_app_x).toBeCloseTo(6, 9); // 2·(1 + 2/1)
    expect(c.values!.km_app_y).toBeCloseTo(5, 9); // half of the same Vmax
    const n = layoutEquationPlot({ preset: "michaelis_menten_noncompetitive" });
    expect(n.values!.vmax_app).toBeCloseTo(10 / 3, 5);
    expect(n.values!.km_i_x).toBe(2);
    expect(n.values!.km_i_y).toBeCloseTo(10 / 6, 5);
  });
  test("logistic: K and the inflection at K/2; the exponential runs off the top", () => {
    const l = layoutEquationPlot({ preset: "logistic_growth" });
    expect(l.values!.capacity).toBe(1000);
    expect(l.values!.inflection_y).toBeCloseTo(500, 6);
    expect(l.values!.inflection_x).toBeCloseTo(Math.log(99) / 0.5, 5);
    const v = layoutEquationPlot({ preset: "logistic_vs_exponential" });
    expect(v.frame!.y).toEqual([0, 1200]);
    const exp = v.curveSamples!.curve_1;
    expect(exp.at(-1)![0]).toBeLessThan(v.frame!.box.x1 - 20); // cut at the top, not drawn to the end
  });
  test("dose–response: a log dose axis, EC50 at half the maximum", () => {
    const l = layoutEquationPlot({ preset: "dose_response" });
    expect(l.frame!.x).toEqual([-3, 3]); // the frame is log10 of the dose
    expect(l.values).toMatchObject({ x_min: 0.001, x_max: 1000, emax: 100, ec50_x: 1 });
    expect(l.values!.ec50_y).toBeCloseTo(50, 9);
    // EC50 = 1 sits mid-axis on six decades.
    const box = l.frame!.box;
    expect(l.anchors.ec50[0]).toBeCloseTo((box.x0 + box.x1) / 2, 6);
    const ticks = l.drawables.find((d) => d.id === "x_ticks") as { children: { kind: string; text?: string }[] };
    expect(ticks.children.filter((c) => c.kind === "text").map((c) => c.text)).toEqual(expect.arrayContaining(["0.01", "0.1", "10", "100"]));
  });
  test("oxygen: P50 26.8 mmHg at 50 %; a larger P50 is the right (Bohr) shift", () => {
    const l = layoutEquationPlot({ preset: "oxygen_dissociation" });
    expect(l.values!.p50_x).toBe(26.8);
    expect(l.values!.p50_y).toBeCloseTo(50, 9);
    const s = (P50: number, P: number) => readModel({ preset: "oxygen_dissociation", params: { P_50: P50 } }).curves[0].f(P, { P_50: P50, n: 2.7 });
    expect(s(26.8, 100)).toBeGreaterThan(97);
    expect(s(26.8, 40)).toBeGreaterThan(s(32, 40) + 10); // at tissue PO2 the shifted curve holds less
  });
  test("decay: half-lives", () => {
    const f = layoutEquationPlot({ preset: "first_order_decay" });
    expect(f.values!.half_life_x).toBeCloseTo(Math.LN2 / 0.2, 6);
    expect(f.values!.half_life_y).toBeCloseTo(50, 6);
    const r = layoutEquationPlot({ preset: "radioactive_decay" });
    expect(r.values).toMatchObject({ half_life_x: 5, half_life_y: 500, two_half_lives_x: 10, two_half_lives_y: 250 });
    const s = layoutEquationPlot({ preset: "second_order_decay" });
    expect(s.values!.half_life_x).toBeCloseTo(2, 9);
    expect(s.values!.half_life_y).toBeCloseTo(0.5, 9);
  });
  test("Beer–Lambert and the damped oscillation", () => {
    expect(layoutEquationPlot({ preset: "beer_lambert" }).values!.sample_y).toBeCloseTo(1.244, 9);
    const d = layoutEquationPlot({ preset: "damped_oscillation" });
    expect(d.values!.decay_time_x).toBe(5);
    expect(d.values!.decay_time_y).toBeCloseTo(Math.exp(-1), 6);
  });
});

describe("the author's fields win", () => {
  test("a number sets a preset parameter's value and keeps its range and label; an object's keys go over", () => {
    const P = withPreset({ preset: "michaelis_menten", params: { K_m: 4, V_max: { max: 50 } } });
    expect(P.params!.K_m).toEqual({ value: 4, min: 0.2, max: 10, step: 0.1, label: "Km" });
    expect(P.params!.V_max).toEqual({ value: 10, min: 1, max: 50, step: 0.5, label: "Vmax" });
    expect(layoutEquationPlot({ preset: "michaelis_menten", params: { K_m: 4 } }).values).toMatchObject({ km_x: 4, km_y: 5 });
  });
  test("ranges, labels, controls: the author's", () => {
    const P = withPreset({ preset: "oxygen_dissociation", x_range: [0, 150], x_label: "PO₂", controls: "equation" });
    expect(P).toMatchObject({ x_range: [0, 150], y_range: [0, 100], x_label: "PO₂", controls: "equation", y_label: "saturation %" });
    expect(layoutEquationPlot(P).order).not.toContain("knob_P_50");
  });
  test("marks are added to the preset's; preset_marks: false drops them", () => {
    const add = layoutEquationPlot({ preset: "oxygen_dissociation", marks: [{ kind: "vline", at: 40, label: "tissue" }] });
    for (const id of ["p50", "vline", "vline_label"]) expect(add.order).toContain(id);
    expect(add.values!.vline).toBe(40);
    const only = layoutEquationPlot({ preset: "oxygen_dissociation", preset_marks: false, marks: [{ kind: "point", at: 40, label: true }] });
    expect(only.order).not.toContain("p50");
    expect(only.order).toContain("point");
  });
  test("an equation of the author's own: the preset's parameters it no longer reads are left out", () => {
    const P = withPreset({ preset: "michaelis_menten", equation: "v(S) = V_max*S/(K_m + S) + b", preset_marks: false });
    expect(Object.keys(P.params!)).toEqual(["V_max", "K_m"]);
    const Q = withPreset({ preset: "dose_response", equation: "E(C) = E_max*C/(EC_50 + C)", preset_marks: false });
    expect(Object.keys(Q.params!)).toEqual(["E_max", "EC_50"]);
  });
  test("lint: an unknown preset is named with the list; neither equation nor preset is an error", () => {
    const msgs = lintEquationPlot({ preset: "michaelis" } as EquationPlotParams).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs[0]).toMatch(/^error: unknown preset "michaelis" — one of michaelis_menten, /);
    expect(lintEquationPlot({} as EquationPlotParams).map((i) => i.message)).toContain("no equation (write `equation`, or name a `preset`)");
    // …and reaches the spec's own issues, where an error sends it to repair.
    const issues = pageOf({ preset: "michaelis" } as EquationPlotParams).issues.filter((i) => i.rule === "template-params");
    expect(issues[0]).toMatchObject({ severity: "error", message: expect.stringMatching(/^template equation_plot: unknown preset "michaelis"/) });
  });
});

describe("the preset in the movie: expanded before layout, animate reaches the value", () => {
  const spec = {
    template: "equation_plot",
    params: { preset: "oxygen_dissociation" },
    commands: [{ speak: "Heat and acid shift it right.", animate: { "params.P_50": 32 }, duration: 2 }],
  } as unknown as Spec;
  test("expandSpec writes the preset out and re-aims the animate at .value", () => {
    const x = expandSpec(spec);
    expect((x.params as EquationPlotParams).params!.P_50).toMatchObject({ value: 26.8, min: 15, max: 45 });
    expect(x.commands![0].animate).toEqual({ "params.P_50.value": 32 });
    expect(readParam(x.params as Record<string, unknown>, "params.P_50.value")).toBe(26.8);
    const plan = planCommands(x.commands as never, [], { animateBase: x.params as Record<string, unknown> });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts["params.P_50.value"]).toBe(26.8);
    // Nothing to expand: the same object back.
    const plain = { template: "equation_plot", params: { equation: "y = a*x", params: { a: 2 } }, commands: [{ animate: { "params.a": 3 } }] } as unknown as Spec;
    expect(expandEquationPreset(plain)).toBe(plain);
  });
  test("the tray offers the preset's sliders", () => {
    const paths = module.sliders!({ preset: "oxygen_dissociation" }).map((s) => s.path);
    expect(paths).toEqual(["params.n.value", "params.P_50.value"]);
  });
});

describe("the paused viewer works a preset", () => {
  test("scrub K_m's number, type Vmax, slide P50, drag the Km point along the curve", () => {
    const P: EquationPlotParams = { preset: "michaelis_menten" };
    const sc = sceneOf(P);
    const parts = eqParts(sc);
    expect(parts).toEqual(expect.arrayContaining(["knob_V_max", "knob_K_m", "km", "eq_param_V_max", "eq_param_K_m", "curve_0"]));
    const from = centre(sc, "eq_param_K_m");
    const scrub = runWidget(module, asRec(P), [dragMoveEvent("eq_param_K_m", from, [from[0] + STEP_UNITS * 5, from[1]], sc)], { layout: pageOf(P) });
    expect(scrub.errors).toEqual([]);
    expect(valueOf(scrub.params, "K_m")).toBeCloseTo(2.5, 9);
    const typed = runWidget(module, asRec(P), [inputEvent("eq_param_V_max", 15)], { layout: pageOf(P) });
    expect(valueOf(typed.params, "V_max")).toBe(15);
    // The asymptote leaves the y range on screen: it widens to hold it.
    expect((typed.params.y_range as number[])[1]).toBeGreaterThan(15);
    // The km point rides the curve: dragged right by 3 units, K_m follows.
    const m = readModel(P);
    expect(eqTarget("km", m)).toMatchObject({ kind: "along" });
    const at = centre(sc, "km");
    const to = sc.toLogical([5, 0]);
    const along = runWidget(module, asRec(P), [dragMoveEvent("km", at, [to[0], at[1]], sc)], { layout: pageOf(P) });
    expect(valueOf(along.params, "K_m")).toBeCloseTo(5, 9);
    expect(layoutEquationPlot(along.params as EquationPlotParams).values).toMatchObject({ km_x: 5, km_y: 5 });
  });
  test("a log axis: the frame is log10 x, a riding point moves by a factor, zoom and pan keep the axis in powers of ten", () => {
    const P: EquationPlotParams = { preset: "dose_response" };
    const sc = sceneOf(P);
    expect(eqTarget("ec50", readModel(P))).toMatchObject({ kind: "along" });
    const at = centre(sc, "ec50");
    const to = sc.toLogical([1, 0]); // one decade right of EC50 = 1
    const run = runWidget(module, asRec(P), [dragMoveEvent("ec50", at, [to[0], at[1]], sc)], { layout: pageOf(P) });
    expect(valueOf(run.params, "EC_50")).toBeCloseTo(10, 6);
    expect(zoomPatch(P, [0, 50], 2).x_range).toEqual([0.0316, 31.6]);
    expect(panPatch(P, [0, 50], [1, 50]).x_range).toEqual([0.0001, 100]);
    // A curve drag reads the pressed x in the frame's units: grabbed at log10 C = −1 (C = 0.1,
    // E = 9.09), the Hill n moves it most there; pulled up to 20 it solves 0.1^n = 0.25, n ≈ 0.6.
    const curve = runWidget(module, asRec(P), [dragMoveEvent("curve_0", sc.toLogical([-1, 100 / 11]), sc.toLogical([-1, 20]), sc)], { layout: pageOf(P) });
    expect(curve.errors).toEqual([]);
    expect(valueOf(curve.params, "n")).toBeCloseTo(0.6, 9);
  });
});

describe("the new pieces, on their own", () => {
  test("log ticks: powers of ten, with 2s and 5s over a short span", () => {
    expect(logTicks(0.001, 1000)).toEqual([0.001, 0.01, 0.1, 1, 10, 100, 1000]);
    expect(logTicks(1, 100)).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });
  test("lint: a log axis needs x above 0; hline needs at; feet belong to points; ids are unique", () => {
    const msgs = (p: EquationPlotParams) => lintEquationPlot(p).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs({ equation: "y = x", x_scale: "log", x_range: [0, 10] })[0]).toMatch(/^error: x_scale "log" needs an x_range above 0/);
    expect(msgs({ equation: "y = x", marks: [{ kind: "hline" }] })).toContain("error: mark hline needs `at` (a y)");
    expect(msgs({ equation: "y = x", marks: [{ kind: "hline", at: 1, x_label: "a" }] })).toContain("warn: mark hline: x_label and y_label belong to a point — ignored");
    expect(msgs({ equation: "y = x", marks: [{ kind: "hline", at: 1, id: "a" }, { kind: "vline", at: 1, id: "a" }] })).toContain('error: two marks have the id "a"');
    expect(msgs({ equation: "y = x", marks: [{ kind: "point", at: "2*(" }] })[0]).toMatch(/^error: mark point: at "2\*\(" is neither/);
  });
  test("an expression `at` reads its parameters (and makes them parameters)", () => {
    const m = readModel({ equation: "y = x^2", marks: [{ kind: "point", at: "q/2" }], params: { q: 4 } });
    expect(m.params.map((p) => p.name)).toEqual(["q"]);
    expect(layoutEquationPlot({ equation: "y = x^2", marks: [{ kind: "point", at: "q/2" }], params: { q: 4 } }).values).toMatchObject({ point_x: 2, point_y: 4 });
  });
  test("two tall equation lines stack clear of each other", () => {
    const l = layoutEquationPlot({ preset: "michaelis_menten_competitive" });
    const span = (id: string) => {
      // The line's own glyphs (its group; the parameters' numbers are groups of their own).
      const ys = l.drawables.filter((d) => d.id === id).flatMap((d) => (d.kind === "group" ? d.children : [d])).flatMap((d) => (d.kind === "area" ? d.pts.map((p) => p[1]) : []));
      return [Math.min(...ys), Math.max(...ys)];
    };
    expect(span("eq")[0]).toBeGreaterThan(span("eq_1")[1]);
    // …and the plot's top keeps below the lower one.
    expect(l.frame!.box.y1).toBeLessThan(span("eq_1")[0]);
  });
});
