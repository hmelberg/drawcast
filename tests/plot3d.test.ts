// plot3d (built in since 2026-09-27; it was the mathlogic pack's): a 3D plot
// in orbit-camera perspective, and — with parameters in its expressions — a
// live one: the equation written with the values in, a panel of sliders,
// and a paused viewer who orbits, zooms and changes the numbers.
// tests/plot3d-parity.test.ts holds the parameter-free figures to what the
// pack version drew.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { scenes } from "../src/scenes/registry";
import { PACK_TEMPLATES } from "../src/scenes/packs";
import { catalogParts } from "../src/scenes/catalog";
import { layoutPlot3d, clipToBox, pageOf } from "../src/scenes/plot3d/layout";
import { lintPlot3d } from "../src/scenes/plot3d/lint";
import { rangeEnvs, readModel, steadyZAbs, type Plot3dParams } from "../src/scenes/plot3d/model";
import { cameraOf, orbitPatch, plotSurface, zoomPatch, ORBIT_DEG_PER_UNIT } from "../src/scenes/plot3d/widget";
import { SURFACE_PART, type WidgetScene } from "../src/scenes/widget-types";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, runWidget } from "../src/scenes/widget-run";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { readParam, withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import type { RenderHandle } from "../src/render";

const module = scenes["plot3d"];
const SADDLE: Plot3dParams = {
  surface: "a*x^2 - b*y^2",
  params: { a: { value: 1, min: -2, max: 2 }, b: { value: 1, min: -2, max: 2 } },
  marks: [{ at: [0, 0], label: true }],
};
const BUMP: Plot3dParams = {
  surface: "A*exp(-(x^2 + y^2)/(2*sigma^2))",
  domain: [-3, 3],
  params: { A: { value: 1.5, min: 0.5, max: 2, label: "height A" }, sigma: { value: 1, min: 0.4, max: 2, label: "width σ" } },
  controls: "panel",
};

const asRec = (p: Plot3dParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: Plot3dParams) => layoutSpec({ template: "plot3d", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: Plot3dParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const valueOf = (params: unknown, name: string): number => {
  const v = (params as { params: Record<string, unknown> }).params[name];
  return typeof v === "number" ? v : (v as { value: number }).value;
};
const wire = (l: ReturnType<typeof layoutPlot3d>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id) as { pts: Pt[] } | undefined;

beforeAll(async () => {
  await ensureEngines(["mathjax"]);
});

describe("the built-in", () => {
  test("a built-in, no longer a pack's — and every catalog still offers it", () => {
    expect(module.layout && module.widget && module.lint && module.sliders).toBeTruthy();
    expect(Object.values(PACK_TEMPLATES).flat()).not.toContain("plot3d");
    const { stable } = catalogParts({ request: "a saddle surface in 3D" });
    // Built-ins alone sit below the two-level threshold: a full entry.
    expect(stable).toContain("### Scene template: plot3d (READY");
    expect(module.manifest.engines).toEqual(["mathjax"]);
  });
  test("every manifest example lays out clean, with no lint at all", () => {
    for (const ex of module.manifest.examples) {
      const res = layoutSpec({ template: "plot3d", params: ex.params, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues, ex.request).toEqual([]);
    }
  });
});

describe("the pack version's contract", () => {
  test("saddle surface emits 2×grid_n wire polylines, all points finite and within the canvas", () => {
    const r = layoutPlot3d({ surface: "x^2 - y^2" });
    const wires = flattenDrawables(r.drawables).filter((d) => /^wire_(row|col)_\d+$/.test(d.id)) as { id: string; pts: [number, number][] }[];
    expect(wires).toHaveLength(24); // grid_n defaults to 12 -> 12 rows + 12 cols
    for (const w of wires) {
      expect(w.pts.length).toBeGreaterThan(1);
      for (const [x, y] of w.pts) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1000);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(750);
      }
    }
  });
  test("azimuth 35 vs 125 produce different projected geometry — the camera animates", () => {
    expect(wire(layoutPlot3d({ surface: "x^2 - y^2", azimuth_deg: 35 }), "wire_row_0")!.pts).not.toEqual(wire(layoutPlot3d({ surface: "x^2 - y^2", azimuth_deg: 125 }), "wire_row_0")!.pts);
  });
  test("a parametric helix samples ~samples points into one polyline", () => {
    const r = layoutPlot3d({ curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "t/6", t_min: 0, t_max: 12 * Math.PI, samples: 150 } });
    expect(wire(r, "curve")!.pts).toHaveLength(150);
  });
  test("points render a marker + label per entry, label optional per point", () => {
    const r = layoutPlot3d({ points: [{ at: [0.5, 0.5, 0.5], label: "P" }, { at: [-0.5, -0.5, -0.5] }] });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["pt_0", "pt_1"]));
    expect(r.labels.map((l) => l.id)).toContain("pt_label_0");
    expect(r.labels.map((l) => l.id)).not.toContain("pt_label_1");
  });
  test("a malformed expression is the lint's error — the figure keeps its axes and draws no surface", () => {
    const res = layoutSpec({ template: "plot3d", params: { surface: "x + " }, elements: [] } as never);
    expect(res.warnings).toEqual([]);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].severity).toBe("error");
    expect(res.issues[0].message).toMatch(/^template plot3d: surface "x \+ ": /);
    expect(res.order).toContain("axis_z");
    expect(res.order.some((id) => id.startsWith("wire_"))).toBe(false);
  });
  // The whole orbit range, for all three kinds, zero issues at any severity
  // (an elongated helix at cardinal azimuths near zero elevation once had
  // a short axis's label graze the long vertical axis).
  test("stays lint-clean — zero issues at any severity — across the whole orbit range, for every plot kind", () => {
    const kinds: Record<string, unknown>[] = [
      { surface: "x^2 - y^2" },
      { curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "t/6", t_min: 0, t_max: 12 * Math.PI } },
      { points: [{ at: [0.6, 0.6, 0.6], label: "A" }, { at: [-0.6, 0.4, -0.5], label: "B" }] },
      asRec(SADDLE),
      asRec(BUMP),
    ];
    for (const base of kinds)
      for (const azimuth_deg of [0, 45, 90, 135, 180, 225, 270, 315])
        for (const elevation_deg of [-45, -22, 0, 22, 80]) {
          const params = { ...base, azimuth_deg, elevation_deg };
          const res = layoutSpec({ template: "plot3d", params, elements: [] } as never);
          expect(res.issues, JSON.stringify(params)).toEqual([]);
          expect(res.warnings, JSON.stringify(params)).toEqual([]);
        }
  });
});

