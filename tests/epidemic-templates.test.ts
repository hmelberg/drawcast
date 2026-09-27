// The epidemic templates (2026-09-28): sir_compartments' live model mode and
// reed_frost, both pack documents (packs/evidence.yaml) — the maths they
// compute, the widget bodies' patches, the lint bodies, and the movie.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import { SURFACE_PART, type WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { planOptionsFor, type RenderHandle } from "../src/render/index";
import { widgetHostFor } from "../src/ui/widget-host";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import type { Pt } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["evidence"]);
});

type P = Record<string, unknown>;
const sirValues = (p: P) => scenes.sir_compartments.layout!(p).values!;
const rfValues = (p: P) => scenes.reed_frost.layout!(p).values!;
const page = (template: string, params: P) => layoutSpec({ template, params, commands: [] } as unknown as Spec);
const sceneOf = (template: string, params: P): WidgetScene => buildWidgetScene(scenes[template], params, { layout: page(template, params) })!;
const names = (template: string) => Object.keys((scenes[template].manifest.params_schema as { properties: object }).properties);
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
/** The patch a sideways scrub of `dx` units on part `id` gives, mid-gesture. */
const scrub = (template: string, params: P, id: string, dx: number) => {
  const sc = sceneOf(template, params);
  const p = centre(sc, id);
  const b = scenes[template].widget!();
  const r = stepWidget(b, b.init(sc), dragMoveEvent(id, p, [p[0] + dx, p[1] + 3], sc), sc, names(template));
  expect(r.errors).toEqual([]);
  return r.effects[0]?.patch;
};
/** Solve z = 1 − exp(−R0 z) independently (fixed-point from 1). */
const finalSize = (r0: number) => {
  let z = 1;
  for (let k = 0; k < 500; k++) z = 1 - Math.exp(-r0 * z);
  return z;
};

