// des_hta (2026-09-28): an individual patient-level discrete event
// simulation for HTA. The engine against analytic answers and against a
// Markov cohort, its determinism and common random numbers, the discounting
// arithmetic, the ICER's words; the figure's ids and values; the paused
// viewer's gestures; the movie; the lint; the speed.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { catalogParts } from "../src/scenes/catalog";
import { discounted, factor, simulate, simulateParams, uniform } from "../src/scenes/des_hta/engine";
import { exponential, gompertz, lawOf, piecewise, readModel, weibull, type HtaParams } from "../src/scenes/des_hta/model";
import { layoutDesHta, shownResults, timeSpans } from "../src/scenes/des_hta/layout";
import { lintDesHta } from "../src/scenes/des_hta/lint";
import { HR_STEP, timeAtPoint } from "../src/scenes/des_hta/widget";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { SURFACE_PART, type WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import type { RenderHandle } from "../src/render";

const module = scenes["des_hta"];
const asRec = (p: HtaParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: HtaParams) => layoutSpec({ template: "des_hta", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: HtaParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const patchOf = (r: { effects: unknown }): Record<string, unknown> => (r.effects as { patch: Record<string, unknown> }[])[0]?.patch;

/** The illness–death model with exponential hazards: PF → P (a), PF → D (b), P → D (c). */
const RATES = { a: 0.3, b: 0.05, c: 0.4 };
function illnessDeath(over: Partial<HtaParams> = {}): HtaParams {
  return {
    states: [{ name: "Progression-free", utility: 0.8, cost: 1000 }, { name: "Progressed", utility: 0.5, cost: 5000 }, { name: "Dead" }],
    events: [
      { from: "Progression-free", to: "Progressed", name: "progression", rate: RATES.a },
      { from: "Progression-free", to: "Dead", name: "death", rate: RATES.b },
      { from: "Progressed", to: "Dead", name: "death after progression", rate: RATES.c },
    ],
    strategies: [{ name: "Standard care" }, { name: "New drug", hr: { progression: 0.6 }, cost: 10000, until: "Progressed" }],
    horizon: 60,
    patients: 5000,
    discount: 0,
    ...over,
  };
}
const ONC: HtaParams = module.manifest.examples[0].params as unknown as HtaParams;

const mean = (xs: ArrayLike<number>): number => Array.from(xs).reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: ArrayLike<number>): number => {
  const m = mean(xs);
  const v = Array.from(xs).reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
};

describe("the engine", () => {
  test("uniforms: in (0, 1), a pure function of their key, and uniform enough (mean ½, variance 1/12)", () => {
    expect(uniform(7, 3, 2, 1)).toBe(uniform(7, 3, 2, 1));
    expect(uniform(7, 3, 2, 1)).not.toBe(uniform(7, 3, 2, 2));
    const us = Array.from({ length: 20000 }, (_, i) => uniform(1, i, 0, 0));
    for (const u of us) expect(u > 0 && u < 1).toBe(true);
    expect(mean(us)).toBeCloseTo(0.5, 2);
    expect(us.reduce((a, u) => a + (u - 0.5) ** 2, 0) / us.length).toBeCloseTo(1 / 12, 2);
  });

  test("laws: H and its inverse agree for every distribution; a Weibull's median is its median", () => {
    for (const law of [exponential(0.3), weibull(1.7, 4), weibull(0.6, 2), gompertz(0.02, 0.1), piecewise([0.1, 0.5, 0.2], [2, 5])]) {
      for (const t of [0.1, 1, 3.7, 9]) expect(law.Hinv(law.H(t))).toBeCloseTo(t, 9);
    }
    const w = lawOf({ from: "A", to: "B", dist: "weibull", shape: 1.6, median: 1.5 });
    expect(typeof w).not.toBe("string");
    expect((w as ReturnType<typeof weibull>).Hinv(Math.LN2)).toBeCloseTo(1.5, 9);
    expect(lawOf({ from: "A", to: "B", dist: "weibull", median: 2 })).toMatch(/shape/);
    expect(lawOf({ from: "A", to: "B", dist: "piecewise", rates: [0.1, 0.2], times: [] })).toMatch(/1 times/);
  });

  test("exponential hazards, no discounting: mean time in each state matches the analytic value", () => {
    const sim = simulateParams(illnessDeath())!;
    const [arm] = sim.arms;
    const { a, b, c } = RATES;
    // Restricted to the 60-year horizon (the remainder is < 1e-8 here).
    const pf = 1 / (a + b);
    const prog = (a / (a + b)) * (1 / c);
    const pfSe = se(Array.from({ length: 1 }, () => 0)) || 0.02;
    expect(Math.abs(arm.timeIn[0] - pf)).toBeLessThan(4 * (pf / Math.sqrt(5000)) + 1e-9);
    expect(Math.abs(arm.timeIn[1] - prog)).toBeLessThan(0.08);
    expect(Math.abs(arm.ly - (pf + prog))).toBeLessThan(0.1);
    // QALYs and costs are the times weighted.
    expect(arm.qalys).toBeCloseTo(0.8 * arm.timeIn[0] + 0.5 * arm.timeIn[1], 9);
    expect(arm.cost).toBeCloseTo(1000 * arm.timeIn[0] + 5000 * arm.timeIn[1], 6);
    // The intervention: progression's hazard × 0.6 while on treatment (until Progressed).
    const [, b2] = sim.arms;
    const pf2 = 1 / (0.6 * a + b);
    const prog2 = ((0.6 * a) / (0.6 * a + b)) * (1 / c);
    expect(Math.abs(b2.timeIn[0] - pf2)).toBeLessThan(4 * (pf2 / Math.sqrt(5000)));
    expect(Math.abs(b2.timeIn[1] - prog2)).toBeLessThan(0.08);
    // Treatment is paid for only while progression-free.
    expect(b2.cost).toBeCloseTo(11000 * b2.timeIn[0] + 5000 * b2.timeIn[1], 6);
    void pfSe;
  });

  test("the DES agrees with an equivalent Markov cohort (fine cycles), costs and QALYs discounted", () => {
    const P = illnessDeath({ discount: 0.035, horizon: 20, patients: 5000 });
    const sim = simulateParams(P)!;
    // Markov cohort, dt = 1/200 year: competing exponential exits per cycle, mid-cycle accrual, continuous discounting.
    const dt = 1 / 200;
    const d = Math.log(1.035);
    const cohort = (hr: number, drug: number) => {
      const { a, b, c } = RATES;
      let pf = 1, pr = 0, q = 0, cost = 0;
      const out = 1 - Math.exp(-(hr * a + b) * dt);
      const toP = out * ((hr * a) / (hr * a + b));
      const pd = 1 - Math.exp(-c * dt);
      for (let k = 0; k < 20 / dt; k++) {
        const npf = pf * (1 - out), npr = pr * (1 - pd) + pf * toP;
        const mpf = (pf + npf) / 2, mpr = (pr + npr) / 2;
        const w = Math.exp(-d * (k + 0.5) * dt) * dt;
        q += (0.8 * mpf + 0.5 * mpr) * w;
        cost += ((1000 + drug) * mpf + 5000 * mpr) * w;
        pf = npf;
        pr = npr;
      }
      return { q, cost };
    };
    const ma = cohort(1, 0), mb = cohort(0.6, 10000);
    const [A, B] = sim.arms;
    expect(Math.abs(A.qalys - ma.q)).toBeLessThan(3 * se(A.perQaly));
    expect(Math.abs(A.cost - ma.cost)).toBeLessThan(3 * se(A.perCost));
    expect(Math.abs(B.qalys - mb.q)).toBeLessThan(3 * se(B.perQaly));
    expect(Math.abs(B.cost - mb.cost)).toBeLessThan(3 * se(B.perCost));
    // The increment too — with common random numbers its noise is the paired difference's.
    const dq = Array.from(B.perQaly, (v, i) => v - A.perQaly[i]);
    expect(Math.abs(B.qalys - A.qalys - (mb.q - ma.q))).toBeLessThan(3 * se(dq));
  });

  test("deterministic: the same params give the same patients; another seed gives others", () => {
    const m = readModel(illnessDeath({ patients: 500 }))!;
    const r1 = simulate(m), r2 = simulate(m);
    expect(Array.from(r1.arms[0].perQaly)).toEqual(Array.from(r2.arms[0].perQaly));
    expect(r1.arms[1].paths).toEqual(r2.arms[1].paths);
    const r3 = simulate({ ...m, seed: 2 });
    expect(r3.arms[0].qalys).not.toBe(r1.arms[0].qalys);
  });

  test("common random numbers: the same patients under both strategies — a hazard ratio < 1 only ever delays progression", () => {
    const sim = simulateParams(illnessDeath({ patients: 400 }))!;
    const [A, B] = sim.arms;
    for (let i = 0; i < A.paths.length; i++) {
      const pa = A.paths[i].stays[0], pb = B.paths[i].stays[0];
      // Same death draw from PF (the drug does not touch it); progression later.
      expect(pb.t1).toBeGreaterThanOrEqual(pa.t1 - 1e-12);
    }
  });

  test("common random numbers cut the incremental estimate's variance across seeds (vs independent streams)", () => {
    const spread = (crn: boolean): number => {
      const ds: number[] = [];
      for (let s = 1; s <= 30; s++) {
        const sim = simulateParams(illnessDeath({ patients: 300, seed: s, crn, horizon: 20, discount: 0.035 }))!;
        ds.push(sim.arms[1].qalys - sim.arms[0].qalys);
      }
      const m = mean(ds);
      return ds.reduce((a, d) => a + (d - m) ** 2, 0) / (ds.length - 1);
    };
    const vc = spread(true), vi = spread(false);
    console.log(`des_hta: var(ΔQALY) over 30 seeds — CRN ${vc.toExponential(2)}, independent ${vi.toExponential(2)} (×${(vi / vc).toFixed(1)})`);
    expect(vc).toBeLessThan(vi / 4);
  });

  test("discounting: the exact integral over a sojourn; a patient alive all horizon gets u·∫e^(−δt)dt", () => {
    const r = 0.035, d = Math.log(1.035);
    expect(discounted(0, 1, 0)).toBe(1);
    expect(discounted(2, 5, r)).toBeCloseTo((Math.exp(-2 * d) - Math.exp(-5 * d)) / d, 12);
    // Numerically: midpoint rule over 100k slices.
    let s = 0;
    for (let k = 0; k < 100000; k++) s += Math.exp(-d * (2 + ((k + 0.5) * 3) / 100000)) * (3 / 100000);
    expect(discounted(2, 5, r)).toBeCloseTo(s, 8);
    expect(factor(1, r)).toBeCloseTo(1 / 1.035, 12);
    // Nobody leaves (a vanishing rate): QALYs = 0.8 × the discounted horizon, cost likewise — exactly.
    const P: HtaParams = {
      states: [{ name: "Well", utility: 0.8, cost: 1000 }, { name: "Dead" }],
      events: [{ from: "Well", to: "Dead", rate: 1e-12 }],
      strategies: [{ name: "A" }, { name: "B", cost: 500 }],
      horizon: 10,
      patients: 50,
      discount: { costs: 0.035, qalys: 0.015 },
    };
    const sim = simulateParams(P)!;
    expect(sim.arms[0].qalys).toBeCloseTo(0.8 * discounted(0, 10, 0.015), 9);
    expect(sim.arms[0].cost).toBeCloseTo(1000 * discounted(0, 10, 0.035), 6);
    expect(sim.arms[1].cost).toBeCloseTo(1500 * discounted(0, 10, 0.035), 6);
    // A one-off event cost is discounted at its time.
    const ae: HtaParams = { ...P, states: [{ name: "Well" }, { name: "Dead" }], events: [{ from: "Well", to: "Dead", rate: 1e-12 }, { from: "Well", to: "Well", name: "AE", rate: 0.5, cost: 100 }], discount: 0 };
    const s2 = simulateParams({ ...ae, patients: 4000 })!;
    expect(s2.arms[0].counts[1]).toBeCloseTo(5, 0); // 0.5 a year for 10 years
    expect(s2.arms[0].cost).toBeCloseTo(100 * s2.arms[0].counts[1], 6);
  });

  test("Weibull with the state clock: the time since progression, not since the start, drives death after progression", () => {
    const P: HtaParams = {
      states: [{ name: "PF" }, { name: "P" }, { name: "Dead" }],
      events: [
        { from: "PF", to: "P", rate: 0.5 },
        { from: "P", to: "Dead", dist: "weibull", shape: 2, median: 1.5 },
      ],
      strategies: [{ name: "A" }, { name: "B" }],
      horizon: 40,
      patients: 4000,
      discount: 0,
    };
    const arm = simulateParams(P)!.arms[0];
    // Mean of a Weibull(k, λ) is λ Γ(1 + 1/k); for k = 2, λ √π / 2.
    const lam = 1.5 / Math.sqrt(Math.LN2);
    expect(Math.abs(arm.timeIn[1] - (lam * Math.sqrt(Math.PI)) / 2)).toBeLessThan(0.05);
    // With the model clock, a late progressor dies sooner after it: the time in P shrinks.
    const armM = simulateParams({ ...P, events: [P.events[0], { ...P.events[1], clock: "model" }] })!.arms[0];
    expect(armM.timeIn[1]).toBeLessThan(arm.timeIn[1] - 0.2);
  });

  test("background mortality and a risk factor shorten life; occupancy sums to 1 at every time", () => {
    const base = illnessDeath({ patients: 2000, horizon: 40 });
    const a = simulateParams(base)!.arms[0];
    const bg = simulateParams({ ...base, background: true, age: 70 })!.arms[0];
    const rk = simulateParams({ ...base, risk: { share: 0.5, hr: 2 } })!.arms[0];
    expect(bg.ly).toBeLessThan(a.ly);
    expect(rk.ly).toBeLessThan(a.ly);
    for (let k = 0; k < a.occ[0].length; k += 10) expect(a.occ[0][k] + a.occ[1][k] + a.occ[2][k]).toBeCloseTo(1, 9);
  });
});

describe("the results", () => {
  test("the shown numbers agree with each other: differences of the shown values", () => {
    const sim = simulateParams(ONC)!;
    const s = shownResults(sim);
    expect(s.dcost).toBe(s.cost[1] - s.cost[0]);
    expect(s.dqaly).toBeCloseTo(s.qalys[1] - s.qalys[0], 9);
    expect(s.icer).not.toBeNull();
    expect(s.icer! % 100).toBe(0);
    const v = layoutDesHta(ONC).values!;
    expect(v.dcost).toBe(v.cost_b - v.cost_a);
    expect(v.dqaly).toBeCloseTo(v.qalys_b - v.qalys_a, 9);
    expect(v.icer).toBe(s.icer);
  });
  test("ICER wording: dominant, dominated, fewer for less", () => {
    const say = (P: HtaParams) => shownResults(simulateParams(P)!);
    const P = illnessDeath({ patients: 300 });
    expect(say({ ...P, strategies: [{ name: "Costly care", cost: 8000 }, { name: "Cheap cure", hr: 0.5 }] }).verdict).toMatch(/^Dominant/);
    expect(say({ ...P, strategies: [P.strategies[0], { name: "Harm", hr: { progression: 2 }, cost: 100 }] }).verdict).toMatch(/^Dominated/);
    expect(say({ ...P, strategies: [{ name: "A", cost: 5000 }, { name: "B", hr: { progression: 1.5 } }] }).verdict).toMatch(/^Fewer QALYs for less/);
    const ok = say(P);
    expect(ok.verdict).toBeNull();
    expect(ok.icer).toBeGreaterThan(0);
  });
});

describe("the figure", () => {
  test("a built-in with a lint, a live body, no ask flag — and the catalog offers it", () => {
    expect(module.layout && module.widget && module.lint).toBeTruthy();
    expect(module.manifest.widget).toBeUndefined();
    const { stable } = catalogParts({ request: "discrete event simulation of patients" });
    expect(stable).toContain("des_hta");
  });
  test("every manifest example lays out clean in every view, with no lint at all", () => {
    for (const ex of module.manifest.examples) {
      expect(lintDesHta(ex.params as unknown as HtaParams), ex.request).toEqual([]);
      for (const view of ["timelines", "curves", "results", "diagram", "overview"]) {
        for (const t of [undefined, 0, 4]) {
          const params = { ...ex.params, view, ...(t !== undefined ? { t } : {}) };
          const res = layoutSpec({ template: "des_hta", params, elements: [] } as never);
          expect(res.warnings, `${ex.request} ${view} ${t}`).toEqual([]);
          expect(res.issues.map((i) => i.message), `${ex.request} ${view} ${t}`).toEqual([]);
        }
      }
    }
  });
  test("the top strip is left for a card heading: no view inks above y 680, and a card's lint finds nothing", () => {
    for (const view of ["timelines", "curves", "results", "diagram", "overview"] as const) {
      for (const ex of module.manifest.examples) {
        const l = layoutDesHta({ ...(ex.params as unknown as HtaParams), view, t: 3 });
        const ys = flattenDrawables(l.drawables).flatMap((d) => ("pts" in d ? (d as { pts: Pt[] }).pts.map((p) => p[1]) : d.kind === "text" ? [(d as unknown as { pos: Pt }).pos[1] + 12] : []));
        expect(Math.max(...ys), view).toBeLessThanOrEqual(680);
      }
    }
    const spec = { template: "des_hta", params: ONC, commands: [{ card: { title: "Discrete event simulation" } }, { draw: ["model"], speak: "Why simulate patients one by one?" }] };
    const res = layoutSpec(spec as never);
    expect(res.issues.filter((i) => i.rule === "heading-intrusion")).toEqual([]);
  });
  test("ids: the timelines (a row per patient per strategy), the header, the controls, the cursor", () => {
    const l = layoutDesHta({ ...ONC, t: 3 });
    expect(l.order).toEqual(expect.arrayContaining(["state_progression_free", "state_label_progressed", "event_0", "event_2", "event_3", "event_mark_3", "lane_1_a", "lane_12_b", "lane_labels", "tl_head_a", "tl_head_b", "tl_axis_a", "tl_mean_b", "knob_hr", "knob_cost", "reseed", "cursor", "cursor_knob"]));
    expect(l.groups!.lanes_a).toHaveLength(12);
    expect(l.groups!.model).toContain("state_dead");
    expect(l.groups!.controls).toEqual(["knob_hr", "knob_cost", "reseed"]);
    // The cursor's line through the intervention's column comes with that column's lanes, not before.
    expect(l.order).toContain("cursor_b");
    expect(l.drawnWith!.lane_1_b).toContain("cursor_b");
    expect(l.groups!.cursors).toEqual(["cursor", "cursor_b", "cursor_knob"]);
    const curves = layoutDesHta({ ...ONC, view: "curves", t: 3 });
    expect(curves.order).toEqual(expect.arrayContaining(["os_a", "os_b", "pfs_a", "pfs_b", "ly_gain", "curve_axes", "key_a", "alive_dot_b", "alive_a"]));
    const res = layoutDesHta({ ...ONC, view: "results", wtp: 30000 });
    expect(res.order).toEqual(expect.arrayContaining(["res_head", "res_a", "res_b", "res_diff", "res_icer", "res_note", "plane_axes", "plane_dots", "plane_mean", "plane_wtp"]));
    const dia = layoutDesHta({ ...ONC, view: "diagram" });
    expect(dia.order).toEqual(expect.arrayContaining(["event_label_0", "event_shape_2", "event_label_3", "state_utility_progressed", "state_cost_progression_free", "strategy_a", "strategy_b"]));
    const ov = layoutDesHta({ ...ONC, view: "overview" });
    expect(ov.groups!.lanes_b).toHaveLength(8);
  });
  test("values: the table's numbers, the curves' at the cursor", () => {
    const v = layoutDesHta({ ...ONC, t: 5 }).values!;
    for (const k of ["cost_a", "cost_b", "qalys_a", "qalys_b", "dcost", "dqaly", "icer", "ly_a", "ly_b", "dly", "os_a", "pfs_a", "pfs_b", "alive_a", "alive_b", "pf_a", "pf_b", "t", "patients", "hr"]) expect(v[k], k).toBeTypeOf("number");
    expect(v.t).toBe(5);
    expect(v.hr).toBe(0.65);
    expect(v.patients).toBe(1000);
    expect(v.alive_b).toBeGreaterThanOrEqual(v.alive_a);
    expect(v.pfs_b).toBeGreaterThan(v.pfs_a);
  });
  test("the cursor fills the timelines in: fewer bars at t = 1 than at the horizon", () => {
    const bars = (t: number | undefined) => flattenDrawables(layoutDesHta({ ...ONC, ...(t !== undefined ? { t } : {}) }).drawables).filter((d) => /^lane_\d+_[ab]__s\d+$/.test(d.id)).length;
    expect(bars(1)).toBeLessThan(bars(undefined));
    expect(bars(0)).toBe(0);
  });
  test("the lint: unknown states, leaving the dead state, bad laws, hr naming no event, horizon too short, too many patients", () => {
    const P = illnessDeath();
    const msgs = (p: HtaParams) => lintDesHta(p).map((i) => i.message).join("\n");
    expect(lintDesHta(P)).toEqual([]);
    expect(msgs({ ...P, events: [...P.events, { from: "Sick", to: "Dead", rate: 0.1 }] })).toMatch(/unknown state "Sick"/);
    expect(msgs({ ...P, events: [...P.events, { from: "Dead", to: "Progressed", rate: 0.1 }] })).toMatch(/absorbing death state/);
    expect(msgs({ ...P, events: [{ ...P.events[0], dist: "weibull", median: 2 }, ...P.events.slice(1)] })).toMatch(/weibull needs shape/);
    expect(msgs({ ...P, events: [{ ...P.events[0], rate: -1 }, ...P.events.slice(1)] })).toMatch(/exponential needs rate/);
    expect(msgs({ ...P, strategies: [P.strategies[0], { name: "X", hr: { progresion: 0.5 } }] })).toMatch(/no event's name/);
    expect(msgs({ ...P, horizon: 0.3 })).toMatch(/is short/);
    expect(msgs({ ...P, patients: 20000 })).toMatch(/at most 5000/);
    expect(msgs({ ...P, strategies: [P.strategies[0]] })).toMatch(/exactly two/);
    expect(lintDesHta({ ...P, patients: 20000 }).find((i) => /5000/.test(i.message))!.severity).toBe("warn");
  });
  test("fast enough to re-simulate every drag frame: 1,000 patients × 2 strategies", () => {
    layoutDesHta(ONC);
    const n = 20;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) layoutDesHta({ ...ONC, strategies: [ONC.strategies[0], { ...ONC.strategies[1], hr: { progression: 0.5 + i * 0.01 } }] });
    const ms = (performance.now() - t0) / n;
    const t1 = performance.now();
    for (let i = 0; i < n; i++) layoutDesHta({ ...ONC, t: i * 0.5 });
    const cached = (performance.now() - t1) / n;
    console.log(`des_hta layout: ${ms.toFixed(2)} ms per re-simulation (1,000 patients × 2), ${cached.toFixed(2)} ms per cursor move (cached)`);
    expect(ms).toBeLessThan(40);
    expect(cached).toBeLessThan(ms);
  });
});

describe("the paused viewer", () => {
  const P: HtaParams = { ...ONC, t: 4 };
  test("the body: scrub the hazard ratio and the drug's cost, type them, tap for new patients", () => {
    const sc = sceneOf(P);
    const body = module.widget!();
    const st = body.init(sc);
    const hr = centre(sc, "knob_hr");
    const r = body.on({ type: "drag_move", id: "knob_hr", from: hr, fromDomain: null, point: [hr[0] + 5 * STEP_UNITS, hr[1]], domain: null }, st, sc);
    const s1 = (patchOf(r).strategies as HtaParams["strategies"])[1];
    expect(s1.hr).toEqual({ progression: Number((0.65 + 5 * HR_STEP).toFixed(2)) });
    const c = centre(sc, "knob_cost");
    const rc = body.on({ type: "drag", id: "knob_cost", to: null, from: c, fromDomain: null, point: [c[0] - 3 * STEP_UNITS, c[1]], domain: null }, st, sc);
    expect((patchOf(rc).strategies as HtaParams["strategies"])[1].cost).toBe(19400);
    expect(body.editable!("knob_hr", hr, sc)).toMatchObject({ value: 0.65, min: 0, max: 3 });
    const typed = body.on({ type: "input", id: "knob_hr", value: 0.4, point: hr }, st, sc);
    expect((patchOf(typed).strategies as HtaParams["strategies"])[1].hr).toEqual({ progression: 0.4 });
    expect(body.taps!("reseed", sc)).toBe(true);
    const re = body.on({ type: "click", id: "reseed", point: centre(sc, "reseed"), domain: null }, st, sc);
    expect(patchOf(re)).toEqual({ seed: 2 });
    // The Reset pill: none while only time has moved; the author's model back once it changed.
    expect(body.rest!(sceneOf({ ...P, t: 9 }), st)).toBeNull();
    const changed = sceneOf({ ...P, ...patchOf(typed), seed: 2 } as HtaParams);
    expect(body.rest!(changed, st)).toEqual({ states: P.states, events: P.events, strategies: P.strategies, seed: undefined });
  });
  test("the time cursor: drag its pill, or anywhere on either column's lanes — the same time on both", () => {
    const sc = sceneOf(P);
    const body = module.widget!();
    const st = body.init(sc);
    const ts = timeSpans(P)!;
    const [a, b] = ts.spans;
    // A point at t = 10 in each column (layout = logical: no fit on this page).
    const inA = sc.toLogical([10, 0.5]);
    const yMid = (a.y0 + a.y1) / 2;
    const bX = b.x0 + (10 / ts.horizon) * (b.x1 - b.x0);
    expect(timeAtPoint(sc, inA)).toBeCloseTo(10, 6);
    expect(timeAtPoint(sc, [bX, yMid])).toBeCloseTo(10, 6);
    const knob = centre(sc, "cursor_knob");
    const r = body.on({ type: "drag_move", id: "cursor_knob", from: knob, fromDomain: sc.toDomain(knob), point: [bX, yMid], domain: sc.toDomain([bX, yMid]) }, st, sc);
    expect(patchOf(r)).toEqual({ t: 10 });
    const s = body.on({ type: "drag_move", id: SURFACE_PART, from: inA, fromDomain: null, point: sc.toLogical([2.5, 0.2]), domain: null }, st, sc);
    expect(patchOf(s)).toEqual({ t: 2.5 });
    const surf = body.surface!(sc)!;
    expect(surf.w).toBeGreaterThan(800);
    // The curves view: its plot is the time axis.
    const cv = sceneOf({ ...P, view: "curves" });
    expect(timeAtPoint(cv, cv.toLogical([7, 0.4]))).toBeCloseTo(7, 6);
  });
  test("the diagram's numbers: a median, a Weibull shape, a state's QALY weight and cost", () => {
    const D = { ...P, view: "diagram" as const };
    const sc = sceneOf(D);
    const body = module.widget!();
    const st = body.init(sc);
    const drag = (id: string, steps: number) => {
      const p = centre(sc, id);
      return patchOf(body.on({ type: "drag_move", id, from: p, fromDomain: null, point: [p[0] + steps * STEP_UNITS, p[1]], domain: null }, st, sc));
    };
    expect((drag("event_label_0", 3).events as HtaParams["events"])[0].median).toBeCloseTo(2.06, 9);
    expect((drag("event_shape_2", -2).events as HtaParams["events"])[2].shape).toBeCloseTo(1.5, 9);
    expect((drag("state_utility_progressed", -5).states as HtaParams["states"])[1].utility).toBeCloseTo(0.55, 9);
    expect((drag("state_cost_progression_free", 2).states as HtaParams["states"])[0].cost).toBe(3100);
    expect(body.editable!("event_label_3", centre(sc, "event_label_3"), sc)).toMatchObject({ value: 0.3 });
  });
  test("the host: a tap on new patients is the body's; a drag of the cursor moves time live; a tap on the HR types", () => {
    const spec = { template: "des_hta", params: P, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    let painted: ReturnType<typeof layoutSpec> | null = null;
    let current: Record<string, unknown> = {};
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: Record<string, unknown>) => {
        current = o;
        painted = layoutSpec({ ...spec, params: { ...P, ...o } } as unknown as RenderHandle["spec"]);
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
    const sc = sceneOf(P);
    const re = centre(sc, "reseed");
    expect(host.press(re)).toBe(true);
    expect(host.release(re)).toBe("click");
    expect(current.seed).toBe(2);
    const knob = centre(sc, "cursor_knob");
    expect(host.press(knob)).toBe(true);
    const to: Pt = [knob[0] + 120, knob[1]];
    host.move(to);
    expect(host.release(to)).toBe("drag");
    expect(current.t as number).toBeGreaterThan(4);
    const hr = centre(sceneOf({ ...P, ...current } as HtaParams), "knob_hr");
    expect(host.press(hr)).toBe(true);
    expect(host.release(hr)).toBe("edit");
    expect(host.commitEdit("0.5")).toEqual({ ok: true });
    expect((current.strategies as HtaParams["strategies"])[1].hr).toEqual({ progression: 0.5 });
  });
});

describe("the movie", () => {
  test("animate t: the cursor sweeps, the bars fill in; animate the hazard ratio: the results move", () => {
    const P0 = { ...ONC, t: 0 };
    const spec = { template: "des_hta", params: P0, commands: [{ animate: { t: 15 }, duration: 5 }, { animate: { "strategies.1.hr.progression": 0.4 }, duration: 3 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(P0) });
    const steps = plan.steps.filter((s) => s.kind === "animate") as { starts: Record<string, number | null> }[];
    expect(steps[0].starts).toEqual({ t: 0 });
    expect(steps[1].starts).toEqual({ "strategies.1.hr.progression": 0.65 });
    const at = (o: Record<string, number>) => layoutDesHta(withOverrides(asRec(P0), o) as unknown as HtaParams);
    expect(at({ t: 3 }).anchors.cursor[0]).toBeLessThan(at({ t: 9 }).anchors.cursor[0]);
    expect(at({ t: 9 }).values!.t).toBe(9);
    const q1 = at({ "strategies.1.hr.progression": 0.65 }).values!.qalys_b;
    const q2 = at({ "strategies.1.hr.progression": 0.4 }).values!.qalys_b;
    expect(q2).toBeGreaterThan(q1);
    // The comparator is the same patients, untouched by the drug's hazard ratio.
    expect(at({ "strategies.1.hr.progression": 0.4 }).values!.qalys_a).toBe(at({ "strategies.1.hr.progression": 0.65 }).values!.qalys_a);
  });
});
