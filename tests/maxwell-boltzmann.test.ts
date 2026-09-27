// maxwell_boltzmann: the physics against known values, the figure's parts,
// the lint, and the paused viewer's gestures.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { boltzmannFactor, eMean, eMostProbable, energyForSpeed, energyPdf, erfc, fractionAbove, speedForEnergy, speedPdf, vMean, vMostProbable, vRms } from "../src/scenes/maxwell_boltzmann/physics";
import { layoutMaxwell, shareText, zoomText, type MaxwellParams } from "../src/scenes/maxwell_boltzmann/layout";
import { lintMaxwell } from "../src/scenes/maxwell_boltzmann/lint";
import { readModel } from "../src/scenes/maxwell_boltzmann/model";
import { maxwellWidget, stretchT } from "../src/scenes/maxwell_boltzmann/widget";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { WidgetScene } from "../src/scenes/widget-types";
import type { RenderHandle } from "../src/render";

const integrate = (f: (x: number) => number, a: number, b: number, n = 20000): number => {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
};

describe("the physics, exactly", () => {
  test("N2 at 300 K: most probable 422 m/s, mean 476 m/s, rms 517 m/s", () => {
    expect(vMostProbable(300, 28.0134)).toBeCloseTo(422, 0);
    expect(vMean(300, 28.0134)).toBeCloseTo(476, 0);
    expect(vRms(300, 28.0134)).toBeCloseTo(517, 0);
    // the ratios are the distribution's own: 1 : 2/√π : √(3/2)
    expect(vMean(300, 28) / vMostProbable(300, 28)).toBeCloseTo(2 / Math.sqrt(Math.PI), 12);
    expect(vRms(300, 28) / vMostProbable(300, 28)).toBeCloseTo(Math.sqrt(1.5), 12);
  });
  test("both densities are normalised, peak where they say, and have the right means", () => {
    for (const T of [200, 300, 1000]) {
      expect(integrate((v) => speedPdf(v, T, 28), 0, 6000)).toBeCloseTo(1, 6);
      expect(integrate((v) => v * speedPdf(v, T, 28), 0, 6000)).toBeCloseTo(vMean(T, 28), 2);
      expect(integrate((E) => energyPdf(E, T), 0, 200, 200000)).toBeCloseTo(1, 4);
      expect(integrate((E) => E * energyPdf(E, T), 0, 200, 200000)).toBeCloseTo(eMean(T), 3);
      const vp = vMostProbable(T, 28);
      expect(speedPdf(vp, T, 28)).toBeGreaterThan(speedPdf(vp * 1.01, T, 28));
      expect(speedPdf(vp, T, 28)).toBeGreaterThan(speedPdf(vp * 0.99, T, 28));
      const ep = eMostProbable(T);
      expect(energyPdf(ep, T)).toBeGreaterThan(energyPdf(ep * 1.01, T));
      expect(energyPdf(ep, T)).toBeGreaterThan(energyPdf(ep * 0.99, T));
    }
  });
  test("erfc against known values", () => {
    expect(erfc(0)).toBe(1);
    expect(erfc(0.5)).toBeCloseTo(0.4795001221869535, 14);
    expect(erfc(1)).toBeCloseTo(0.15729920705028513, 14);
    expect(erfc(2) / 0.004677734981047266).toBeCloseTo(1, 10);
    expect(erfc(3) / 2.209049699858544e-5).toBeCloseTo(1, 10);
    expect(erfc(5) / 1.5374597944280349e-12).toBeCloseTo(1, 10);
  });
  test("the share above Ea is the area under either curve beyond it", () => {
    const [Ea, T, M] = [10, 300, 28];
    const F = fractionAbove(Ea, T);
    expect(integrate((E) => energyPdf(E, T), Ea, 300, 200000)).toBeCloseTo(F, 6);
    expect(integrate((v) => speedPdf(v, T, M), speedForEnergy(Ea, M), 8000, 100000)).toBeCloseTo(F, 6);
    expect(energyForSpeed(speedForEnergy(Ea, M), M)).toBeCloseTo(Ea, 10);
    // Ea = 10 kJ/mol at 300 K: x = 4.009, F = erfc(√x) + 2√(x/π)e^{−x} ≈ 0.0460
    expect(F).toBeCloseTo(0.046, 3);
  });
  test("a small rise in T moves a thin tail a lot: 50 kJ/mol, 300 → 310 K about doubles it", () => {
    const r = fractionAbove(50, 310) / fractionAbove(50, 300);
    expect(r).toBeGreaterThan(1.8);
    expect(r).toBeLessThan(2.1);
    // collision theory's factor, for comparison: exp(Ea/R · (1/300 − 1/310)) ≈ 1.91
    expect(boltzmannFactor(50, 310) / boltzmannFactor(50, 300)).toBeCloseTo(1.91, 2);
  });
  test("the written share", () => {
    expect(shareText(0.46)).toBe("46 %");
    expect(shareText(0.046)).toBe("4.6 %");
    expect(shareText(0.0046)).toBe("0.46 %");
    expect(shareText(0.0000333)).toBe("1 in 30 000");
    expect(zoomText(100)).toBe("100");
    expect(zoomText(1e7)).toBe("10⁷");
  });
});

