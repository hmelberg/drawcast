// titration_curve: the chemistry against known values, the figure's parts,
// the lint, and the paused viewer's gestures.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { scenes } from "../src/scenes/registry";
import { equivalenceVolumes, indicatorColor, INDICATORS, nearestIndicator, phAt, volumeAtPh, type Titration } from "../src/scenes/titration_curve/chem";
import { layoutTitration, type TitrationParams } from "../src/scenes/titration_curve/layout";
import { lintTitration } from "../src/scenes/titration_curve/lint";
import { readModel } from "../src/scenes/titration_curve/model";
import { SURFACE_PART, type WidgetScene } from "../src/scenes/widget-types";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { layoutSpec } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import type { Pt } from "../src/layout/model";
import type { RenderHandle } from "../src/render";

const T = (kind: Titration["kind"], pkas: number[] = [], ca = 0.1, va = 25, ct = 0.1): Titration => ({ kind, ca, va, ct, pkas });

describe("the chemistry, exactly", () => {
  test("0.1 M HCl with 0.1 M NaOH: pH 1 at the start, 7 at equivalence, 12.96 at double", () => {
    const t = T("strong_acid");
    expect(phAt(t, 0)).toBeCloseTo(1, 6);
    expect(equivalenceVolumes(t)).toEqual([25]);
    expect(phAt(t, 25)).toBeCloseTo(7, 6);
    // 12.5 mL: 1.25 mmol H⁺ left in 37.5 mL → 0.0333 M, pH 1.477
    expect(phAt(t, 12.5)).toBeCloseTo(-Math.log10(1.25 / 37.5), 4);
    // 50 mL: 2.5 mmol OH⁻ in 75 mL → pOH 1.477
    expect(phAt(t, 50)).toBeCloseTo(14 + Math.log10(2.5 / 75), 4);
  });
  test("0.1 M acetic acid (pKa 4.76) with 0.1 M NaOH: start 2.88, half-equivalence 4.76, equivalence 8.73", () => {
    const t = T("weak_acid", [4.76]);
    expect(phAt(t, 0)).toBeCloseTo(2.88, 2);
    expect(phAt(t, 12.5)).toBeCloseTo(4.76, 2);
    expect(phAt(t, 25)).toBeCloseTo(8.72, 1);
    // exact: 0.05 M acetate, Kb = 1e-14 / 10^-4.76, [OH⁻] from the quadratic
    const kb = 1e-14 / 10 ** -4.76;
    const oh = (-kb + Math.sqrt(kb * kb + 4 * kb * 0.05)) / 2;
    expect(phAt(t, 25)).toBeCloseTo(14 + Math.log10(oh), 2);
  });
  test("0.1 M NH3 (NH4+ pKa 9.25) with 0.1 M HCl: start 11.13, half 9.25, equivalence 5.28", () => {
    const t = T("weak_base", [9.25]);
    expect(phAt(t, 0)).toBeCloseTo(11.12, 1);
    expect(phAt(t, 12.5)).toBeCloseTo(9.25, 2);
    expect(phAt(t, 25)).toBeCloseTo(5.28, 1);
  });
  test("0.1 M NaOH with 0.1 M HCl: 13 → 7 → 1.04", () => {
    const t = T("strong_base");
    expect(phAt(t, 0)).toBeCloseTo(13, 6);
    expect(phAt(t, 25)).toBeCloseTo(7, 6);
    expect(phAt(t, 50)).toBeCloseTo(-Math.log10(2.5 / 75), 4);
  });
  test("a diprotic acid has two equivalence points and a half-way point at each pKa", () => {
    const t = T("weak_acid", [2.15, 7.2]); // phosphoric-like
    expect(equivalenceVolumes(t)).toEqual([25, 50]);
    expect(phAt(t, 37.5)).toBeCloseTo(7.2, 1);
    expect(phAt(t, 25)).toBeGreaterThan(4);
    expect(phAt(t, 25)).toBeLessThan(5.2);
  });
  test("the curve only rises for an acid (and only falls for a base)", () => {
    for (const t of [T("strong_acid"), T("weak_acid", [4.76]), T("weak_acid", [2, 7, 12])]) {
      let last = -Infinity;
      for (let v = 0; v <= 90; v += 0.5) {
        const p = phAt(t, v);
        expect(p).toBeGreaterThanOrEqual(last - 1e-9);
        last = p;
      }
    }
  });
  test("volumeAtPh inverts the curve", () => {
    const t = T("weak_acid", [4.76]);
    const v = volumeAtPh(t, 5.76, 0, 25)!;
    expect(phAt(t, v)).toBeCloseTo(5.76, 6);
    // the buffer's upper end: [A⁻]/[HA] = 10 ⇒ about 10/11 of the way
    expect(v).toBeCloseTo(25 * (10 / 11), 0);
  });
  test("indicators: phenolphthalein is colourless below 8.2 and pink above 10", () => {
    const ph = INDICATORS.phenolphthalein;
    expect(indicatorColor(ph, 7)).toBe(ph.acid);
    expect(indicatorColor(ph, 11)).toBe(ph.base);
    expect(nearestIndicator(9).name).toBe("phenolphthalein");
    expect(nearestIndicator(3.7).name).toBe("methyl_orange");
    expect(nearestIndicator(6.8).name).toBe("bromothymol_blue");
  });
});