describe("parameters", () => {
  test("every free name but the variables is a parameter; the curve's variable is t", () => {
    expect(readModel(SADDLE).params.map((p) => p.name)).toEqual(["a", "b"]);
    const helix = readModel({ curve: { x_expr: "r*cos(t)", y_expr: "r*sin(t)", z_expr: "c*t" }, params: { r: 1 } });
    expect(helix.variables).toEqual(["t"]);
    expect(helix.params.map((p) => p.name)).toEqual(["r", "c"]);
    expect(helix.undeclared).toEqual(["c"]);
    expect(readModel({ surface: "x^2 - y^2" }).steady).toBe(false);
    expect(readModel(SADDLE).steady).toBe(true);
  });
  test("the equation is written with the values in, each value its own part; the panel draws a slider per bounded parameter", () => {
    const l = layoutPlot3d(SADDLE);
    expect(l.order).toEqual(expect.arrayContaining(["eq", "eq_param_a", "eq_param_b", "mark_0"]));
    expect(l.groups!.equations).toEqual(["eq", "eq_param_a", "eq_param_b"]);
    expect(l.attached!.eq).toEqual(["eq_param_a", "eq_param_b"]);
    expect(l.order.some((id) => id.startsWith("slider_"))).toBe(false); // controls: equation
    const b = layoutPlot3d(BUMP);
    expect(b.order).toEqual(expect.arrayContaining(["slider_A", "knob_A", "slider_sigma", "name_sigma", "value_sigma"]));
    expect(b.groups!.panel).toEqual(expect.arrayContaining(["slider_A", "slider_sigma"]));
    // A box when asked.
    const boxed = layoutPlot3d({ ...BUMP, params: { ...BUMP.params, sigma: { value: 1, min: 0.4, max: 2, control: "box" } } });
    expect(boxed.order).toContain("box_sigma");
  });
  test("a curve with parameters writes its three coordinates as one tuple", () => {
    const l = layoutPlot3d({ curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "c*t" }, params: { c: { value: 0.1, min: 0, max: 0.3 } } });
    expect(l.order).toEqual(expect.arrayContaining(["curve", "eq", "eq_param_c"]));
  });
  test("with parameters the z scale holds over their whole range: a doubled a is a doubled height, and the axes stand still", () => {
    const m = readModel(SADDLE);
    expect(rangeEnvs(m)).toHaveLength(1 + 9); // the current values + min/mid/max of each
    expect(steadyZAbs(m)).toBe(4); // a = 2 at x = ±1, or b = 2 at y = ±1
    // Seen from the side (elevation 0), a row's screen height is its z.
    const half = layoutPlot3d({ ...SADDLE, elevation_deg: 0, params: { a: { value: 1, min: -2, max: 2 }, b: { value: 0, min: -2, max: 2 } } });
    const full = layoutPlot3d({ ...SADDLE, elevation_deg: 0, params: { a: { value: 2, min: -2, max: 2 }, b: { value: 0, min: -2, max: 2 } } });
    const height = (l: ReturnType<typeof layoutPlot3d>) => {
      const ys = wire(l, "wire_row_0")!.pts.map((p) => p[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(full)).toBeGreaterThan(height(half) * 1.5);
    for (const id of ["axis_x", "axis_y", "axis_z"]) expect(half.anchors[id]).toEqual(full.anchors[id]);
    // Without parameters the pack's rule: stretched to fit, so 2x² − y² and x² − y² look alike in height.
    expect(readModel({ surface: "2*x^2" }).steady).toBe(false);
  });
  test("values: every parameter, the sampled z range, a mark's height, the camera", () => {
    const v = layoutPlot3d({ ...SADDLE, marks: [{ at: [0, 0] }, { at: [0.5, "a"] }] }).values!;
    expect(v).toMatchObject({ a: 1, b: 1, z_min: -1, z_max: 1, mark_0_z: 0, mark_1_x: 0.5, mark_1_y: 1, mark_1_z: -0.75, azimuth: 35, elevation: 22, zoom: 1 });
    const spec = { template: "plot3d", params: SADDLE, elements: [{ id: "note", type: "text", text: "a = {plot3d.a}, top {plot3d.z_max}", x: 500, y: 40 }], commands: [] };
    const note = layoutSpec(spec as unknown as RenderHandle["spec"]).drawables.find((d) => d.id === "note") as { text: string };
    expect(note.text).toBe("a = 1, top 1");
  });
  test("zoomed or sharing the page, the ink stays in the plot's box", () => {
    expect(clipToBox([[0, 0], [10, 0], [20, 0]], { x0: 5, y0: -1, x1: 15, y1: 1 })).toEqual([[[5, 0], [10, 0], [15, 0]]]);
    expect(clipToBox([[0, 0], [10, 0], [10, 10], [0, 10]], { x0: 5, y0: -1, x1: 15, y1: 5 })).toEqual([[[5, 0], [10, 0], [10, 5]]]);
    const P = { ...SADDLE, zoom: 3 };
    const box = pageOf(readModel(P)).box;
    for (const d of flattenDrawables(layoutPlot3d(P).drawables))
      if (/^wire_/.test(d.id) && d.kind === "stroke") for (const [x, y] of d.pts) expect(x >= box.x0 - 1e-9 && x <= box.x1 + 1e-9 && y >= box.y0 - 1e-9 && y <= box.y1 + 1e-9).toBe(true);
  });
});

describe("lint", () => {
  test("the problems it names", () => {
    const msgs = (P: Plot3dParams) => lintPlot3d(P).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs(SADDLE)).toEqual([]);
    expect(msgs(BUMP)).toEqual([]);
    expect(msgs({ surface: "sinn(x)" })).toEqual(['error: surface "sinn(x)": unknown function "sinn"']);
    expect(msgs({ surface: "a*x^2", params: { a: { value: 5, min: 0, max: 2 } } })).toEqual(['error: param "a": value 5 is outside its range [0, 2]']);
    expect(msgs({ surface: "k*x^2", params: { a: 1 } })).toEqual(['warn: "k" is not in params — it is drawn at 1; declare it (with min/max for a slider)']);
    expect(msgs({ surface: "ax^2", params: {} })[0]).toMatch(/"ax" is read as one parameter — for a product write a\*x/);
    expect(msgs({ surface: "sqrt(-1 - x^2)" })).toEqual(["error: the surface is undefined over the whole domain [-1, 1] at these parameter values"]);
    expect(msgs({ ...SADDLE, marks: [{ at: [4, 0] }] })).toEqual(["warn: mark 0: (4, 0) is outside the domain [-1, 1]"]);
    expect(msgs({ ...SADDLE, editable: ["q"] })).toEqual(['warn: editable: "q" is not a parameter of the equation']);
    expect(msgs({ surface: "x", curve: { x_expr: "t", y_expr: "t", z_expr: "t" } })).toEqual(["warn: give one of surface, curve or points — only the surface is drawn"]);
    expect(msgs({ ...SADDLE, show_equation: false })).toEqual(['warn: controls "equation" with show_equation false: the viewer has nothing to change the parameters with — use controls "panel"']);
    expect(msgs({ ...SADDLE, show_equation: false, controls: "panel" })).toEqual([]);
  });
});