const module = scenes.maxwell_boltzmann;
const asRec = (p: MaxwellParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: MaxwellParams) => layoutSpec({ template: "maxwell_boltzmann", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: MaxwellParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const ids = (p: MaxwellParams) => new Set(flattenDrawables(layoutMaxwell(p).drawables).map((d) => d.id));

describe("the figure", () => {
  test("registered with a layout, a lint and a live widget; the manifest examples validate, lay out and lint clean", () => {
    expect(module.layout && module.lint && module.widget).toBeTruthy();
    expect(module.widget!().live).toBe(true);
    for (const ex of module.manifest.examples) {
      const spec = { template: "maxwell_boltzmann", params: ex.params, commands: [] };
      expect(validateSpec(spec).ok, ex.request).toBe(true);
      expect(module.lint!(ex.params), ex.request).toEqual([]);
      expect(() => layoutSpec(spec as never)).not.toThrow();
    }
  });
  test("the parts a cast names", () => {
    const all = ids({ mode: "energy", T: 300, compare: { T: 350 }, ea: 20, ea_catalyst: 14, tail_zoom: 20, speeds: ["mp", "mean"], title: "t" });
    for (const id of ["axes", "curve", "curve_label", "compare_curve", "compare_label", "ea_line", "ea_label", "ea_cat_line", "ea_cat_label", "shade", "compare_shade", "catalyst_shade", "fraction_label", "compare_fraction_label", "tail", "compare_tail", "catalyst_tail", "zoom_label", "mp_line", "mean_line", "title"]) expect(all.has(id), id).toBe(true);
  });
  test("values: the shares, the speeds and their ratios", () => {
    const v = layoutMaxwell({ T: 300, molar_mass: 28, compare: { T: 310 }, ea: 50, ea_catalyst: 40 }).values!;
    expect(v.v_mp).toBeCloseTo(422.1, 0);
    expect(v.fraction_above).toBeCloseTo(fractionAbove(50, 300), 12);
    expect(v.ratio).toBeCloseTo(fractionAbove(50, 310) / fractionAbove(50, 300), 3);
    expect(v.catalyst_ratio).toBeGreaterThan(40);
    expect(v.T2).toBe(310);
  });
  test("a hotter gas moves the curve, not the axes", () => {
    const a = layoutMaxwell({ T: 300 });
    const b = layoutMaxwell({ T: 500 });
    expect(b.frame).toEqual(a.frame);
    const peak = (l: ReturnType<typeof layoutMaxwell>) => l.curveSamples!.curve.reduce((p, q) => (q[1] > p[1] ? q : p));
    expect(peak(b)[0]).toBeGreaterThan(peak(a)[0]);
    expect(peak(b)[1]).toBeLessThan(peak(a)[1]);
  });
  test("lint: a catalyst above Ea, an unseen tail, T outside its range", () => {
    const msg = (p: MaxwellParams) => lintMaxwell(p).map((i) => `${i.severity}: ${i.message}`).join("\n");
    expect(msg({ ea: 20, ea_catalyst: 25, mode: "energy" })).toMatch(/error: .*LOWERS/);
    expect(msg({ ea: 50, mode: "energy" })).toMatch(/too thin to see/);
    expect(msg({ T: 300, t_range: [400, 800] })).toMatch(/outside t_range/);
    expect(msg({ ea_catalyst: 10 })).toMatch(/needs ea/);
    expect(msg({ mode: "energy", ea: 20, tail_zoom: 1000 })).toMatch(/off the top/);
  });
});

describe("the paused viewer", () => {
  const body = () => maxwellWidget();
  const drag = (p: MaxwellParams, id: string, fromD: number, toD: number) => {
    const sc = sceneOf(p);
    const from = sc.toLogical([fromD, 0]);
    const to = sc.toLogical([toD, 0]);
    const r = body().on({ type: "drag_move", id, from, fromDomain: [fromD, 0], point: to, domain: [toD, 0] }, {}, sc);
    return (r.effects as { patch: Record<string, unknown> }[])[0]?.patch;
  };
  test("pulling the only curve right leaves it and makes a hotter second one; the point under the hand stays under it", () => {
    const P: MaxwellParams = { T: 300 };
    const vp = vMostProbable(300, 28);
    const patch = drag(P, "curve", vp, vp * 1.1)!;
    expect(patch.T).toBeUndefined();
    const T2 = (patch.compare as { T: number }).T;
    expect(T2).toBeCloseTo(300 * 1.21, -1);
    expect(vMostProbable(T2, 28)).toBeCloseTo(vp * 1.1, -1);
    expect(patch.t_range).toEqual(readModel(P).tRange);
  });
  test("with two curves each drags its own temperature, clamped to t_range", () => {
    const P: MaxwellParams = { T: 300, compare: { T: 350 }, t_range: [200, 600] };
    const vp = vMostProbable(300, 28);
    expect(drag(P, "curve", vp, vp * 0.9)!.T).toBe(Math.round(300 * 0.81));
    expect(drag(P, "curve", vp, vp * 3)!.T).toBe(600);
    expect(stretchT(readModel({ mode: "energy", T: 300 }), 300, 2, 3)).toBe(450);
  });
  test("the Ea line follows the hand, above the catalyst's; the catalyst's stays below Ea", () => {
    const P: MaxwellParams = { mode: "energy", T: 300, ea: 20, ea_catalyst: 14, tail_zoom: 20 };
    expect(drag(P, "ea_line", 20, 24)!.ea).toBe(24);
    expect(drag(P, "ea_line", 20, 5)!.ea).toBe(14.5);
    expect(drag(P, "ea_cat_line", 14, 11)!.ea_catalyst).toBe(11);
    expect(drag(P, "ea_cat_line", 14, 26)!.ea_catalyst).toBe(19.5);
  });
  test("a temperature label scrubs and takes typing", () => {
    const P: MaxwellParams = { T: 300 };
    const sc = sceneOf(P);
    const b = body();
    const at: Pt = [500, 500];
    const r = b.on({ type: "drag_move", id: "curve_label", from: at, fromDomain: null, point: [at[0] + 40, at[1]], domain: null }, {}, sc);
    expect((r.effects as { patch: { T: number } }[])[0].patch.T).toBe(350);
    expect(b.editable!("curve_label", at, sc)).toMatchObject({ value: 300, min: 250, max: 600 });
    const typed = b.on({ type: "input", id: "curve_label", value: 420, point: at }, {}, sc);
    expect((typed.effects as { patch: { T: number } }[])[0].patch.T).toBe(420);
  });
});