describe("sir_compartments: the live model's numbers", () => {
  const tiny = { initial_infected: 1e-6 };
  test("final size solves z = 1 − exp(−R0·z): R0 = 2 → 79.7 %, R0 = 3 → 94.0 %", () => {
    expect(finalSize(2)).toBeCloseTo(0.7968, 4);
    expect(sirValues({ r0: 2, ...tiny }).final_size).toBeCloseTo(79.68, 1);
    expect(sirValues({ r0: 3, ...tiny }).final_size).toBeCloseTo(finalSize(3) * 100, 1);
    expect(sirValues({ r0: 1.5, ...tiny }).final_size).toBeCloseTo(finalSize(1.5) * 100, 1);
    // SEIR: the latent stay delays the epidemic but does not change its size.
    expect(sirValues({ model: "seir", r0: 2, ...tiny }).final_size).toBeCloseTo(79.68, 1);
  });

  test("herd immunity is 1 − 1/R0: two thirds at R0 = 3, a half at 2, none below 1", () => {
    expect(sirValues({ r0: 3 }).hit).toBeCloseTo(66.67, 2);
    expect(sirValues({ r0: 2 }).hit).toBe(50);
    expect(sirValues({ r0: 0.8 }).hit).toBe(0);
  });

  test("the peak: I_max = 1 − (1 + ln R0)/R0, and Rt crosses 1 exactly there", () => {
    const v = sirValues({ r0: 3, ...tiny });
    expect(v.peak_i).toBeCloseTo((1 - (1 + Math.log(3)) / 3) * 100, 1);
    expect(Math.abs(v.cross_day - v.peak_day)).toBeLessThan(0.6);
    // A cursor on the peak day reads Rt = 1 and S = 1/R0.
    const at = sirValues({ r0: 3, ...tiny, cursor_day: v.peak_day });
    expect(at.r_eff).toBeCloseTo(1, 1);
    expect(at.s_at).toBeCloseTo(100 / 3, 0);
    // Before the peak Rt is above 1, after it below.
    expect(sirValues({ r0: 3, ...tiny, cursor_day: v.peak_day - 10 }).r_eff).toBeGreaterThan(1.2);
    expect(sirValues({ r0: 3, ...tiny, cursor_day: v.peak_day + 10 }).r_eff).toBeLessThan(0.8);
  });

  test("vaccination: Rt starts at R0·(1 − v); above the threshold there is no outbreak", () => {
    expect(sirValues({ r0: 3, vaccinated: 0.5 }).r_eff0).toBe(1.5);
    const below = sirValues({ r0: 3, vaccinated: 0.5, ...tiny });
    // z = (1 − v)(1 − exp(−R0 z))
    let z = 0.5;
    for (let k = 0; k < 500; k++) z = 0.5 * (1 - Math.exp(-3 * z));
    expect(below.final_size).toBeCloseTo(z * 100, 1);
    // Above it the first cases only ever shrink: all that is ever infected is
    // i0/(1 − Rt), a few times the seed, never an epidemic.
    const above = sirValues({ r0: 3, vaccinated: 0.7, initial_infected: 0.001 });
    expect(above.r_eff0).toBeCloseTo(0.9, 2);
    expect(above.peak_day).toBe(0);
    expect(above.final_size).toBeCloseTo(0.1 / (1 - 0.9), 0);
  });

  test("an intervention cutting contacts delays the peak and makes it smaller; lifted early, a second wave", () => {
    const base = sirValues({ r0: 2.5, days: 250 });
    const kept = sirValues({ r0: 2.5, days: 400, intervention: { start: 10, end: 400, reduction: 0.4 } });
    expect(kept.peak_day).toBeGreaterThan(base.peak_day);
    expect(kept.peak_i).toBeLessThan(base.peak_i);
    // Rt = 1.5 while it lasts: the final size is Rt's, not R0's.
    expect(kept.final_size).toBeLessThan(base.final_size);
    // Cut hard from day 30 to 90, the first wave turns early — and the
    // susceptibles left over carry a second one after the lifting.
    const lifted = scenes.sir_compartments.layout!({ r0: 2.5, days: 250, intervention: { start: 30, end: 90, reduction: 0.5 } });
    const i = (lifted.curveSamples!.curve_i as Pt[]).map((q) => q[1]);
    let turns = 0;
    for (let k = 1; k < i.length - 1; k++) if (i[k] > i[k - 1] && i[k] >= i[k + 1]) turns++;
    expect(turns).toBe(2);
    // Rt inside the band is halved.
    expect(sirValues({ r0: 2.5, days: 250, intervention: { start: 0, end: 90, reduction: 0.5 }, cursor_day: 1 }).r_eff).toBeCloseTo(1.25, 1);
  });

  test("endemic levels: SIS 1 − 1/R0; SIRS (1 − 1/R0)·ω/(ω + γ); births μ(R0 − 1)/β", () => {
    expect(sirValues({ model: "sis", r0: 2 }).endemic_i).toBe(50);
    const sis = sirValues({ model: "sis", r0: 2, days: 400, cursor_day: 400 });
    expect(sis.i_at).toBeCloseTo(50, 0);
    expect(sis.peak_day).toBeUndefined(); // it climbs to its level: no peak
    const w = 1 / 180, g = 0.1;
    expect(sirValues({ model: "sirs", r0: 3 }).endemic_i).toBeCloseTo(((2 / 3) * w * 100) / (w + g), 2);
    const mu = 1 / (50 * 365);
    expect(sirValues({ r0: 5, lifespan_years: 50 }).endemic_i).toBeCloseTo((mu * 4 * 100) / (5 * (g + mu)), 3); // μ(R0 − 1)/β
    expect(sirValues({ r0: 5, lifespan_years: 50 }).final_size).toBeUndefined();
  });

  test("R0 sets beta: β = R0·γ (SIR), and for SEIR with no deaths the same", () => {
    expect(sirValues({ r0: 2.5, infectious_days: 5 }).beta).toBe(0.5);
    expect(sirValues({ model: "seir", r0: 2.5, infectious_days: 5 }).beta).toBe(0.5);
  });

  test("every manifest example of the live model lays out clean", () => {
    for (const ex of scenes.sir_compartments.manifest.examples) {
      const out = page("sir_compartments", ex.params);
      expect(out.warnings, ex.request).toEqual([]);
      expect(out.issues.map((i) => `${i.rule}: ${i.message}`), ex.request).toEqual([]);
    }
  });

  test("the time axis is fitted to the epidemic's end in round steps, or the author's days", () => {
    expect(sirValues({ r0: 2 }).days).toBe(200);
    expect([30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400]).toContain(sirValues({ r0: 4 }).days);
    expect(sirValues({ r0: 2, days: 90 }).days).toBe(90);
  });
});