const module = scenes.titration_curve;
const asRec = (p: TitrationParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: TitrationParams) => layoutSpec({ template: "titration_curve", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: TitrationParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const ids = (p: TitrationParams) => new Set(layoutTitration(p).order);

beforeAll(async () => {
  await ensureEngines(["mathjax"]);
});

describe("the figure", () => {
  test("registered with a layout, a lint and a live widget; the manifest examples validate, lay out and lint clean", () => {
    expect(module.layout && module.lint && module.widget).toBeTruthy();
    expect(module.widget!().live).toBe(true);
    for (const ex of module.manifest.examples) {
      const spec = { template: "titration_curve", params: ex.params, commands: [] };
      expect(validateSpec(spec).ok, ex.request).toBe(true);
      expect(module.lint!(ex.params), ex.request).toEqual([]);
      expect(() => layoutSpec(spec as never)).not.toThrow();
    }
  });
  test("the parts a cast names", () => {
    const a = ids({ kind: "weak_acid", pka: 4.76, label: "weak", compare: { kind: "strong_acid", label: "strong" }, neutral: true, indicator: "phenolphthalein", v: 10, flask: true, title: "t" });
    for (const id of ["axes", "curve", "curve_label", "compare_curve", "compare_label", "eq_point", "eq_label", "compare_eq_point", "half_point", "half_label", "buffer", "buffer_label", "indicator_band", "indicator_label", "neutral_line", "cursor", "cursor_dot", "cursor_label", "legend", "num_c_analyte", "num_v_analyte", "num_c_titrant", "num_pka", "burette", "flask", "flask_liquid", "title"]) expect(a.has(id), id).toBe(true);
    const di = ids({ kind: "weak_acid", pka: [2.15, 7.2] });
    for (const id of ["eq_point_2", "half_point_2", "buffer_2", "num_pka_2"]) expect(di.has(id), id).toBe(true);
    const strong = ids({ kind: "strong_acid" });
    expect(strong.has("half_point") || strong.has("buffer") || strong.has("num_pka")).toBe(false);
  });
  test("values: the pH at the cursor and the computed marks", () => {
    const v = layoutTitration({ kind: "weak_acid", pka: 4.76, v: 12.5, compare: { kind: "strong_acid" } }).values!;
    expect(v.v_eq).toBe(25);
    expect(v.ph_eq).toBeCloseTo(8.72, 1);
    expect(v.ph).toBeCloseTo(4.76, 2);
    expect(v.ph_half).toBeCloseTo(4.76, 2);
    expect(v.ph_start).toBeCloseTo(2.88, 2);
    expect(v.compare_ph_eq).toBeCloseTo(7, 3);
    expect(v.buffer_start).toBeCloseTo(25 / 11, 0);
  });
  test("trace draws the curve only as far as v, and the marks as they are reached", () => {
    const l = layoutTitration({ kind: "weak_acid", v: 10, trace: true });
    const pts = l.curveSamples!.curve;
    const box = l.frame!.box;
    expect(pts[pts.length - 1][0]).toBeCloseTo(box.x0 + (10 / 50) * (box.x1 - box.x0), 0);
    expect(l.order).not.toContain("eq_point");
    expect(l.order).not.toContain("half_point");
    expect(layoutTitration({ kind: "weak_acid", v: 13, trace: true }).order).toContain("half_point");
  });
  test("the flask takes the indicator's colour at the cursor's pH", () => {
    const fill = (v: number) => (layoutTitration({ indicator: "phenolphthalein", flask: true, v }).drawables.find((d) => d.id === "flask_liquid") as { fill?: string; style?: { fill?: string } });
    const c = (v: number) => JSON.stringify(fill(v));
    expect(c(10)).toContain(INDICATORS.phenolphthalein.acid);
    expect(c(40)).toContain(INDICATORS.phenolphthalein.base);
  });
  test("lint", () => {
    const msg = (p: TitrationParams) => lintTitration(p).map((i) => `${i.severity}: ${i.message}`).join("\n");
    expect(msg({ kind: "strong_acid", pka: 4 })).toMatch(/warn: pka is ignored/);
    expect(msg({ kind: "weak_acid" })).toMatch(/needs its pKa/);
    expect(msg({ pka: [7, 2] })).toMatch(/error: .*rise/);
    expect(msg({ c_analyte: -1, pka: 4.76 })).toMatch(/error: c_analyte/);
    expect(msg({ pka: 4.76, v_max: 20 })).toMatch(/past v_max/);
    expect(msg({ pka: 4.76, indicator: "litmus" })).toMatch(/unknown indicator/);
    expect(msg({ kind: "weak_acid", pka: 4.76, compare: { kind: "weak_base" } })).toMatch(/different titrants/);
    expect(msg({ kind: "weak_acid", pka: 4.76 })).toBe("");
  });
});

describe("the paused viewer", () => {
  const body = () => scenes.titration_curve.widget!();
  const run = (p: TitrationParams, id: string, fromD: Pt, toD: Pt) => {
    const sc = sceneOf(p);
    const r = body().on({ type: "drag_move", id, from: sc.toLogical(fromD), fromDomain: fromD, point: sc.toLogical(toD), domain: toD }, {}, sc);
    return (r.effects as { patch: Record<string, unknown> }[])[0]?.patch;
  };
  const P: TitrationParams = { kind: "weak_acid", pka: 4.76, v: 5 };
  test("the curve and the cursor move the volume, caught at the half-way and equivalence points", () => {
    expect(run(P, "curve", [5, 3.5], [17.3, 5])!.v).toBe(17.3);
    expect(run(P, "cursor", [5, 10], [12.2, 10])!.v).toBe(12.5);
    expect(run(P, "cursor_dot", [5, 4], [25.4, 4])!.v).toBe(25);
    expect(run(P, "cursor", [5, 10], [90, 10])!.v).toBe(50);
  });
  test("a half-equivalence point drags the pKa; an equivalence point the amount of acid (the axis held)", () => {
    expect(run(P, "half_point", [12.5, 4.76], [12.5, 6.1])!.pka).toBeCloseTo(6.1, 6);
    const eq = run(P, "eq_point", [25, 8.7], [30, 8.7])!;
    expect(eq.c_analyte).toBeCloseTo(0.12, 6);
    expect(eq.v_max).toBe(50);
    const di: TitrationParams = { kind: "weak_acid", pka: [2.15, 7.2] };
    expect(run(di, "half_point_2", [37.5, 7.2], [37.5, 1])!.pka).toEqual([2.15, 2.25]);
  });
  test("a press on the curve at a marked point takes the point", () => {
    const sc = sceneOf(P);
    const at = sc.toLogical([12.5, 4.76]);
    const r = body().on({ type: "drag_move", id: "curve", from: at, fromDomain: [12.5, 4.76], point: sc.toLogical([12.5, 5.76]), domain: [12.5, 5.76] }, {}, sc);
    expect((r.effects as { patch: Record<string, unknown> }[])[0].patch.pka).toBeCloseTo(5.76, 6);
  });
  test("the indicator band snaps to the indicator whose range is nearest", () => {
    expect(run({ ...P, indicator: "phenolphthalein" }, "indicator_band", [30, 9], [30, 4])!.indicator).toBe("methyl_orange");
    expect(run({ ...P, indicator: "methyl_orange" }, "indicator_band", [30, 3.7], [30, 6.5])!.indicator).toBe("bromothymol_blue");
  });
  test("the numbers above the plot scrub and take typing", () => {
    const sc = sceneOf(P);
    const b = body();
    const at: Pt = [500, 650];
    const scrub = (id: string, dx: number) => (b.on({ type: "drag_move", id, from: at, fromDomain: null, point: [at[0] + dx, at[1]], domain: null }, {}, sc).effects as { patch: Record<string, unknown> }[])[0].patch;
    expect(scrub("num_pka", 40).pka).toBeCloseTo(5.26, 6);
    expect(scrub("num_c_titrant", 20).c_titrant).toBeCloseTo(0.15, 6);
    expect(scrub("num_v_analyte", 8).v_analyte).toBe(27);
    expect(b.editable!("num_pka", at, sc)).toMatchObject({ value: 4.76, min: 0.5, max: 13.5 });
    const typed = b.on({ type: "input", id: "num_c_analyte", value: 0.2, point: at }, {}, sc);
    const patch = (typed.effects as { patch: Record<string, unknown> }[])[0].patch;
    expect(patch.c_analyte).toBe(0.2);
    // v_eq = 50 mL would sit on the axis's end: it widens
    expect(patch.v_max as number).toBeGreaterThan(50);
    expect(readModel({ ...P, ...patch }).vMax).toBe(patch.v_max);
  });
  test("the burette runs titrant in as it is pulled down", () => {
    const sc = sceneOf({ ...P, flask: true });
    const box = sc.boxes.get("burette")!;
    const top: Pt = [box.x + box.w / 2, box.y + box.h - 10];
    const r = body().on({ type: "drag_move", id: "burette", from: top, fromDomain: null, point: [top[0], top[1] - box.h / 4], domain: null }, {}, sc);
    const v = (r.effects as { patch: { v: number } }[])[0].patch.v;
    expect(v).toBeGreaterThan(5 + 10);
    expect(v).toBeLessThan(5 + 15);
  });
  test("nothing to take is nothing", () => {
    expect(run(P, "axes", [5, 5], [10, 5])).toBeUndefined();
    void SURFACE_PART;
  });
});