describe("the widget: the parameters", () => {
  test("parts are the live controls only — the wireframe is paper to orbit", () => {
    const sc = sceneOf(SADDLE);
    expect(module.widget!().parts).toBeTypeOf("function");
    const parts = (module.widget!().parts as (s: WidgetScene) => string[])(sc);
    expect(parts).toEqual(["eq_param_a", "eq_param_b"]);
    expect((module.widget!().parts as (s: WidgetScene) => string[])(sceneOf(BUMP))).toEqual(expect.arrayContaining(["knob_A", "slider_A", "value_A"]));
  });
  test("scrubbing a number in the equation", () => {
    const sc = sceneOf(SADDLE);
    const from = centre(sc, "eq_param_b");
    const run = runWidget(module, asRec(SADDLE), [dragMoveEvent("eq_param_b", from, [from[0] - STEP_UNITS * 5, from[1]], sc)], { layout: pageFor(SADDLE) });
    expect(run.errors).toEqual([]);
    expect(valueOf(run.params, "b")).toBe(0.5);
    expect((run.params.params as Record<string, unknown>).b).toEqual({ value: 0.5, min: -2, max: 2 });
  });
  test("tap to type: a field with the bounds, the typed value lands", () => {
    const sc = sceneOf(SADDLE);
    expect(module.widget!().editable!("eq_param_a", centre(sc, "eq_param_a"), sc)).toEqual({ value: 1, label: "a", step: 0.1, min: -2, max: 2 });
    const run = runWidget(module, asRec(SADDLE), [inputEvent("eq_param_a", -1.5)], { layout: pageFor(SADDLE) });
    expect(valueOf(run.params, "a")).toBe(-1.5);
  });
  test("a slider takes the value under the pointer", () => {
    const sc = sceneOf(BUMP);
    const knob = centre(sc, "knob_sigma");
    const track = sc.lines.get("slider_sigma")![0];
    const [x0, x1] = [Math.min(...track.map((p) => p[0])), Math.max(...track.map((p) => p[0]))];
    const run = runWidget(module, asRec(BUMP), [dragMoveEvent("knob_sigma", knob, [x1 + 40, knob[1]], sc)], { layout: pageFor(BUMP) });
    expect(valueOf(run.params, "sigma")).toBe(2);
    const mid = runWidget(module, asRec(BUMP), [dragMoveEvent("knob_sigma", knob, [x0 + 0.5 * (x1 - x0), knob[1]], sc)], { layout: pageFor(BUMP) });
    expect(valueOf(mid.params, "sigma")).toBe(1.2);
  });
  test("the tray: a slider per editable bounded parameter, at the path animate uses", () => {
    expect(module.sliders!(asRec(SADDLE))).toEqual([
      { path: "params.a.value", label: "a", min: -2, max: 2, step: 0.1 },
      { path: "params.b.value", label: "b", min: -2, max: 2, step: 0.1 },
    ]);
    expect(module.sliders!({ surface: "x^2 - y^2" })).toEqual([]);
  });
});