describe("sir_compartments: lint", () => {
  const lint = (p: P) => scenes.sir_compartments.lint!(p);
  test("shares above 1, a reversed intervention, and model-only params without the model", () => {
    expect(lint({ r0: 3, vaccinated: 60 })).toEqual([expect.objectContaining({ severity: "error", message: expect.stringMatching(/vaccinated is a share from 0 to 1/) })]);
    expect(lint({ r0: 3, intervention: { start: 50, end: 20 } })[0]).toMatchObject({ severity: "error" });
    expect(lint({ vaccinated: 0.5 })[0]).toMatchObject({ severity: "warn", message: expect.stringMatching(/set r0/) });
    expect(lint({ model: "sis", r0: 2, vaccinated: 0.5 })[0].message).toMatch(/no immune compartment/);
    expect(lint({ r0: 3, compartments: ["S", "I", "R"] })[0].message).toMatch(/ignored/);
    expect(lint({ r0: 3, vaccinated: 0.5, intervention: { start: 20, end: 50, reduction: 0.3 }, cursor_day: 40, days: 120 })).toEqual([]);
    expect(lint({})).toEqual([]);
  });
  test("reported through layoutSpec as template-params issues", () => {
    const out = page("sir_compartments", { r0: 3, vaccinated: 80 });
    expect(out.issues.find((i) => i.rule === "template-params")?.message).toMatch(/^template sir_compartments: vaccinated/);
  });
});

describe("sir_compartments: the widget (model mode only)", () => {
  const T = "sir_compartments";
  test("free play: live, editable, no manifest widget flag; the flow diagram alone offers no parts", () => {
    const b = scenes[T].widget!();
    expect(b.live).toBe(true);
    expect(scenes[T].manifest.widget).toBeUndefined();
    const legacy = sceneOf(T, { compartments: ["S", "I", "R"] });
    expect(legacy.ids).toContain("rate_0");
    expect((b.parts as (s: WidgetScene) => string[])(legacy)).toEqual([]);
    expect(b.surface!(legacy)).toBeNull();
    const live = sceneOf(T, { r0: 3, vaccinated: 0.2, intervention: { start: 20, end: 40, reduction: 0.3 }, cursor_day: 30 });
    expect((b.parts as (s: WidgetScene) => string[])(live)).toEqual(["r0_value", "rate_0", "rate_1", "vax_value", "intervention_label", "cursor", "intervention"]);
  });

  test("R0 scrubs by 0.1 per 4 units, holding the axis while the finger is down", () => {
    expect(scrub(T, { r0: 2.5 }, "r0_value", 20)).toEqual({ r0: 3, days: 150 });
    expect(scrub(T, { r0: 2.5, days: 120 }, "r0_value", -40)).toEqual({ r0: 1.5, days: 120 });
  });

  test("β scrubs with γ held (R0 follows); a longer infectious stay raises R0 with β held", () => {
    // β = 0.25 → 0.3 with γ = 0.1: R0 = 3.
    expect(scrub(T, { r0: 2.5, days: 150 }, "rate_0", 20)).toEqual({ r0: 3, days: 150 });
    // 10 → 12 days infectious at β = 0.25: R0 = 3.
    expect(scrub(T, { r0: 2.5, days: 150 }, "rate_1", 8)).toEqual({ infectious_days: 12, r0: 3, days: 150 });
    // SEIR: the latent stay is σ's (rate_1) and leaves R0 alone without deaths.
    expect(scrub(T, { model: "seir", r0: 2.5, days: 150 }, "rate_1", 8)).toEqual({ latent_days: 7, r0: 2.5, days: 150 });
  });

  test("vaccination and the intervention's cut scrub by 1 %; typed percents land as shares", () => {
    expect(scrub(T, { r0: 3, vaccinated: 0.4, days: 120 }, "vax_value", 40)).toEqual({ vaccinated: 0.5, days: 120 });
    const iv = { start: 20, end: 40, reduction: 0.3 };
    expect(scrub(T, { r0: 3, intervention: iv, days: 120 }, "intervention_label", -20)).toEqual({ intervention: { ...iv, reduction: 0.25 }, days: 120 });
    const run = runWidget(scenes[T], { r0: 3, vaccinated: 0.4 }, [inputEvent("vax_value", 67)]);
    expect(run.params.vaccinated).toBe(0.67);
    expect(scenes[T].widget!().editable!("vax_value", [0, 0], sceneOf(T, { r0: 3, vaccinated: 0.4 }))).toMatchObject({ value: 40, min: 0, max: 100 });
    expect(runWidget(scenes[T], { r0: 3 }, [inputEvent("r0_value", 12)]).params.r0).toBe(12);
  });

  test("the intervention band: the middle moves it, an edge moves only that edge", () => {
    const params = { r0: 3, days: 100, intervention: { start: 30, end: 60, reduction: 0.5 } };
    const sc = sceneOf(T, params);
    const b = scenes[T].widget!();
    const L = (d: number, pct = 80) => sc.toLogical([d, pct]);
    const move = (from: number, to: number) => stepWidget(b, b.init(sc), dragMoveEvent("intervention", L(from), L(to), sc), sc, names(T)).effects[0].patch as { intervention: { start: number; end: number } };
    expect(move(45, 55).intervention).toMatchObject({ start: 40, end: 70, reduction: 0.5 });
    expect(move(31, 21).intervention).toMatchObject({ start: 20, end: 60 }); // the left edge
    expect(move(59, 79).intervention).toMatchObject({ start: 30, end: 80 }); // the right edge
    expect(move(45, 200).intervention).toMatchObject({ start: 70, end: 100 }); // not past the axis
    expect(partAt(sc, L(45, 50), 18, (b.parts as (s: WidgetScene) => string[])(sc))).toBe("intervention");
  });

  test("the cursor and the blank plot: a drag reads the whole day under the pointer", () => {
    const params = { r0: 3, days: 100, cursor_day: 20 };
    const sc = sceneOf(T, params);
    const b = scenes[T].widget!();
    const x = (d: number) => sc.toLogical([d, 50]);
    expect(stepWidget(b, b.init(sc), dragMoveEvent("cursor", x(20), x(41.4), sc), sc, names(T)).effects[0].patch).toEqual({ cursor_day: 41, days: 100 });
    const plain = sceneOf(T, { r0: 3, days: 100 });
    const box = b.surface!(plain)!;
    expect(box.w).toBeGreaterThan(600);
    expect(stepWidget(b, b.init(plain), dragMoveEvent(SURFACE_PART, plain.toLogical([10, 50]), plain.toLogical([63, 50]), plain), plain, names(T)).effects[0].patch).toEqual({ cursor_day: 63, days: 100 });
  });

  test("the release gives the axis back to the author: fitted when they set no days", () => {
    const params = { r0: 3 };
    const sc = sceneOf(T, params);
    const p = centre(sc, "r0_value");
    // Every frame of a gesture, the release too, comes against the press-time scene.
    const b = scenes[T].widget!();
    const s0 = b.init(sc);
    const mid = stepWidget(b, s0, dragMoveEvent("r0_value", p, [p[0] - 60, p[1]], sc), sc, names(T));
    expect(mid.effects[0].patch).toEqual({ r0: 1.5, days: sirValues(params).days });
    const end = stepWidget(b, mid.state, { type: "drag", id: "r0_value", to: null, point: [p[0] - 60, p[1]], domain: null, from: p, fromDomain: null }, sc, names(T));
    expect(end.effects[0].patch).toEqual({ r0: 1.5, days: undefined });
    expect(sirValues({ ...params, ...end.effects[0].patch }).days).toBe(sirValues({ r0: 1.5 }).days);
    expect(sirValues({ r0: 1.5 }).days).toBeGreaterThan(sirValues(params).days);
  });
});

describe("sir_compartments: the movie", () => {
  const spec = {
    template: "sir_compartments",
    params: { r0: 1.5, days: 200, vaccinated: 0 },
    commands: [{ draw: ["axes", "curve_s", "curve_i", "curve_r", "r0_value"] }, { animate: { r0: 3 }, duration: 3 }, { animate: { vaccinated: 0.7 }, duration: 3 }],
  } as unknown as Spec;
  test("the planner tweens r0 and then vaccinated from the drawn values, with no warning", () => {
    expect(validateSpec(spec).ok).toBe(true);
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    const p = planCommands(spec.commands!, layout.order, {
      bboxOf: (id: string) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.params ?? {},
      ...planOptionsFor(spec, layout),
    } as never);
    const steps = p.steps.filter((s) => s.kind === "animate") as unknown as { targets: Record<string, number>; starts: Record<string, number | null> }[];
    expect(steps.map((s) => [s.starts, s.targets])).toEqual([
      [{ r0: 1.5 }, { r0: 3 }],
      [{ vaccinated: 0 }, { vaccinated: 0.7 }],
    ]);
    expect(p.warnings).toEqual([]);
  });
  test("each frame recomputes: the peak rises with r0, and falls away as coverage passes 1 − 1/R0", () => {
    const peaks = [1.5, 2, 2.5, 3].map((r0) => sirValues({ r0, days: 200 }).peak_i);
    expect(peaks).toEqual([...peaks].sort((a, b) => a - b));
    const cov = [0, 0.3, 0.6, 0.7].map((v) => sirValues({ r0: 3, days: 200, vaccinated: v }).final_size);
    expect(cov).toEqual([...cov].sort((a, b) => b - a));
    expect(cov[3]).toBeLessThan(1.5); // past 2/3 vaccinated, only the seed's own chains
    for (const r0 of [1.5, 2.25, 3]) {
      const out = page("sir_compartments", { r0, days: 200, vaccinated: 0.35 });
      expect(out.issues.map((i) => i.message), `r0 ${r0}`).toEqual([]);
    }
  });
});