describe("the widget: the camera", () => {
  test("orbit: the front follows the hand; elevation is clamped; zoom is clamped", () => {
    const P: Plot3dParams = { surface: "x^2 - y^2" };
    expect(orbitPatch(P, [500, 300], [600, 300])).toEqual({ azimuth_deg: 35 - 100 * ORBIT_DEG_PER_UNIT, elevation_deg: 22 });
    expect(orbitPatch(P, [500, 300], [500, 250])).toEqual({ azimuth_deg: 35, elevation_deg: 22 + 50 * ORBIT_DEG_PER_UNIT });
    expect(orbitPatch(P, [500, 300], [500, -2000])).toEqual({ azimuth_deg: 35, elevation_deg: 85 });
    expect(orbitPatch({ ...P, elevation_deg: 10 }, [500, 300], [500, 2000])).toEqual({ azimuth_deg: 35, elevation_deg: -85 });
    expect(zoomPatch(P, 2)).toEqual({ zoom: 2 });
    expect(zoomPatch({ ...P, zoom: 2 }, 4)).toEqual({ zoom: 3 });
    expect(zoomPatch(P, 0.1)).toEqual({ zoom: 0.4 });
    // The front point (math (0, 1, 0) faces the viewer at azimuth 0) moves right with a drag right.
    const front = (az: number) => layoutPlot3d({ points: [{ at: [0, 1, 0] }], azimuth_deg: az, elevation_deg: 0 }).anchors.pt_0[0];
    const turned = orbitPatch({ azimuth_deg: 0 }, [0, 0], [20, 0]).azimuth_deg as number;
    expect(front(turned)).toBeGreaterThan(front(0));
  });
  test("zoom magnifies about the plot's centre", () => {
    const a = layoutPlot3d({ surface: "x^2 - y^2" }).anchors.axis_x;
    const b = layoutPlot3d({ surface: "x^2 - y^2", zoom: 2 }).anchors.axis_x;
    expect(b[0] - 500).toBeCloseTo((a[0] - 500) * 2, 6);
    expect(b[1] - 350).toBeCloseTo((a[1] - 350) * 2, 6);
  });
  test("the body: a drag on blank paper or the wireframe orbits; a zoom event zooms; rest goes back to the paused camera", () => {
    const P: Plot3dParams = { ...SADDLE, azimuth_deg: 60 };
    const sc = sceneOf(P);
    const body = module.widget!();
    const state = body.init(sc);
    const surf = plotSurface(sc)!;
    const eq = sc.boxes.get("eq")!;
    expect(surf.y + surf.h).toBeLessThan(eq.y);
    const from: Pt = [surf.x + 20, surf.y + 20];
    const orbit = body.on({ type: "drag_move", id: SURFACE_PART, from, fromDomain: null, point: [from[0] + 50, from[1] + 25], domain: null }, state, sc);
    const patch = (orbit.effects as { patch: Record<string, unknown> }[])[0].patch;
    expect(patch).toEqual({ azimuth_deg: 60 - 50 * ORBIT_DEG_PER_UNIT, elevation_deg: 22 - 25 * ORBIT_DEG_PER_UNIT });
    const turned = { ...P, ...patch } as Plot3dParams;
    expect(body.rest!(sceneOf(turned), state)).toEqual({ azimuth_deg: 60, elevation_deg: undefined, zoom: undefined });
    expect(body.rest!(sc, state)).toBeNull();
    const z = body.on({ type: "zoom", point: from, domain: null, factor: 1.5 }, state, sc);
    expect((z.effects as { patch: Record<string, unknown> }[])[0].patch).toEqual({ zoom: 1.5 });
    expect(body.restLabel).toBe("Reset view");
  });
  test("the host: a press on the wireframe orbits live; ctrl-wheel zooms; the pill's patch resets; a tap passes", () => {
    const P: Plot3dParams = { surface: "x^2 - y^2" };
    const spec = { template: "plot3d", params: P, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const previews: Record<string, unknown>[] = [];
    let painted: ReturnType<typeof layoutSpec> | null = null;
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: Record<string, unknown>) => {
        painted = layoutSpec({ ...spec, params: { ...P, ...o } } as unknown as RenderHandle["spec"]);
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
    expect(host.restLabel).toBe("Reset view");
    const onWire = (wire(layout as never, "wire_row_5") as { pts: Pt[] }).pts[6];
    expect(host.grabbable(onWire)).toBe(false); // paper, not a part
    expect(host.press(onWire)).toBe(true);
    host.move([onWire[0] + 100, onWire[1]]);
    expect(host.release([onWire[0] + 100, onWire[1]])).toBe("drag");
    expect(previews.at(-1)).toEqual({ azimuth_deg: 35 - 100 * ORBIT_DEG_PER_UNIT, elevation_deg: 22 });
    expect(host.press(onWire)).toBe(true);
    expect(host.release(onWire)).toBe("pass");
    expect(host.press([990, 10])).toBe(false); // off the plot: the camera's
    expect(host.zoomAt([990, 10], 2)).toBe(false);
    expect(host.zoomAt(onWire, 2)).toBe(true);
    expect((previews.at(-1) as { zoom: number }).zoom).toBe(2);
    expect(host.restPatch()).toEqual({ azimuth_deg: undefined, elevation_deg: undefined, zoom: undefined });
    expect(host.toRest()).toBe(true);
    expect(host.restPatch()).toBeNull();
  });
  test("cameraOf fills the template's defaults", () => {
    expect(cameraOf({})).toEqual({ azimuth: 35, elevation: 22, zoom: 1 });
  });
});

describe("the movie", () => {
  test("animate a parameter and the orbit: from the drawn values, and the figure follows", () => {
    // An orbit starts from the azimuth the params write (the pack's rule: no number, no tween).
    const P = { ...SADDLE, azimuth_deg: 35 };
    const spec = { template: "plot3d", params: P, commands: [{ animate: { "params.b.value": -1, azimuth_deg: 155 }, duration: 3 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(P) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts).toEqual({ "params.b.value": 1, azimuth_deg: 35 });
    expect(readParam(asRec(SADDLE), "params.b.value")).toBe(1);
    const mid = withOverrides(asRec(SADDLE), { "params.b.value": 0, azimuth_deg: 95 }) as unknown as Plot3dParams;
    const l = layoutPlot3d(mid);
    expect(l.values).toMatchObject({ b: 0, azimuth: 95 });
    expect(wire(l, "wire_row_0")!.pts).not.toEqual(wire(layoutPlot3d(SADDLE), "wire_row_0")!.pts);
    // The equation writes the value on the way.
    expect(l.order).toContain("eq_param_b");
    // A plot3d movie with no parameters animates as it always did.
    const plain = { template: "plot3d", params: { surface: "x^2 - y^2" }, commands: [{ animate: { azimuth_deg: 125, zoom: 1.5 }, duration: 2 }] };
    expect(validateSpec(plain).ok).toBe(true);
  });
});