describe("reed_frost: the exact chain binomial", () => {
  const dist = (p: P) => {
    // The bars' own probabilities are not exposed; p_minor + p_major is the total.
    const v = rfValues(p);
    return v.p_minor + v.p_major;
  };
  test("the final-size distribution sums to 1 for tiny and moderate groups", () => {
    for (const p of [{ population: 2, p: 0.5 }, { population: 3, p: 0.5 }, { population: 5, p: 0.3 }, { population: 30, r0: 2 }, { population: 100, r0: 1.5 }]) expect(dist(p)).toBeCloseTo(100, 6);
  });
  test("N = 3, p = 0.5 by hand: P(1) = 1/4, P(2) = 1/4, P(3) = 1/2", () => {
    // One case, two susceptibles, each escaping with 1/2. Neither caught
    // (1/4): the outbreak is 1. Both caught at once (1/4): 3. One caught
    // (1/2), who then catches the last one or not (1/2 each): 3 or 2.
    const v = rfValues({ population: 3, p: 0.5 });
    expect(v.p_no_spread).toBe(25);
    expect(v.mean_final).toBeCloseTo(1 * 0.25 + 2 * 0.25 + 3 * 0.5, 6);
    expect(v.p_minor + v.p_major).toBeCloseTo(100, 6);
  });
  test("no spread: the first case infects nobody with probability (1 − p)^(N − 1)", () => {
    expect(rfValues({ population: 30, r0: 2 }).p_no_spread).toBeCloseTo(100 * Math.pow(1 - 2 / 29, 29), 1);
    expect(rfValues({ population: 10, p: 0.2, initial: 2 }).p_no_spread).toBeCloseTo(100 * Math.pow(0.8, 16), 2);
  });
  test("expected cases in generation 1 are (N − I0)(1 − (1 − p)^I0): R0 for one case", () => {
    expect(rfValues({ population: 30, r0: 2 }).expected_1).toBeCloseTo(2, 6);
    expect(rfValues({ population: 20, p: 0.1, initial: 2 }).expected_1).toBeCloseTo(18 * (1 - 0.81), 6);
  });
  test("minor vs major: the dip splits them; the branching approximation agrees in a large group", () => {
    const v = rfValues({ population: 100, r0: 3 });
    expect(v.p_minor + v.p_major).toBeCloseTo(100, 6);
    expect(v.p_minor).toBeCloseTo(v.p_minor_bp, 0);
    expect(v.mean_major).toBeGreaterThan(90);
    const mid = rfValues({ population: 30, r0: 2 });
    expect(mid.p_minor).toBeGreaterThan(15);
    expect(mid.p_minor).toBeLessThan(30);
    expect(mid.cutoff).toBeGreaterThan(1);
    // Below threshold nothing takes off.
    expect(rfValues({ population: 60, r0: 0.8 }).p_major).toBe(0);
  });
  test("the simulated runs are the seed's: the same seed the same runs, another seed others", () => {
    const run = (seed: number) => scenes.reed_frost.layout!({ population: 30, r0: 2, seed }).drawables.filter((d) => d.id.startsWith("run_")).map((d) => JSON.stringify((d as { pts: Pt[] }).pts));
    expect(run(1)).toEqual(run(1));
    expect(run(2)).not.toEqual(run(1));
    const v = rfValues({ population: 30, r0: 2, runs: 12 });
    expect(v.runs_major + v.runs_minor).toBe(12);
  });
  test("a larger p only ever infects more of the same people (coupled draws)", () => {
    const finals = (p: number) => {
      const out = scenes.reed_frost.layout!({ population: 40, p, seed: 3, runs: 20, generations: 40 });
      return out.drawables.filter((d) => d.id.startsWith("run_")).map((d) => (d as { pts: Pt[] }).pts.at(-1)![1]);
    };
    const lo = finals(0.03), hi = finals(0.06);
    // Not a theorem run by run (fewer susceptibles later), but in sum.
    expect(hi.reduce((a, b) => a + b, 0)).toBeGreaterThan(lo.reduce((a, b) => a + b, 0));
  });
  test("every manifest example lays out clean", () => {
    for (const ex of scenes.reed_frost.manifest.examples) {
      const out = page("reed_frost", ex.params);
      expect(out.warnings, ex.request).toEqual([]);
      expect(out.issues.map((i) => `${i.rule}: ${i.message}`), ex.request).toEqual([]);
    }
  });
  test("lint: p outside 0–1, both p and r0, an r0 the group cannot hold, too many first cases", () => {
    const lint = (p: P) => scenes.reed_frost.lint!(p).map((i) => `${i.severity}: ${i.message}`);
    expect(lint({ p: 1.2 })[0]).toMatch(/^error: p is a probability/);
    expect(lint({ p: 0.1, r0: 2 })[0]).toMatch(/^warn: give p or r0/);
    expect(lint({ population: 5, r0: 6 })[0]).toMatch(/^error: r0 6 in a group of 5/);
    expect(lint({ population: 5, initial: 5 })[0]).toMatch(/^error: initial/);
    expect(lint({ population: 30, r0: 2 })).toEqual([]);
  });
});

describe("reed_frost: the widget", () => {
  const T = "reed_frost";
  test("N, p and R0 scrub; R0 sets p = R0/(N − 1); the generation axis holds while pressed", () => {
    const G = rfValues({ population: 30, p: 0.07 }).generations;
    expect(scrub(T, { population: 30, p: 0.07 }, "n_value", 20)).toEqual({ population: 35, generations: G });
    expect(scrub(T, { population: 30, p: 0.07 }, "p_value", 8)).toEqual({ p: 0.08, generations: G });
    expect(scrub(T, { population: 30, p: 0.03 }, "p_value", 8)).toEqual({ p: 0.032, generations: rfValues({ population: 30, p: 0.03 }).generations });
    const r = scrub(T, { population: 30, r0: 2 }, "r0_value", 40) as { p: number };
    expect(r.p * 29).toBeCloseTo(3, 4);
  });
  test("typed numbers: N whole, p as typed, R0 through p", () => {
    expect(runWidget(scenes[T], { population: 30 }, [inputEvent("n_value", 12)]).params.population).toBe(12);
    expect(runWidget(scenes[T], { population: 30 }, [inputEvent("p_value", 0.123)]).params.p).toBe(0.123);
    expect(runWidget(scenes[T], { population: 21 }, [inputEvent("r0_value", 2)]).params.p).toBe(0.1);
  });
  test("a tap on new runs draws the next seed's outbreaks", () => {
    const run = runWidget(scenes[T], { population: 30, r0: 2, seed: 4 }, ["rerun", "rerun"]);
    expect(run.errors).toEqual([]);
    expect(run.params.seed).toBe(6);
    expect(scenes[T].widget!().taps).toEqual(["rerun"]);
  });
  test("the host: a tap on new runs is the body's click (a live body's other taps pass on)", () => {
    const params = { population: 30, r0: 2 };
    const spec = { template: T, params, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const previews: P[] = [];
    let painted: ReturnType<typeof layoutSpec> | null = null;
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: P) => {
        painted = layoutSpec({ ...spec, params: { ...params, ...o } } as unknown as RenderHandle["spec"]);
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
    const sc = sceneOf(T, params);
    const button = centre(sc, "rerun");
    expect(host.press(button)).toBe(true);
    expect(host.release(button)).toBe("click");
    expect(previews.at(-1)).toMatchObject({ seed: 2 });
    // A tap on a number is its field, not a click.
    const n = centre(sc, "n_value");
    expect(host.press(n)).toBe(true);
    expect(host.release(n)).toBe("edit");
  });
  test("free play only: no ask binds to it", () => {
    expect(scenes[T].manifest.widget).toBeUndefined();
    const spec = { template: T, params: {}, commands: [{ ask: { question: "How many?", answer: "x", widget: T } }] } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "widget").map((i) => i.message).join()).toMatch(/free play only/);
  });
});
