// des_process burstiness (2026-09-29): `variability` (the gaps' — or the
// service times' — coefficient of variation, a gamma renewal process with
// its mean kept), `schedule` (an arrival rate that changes over the run,
// gaps drawn in operational time), `batch` (groups arriving together). The
// moments of what the engine draws, counts per period, group sizes,
// determinism per seed; the theory's ca²; the figure's readout and strip;
// the scrub; the movie; and that a spec without them runs as before.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { gammaInv, gammaP, readModel, readSchedule, type DesParams } from "../src/scenes/des_process/model";
import { arrivalCv2, simulate, stationStats, stationTheory, trafficRates } from "../src/scenes/des_process/engine";
import { layoutDes } from "../src/scenes/des_process/layout";
import { lintDes } from "../src/scenes/des_process/lint";
import { dragPatch, tapPatch } from "../src/scenes/des_process/widget";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import type { WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec } from "../src/layout/layout";
import type { Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import type { RenderHandle } from "../src/render";

const module = scenes["des_process"];
const asRec = (p: DesParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: DesParams) => layoutSpec({ template: "des_process", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: DesParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};

const queue = (source: Record<string, unknown>, extra: Partial<DesParams> = {}, station: Record<string, unknown> = {}): DesParams => ({
  nodes: [
    { id: "door", type: "source", ...source } as never,
    { id: "desk", type: "station", servers: 1, service: 1, ...station } as never,
    { id: "out", type: "sink" },
  ],
  horizon: 120,
  ...extra,
});

/** The gaps between successive births of a run. */
const gaps = (P: DesParams): number[] => {
  const run = simulate(readModel(P), { maxEntities: 1e7 });
  const b = Array.from(run.births);
  return b.slice(1).map((t, i) => t - b[i]);
};
const moments = (xs: number[]): { mean: number; cv: number } => {
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
  const v = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length;
  return { mean, cv: Math.sqrt(v) / mean };
};

describe("the gamma distribution", () => {
  test("its inverse CDF inverts its CDF, down to shape 1/16 (cv 4)", () => {
    for (const a of [0.0625, 0.25, 0.5, 1, 4, 25])
      for (const p of [1e-6, 0.01, 0.3, 0.5, 0.9, 0.999]) {
        const x = gammaInv(a, p);
        expect(Math.abs(gammaP(a, x) - p)).toBeLessThan(1e-7 * Math.max(1, p * 10));
      }
    expect(gammaP(1, 2)).toBeCloseTo(1 - Math.exp(-2), 12); // shape 1 is the exponential
  });

  test("variability sets the gaps' cv and keeps their mean (cv 0, 0.5, 1, 2)", () => {
    for (const cv of [0, 0.5, 1, 2]) {
      const g = moments(gaps(queue({ rate: 0.5, variability: cv }, { horizon: 40000, seed: 7 })));
      expect(Math.abs(g.mean - 2) / 2).toBeLessThan(cv >= 2 ? 0.04 : 0.02);
      expect(Math.abs(g.cv - cv)).toBeLessThan(cv >= 2 ? 0.12 : 0.03);
    }
  });

  test("cv 1 is the very run `rate` alone makes; cv 0 is `every`", () => {
    const plain = simulate(readModel(queue({ rate: 0.8 }, { seed: 3 })));
    const one = simulate(readModel(queue({ rate: 0.8, variability: 1 }, { seed: 3 })));
    expect(Array.from(one.births)).toEqual(Array.from(plain.births));
    const zero = simulate(readModel(queue({ rate: 0.5, variability: 0 })));
    const every = simulate(readModel(queue({ every: 2 })));
    expect(Array.from(zero.births)).toEqual(Array.from(every.births));
  });

  test("a station's variability sets its service times' cv, the mean kept", () => {
    const m = readModel(queue({ rate: 0.1 }, { horizon: 50000, seed: 2 }, { service: 3, variability: 0.5 }));
    expect(m.nodes[1].service).toMatchObject({ kind: "gamma", mean: 3, cv2: 0.25 });
    const run = simulate(m, { maxEntities: 1e7 });
    const times = run.entities.flatMap((e) => e.visits.filter((v) => v.node === 1 && v.end < Infinity).map((v) => v.end - v.start));
    const s = moments(times);
    expect(Math.abs(s.mean - 3) / 3).toBeLessThan(0.03);
    expect(Math.abs(s.cv - 0.5)).toBeLessThan(0.03);
  });

  test("{dist: gamma, mean, cv} is a distribution anywhere one is read", () => {
    const m = readModel(queue({ interarrival: { dist: "gamma", mean: 2, cv: 1.5 } }, {}, { service: { dist: "gamma", mean: 1, cv: 0.3 } }));
    expect(m.nodes[0].inter).toMatchObject({ kind: "gamma", mean: 2 });
    expect(m.nodes[0].inter!.cv2).toBeCloseTo(2.25, 12);
    expect(m.nodes[1].service!.cv2).toBeCloseTo(0.09, 12);
  });

  test("the same seed is the same run; a new seed another", () => {
    const P = queue({ rate: 0.6, variability: 2, batch: { mean: 2 } }, { seed: 11 });
    const a = simulate(readModel(P)),
      b = simulate(readModel(P)),
      c = simulate(readModel({ ...P, seed: 12 }));
    expect(Array.from(a.births)).toEqual(Array.from(b.births));
    expect(Array.from(a.births)).not.toEqual(Array.from(c.births));
  });
});

describe("a schedule", () => {
  const SCHED = { times: [0, 120, 240, 360], rates: [0.1, 0.3, 0.2, 0.1] };
  test("the counts per period follow its rates (and compose with variability)", () => {
    for (const variability of [undefined, 0, 2]) {
      const counts = [0, 0, 0, 0];
      const reps = 30;
      for (let seed = 1; seed <= reps; seed++) {
        const run = simulate(readModel(queue({ schedule: SCHED, ...(variability !== undefined ? { variability } : {}) }, { horizon: 480, seed })));
        for (const t of run.births) counts[Math.min(3, Math.floor(t / 120))]++;
      }
      const per = counts.map((c) => c / reps / 120);
      SCHED.rates.forEach((r, i) => expect(Math.abs(per[i] - r) / r, `period ${i}, cv ${variability}`).toBeLessThan(variability === 2 ? 0.2 : 0.09)); // cv 0: the 12th of period 0 lands on its boundary
    }
  });

  test("Λ and its inverse, stepped and smooth; a zero-rate stretch has no arrivals", () => {
    const s = readSchedule({ times: [0, 10, 20], rates: [1, 0, 2] })!;
    expect(s.cum(10)).toBe(10);
    expect(s.cum(15)).toBe(10);
    expect(s.cum(25)).toBe(20);
    expect(s.inv(5)).toBe(5);
    expect(s.inv(12)).toBe(21);
    const sm = readSchedule({ times: [0, 10], rates: [0, 2], shape: "smooth" })!;
    expect(sm.rate(5)).toBe(1);
    expect(sm.cum(10)).toBeCloseTo(10, 12);
    for (const t of [0.5, 3, 7, 9.9, 14]) expect(sm.inv(sm.cum(t))).toBeCloseTo(t, 9);
    const run = simulate(readModel(queue({ schedule: { times: [0, 40, 80], rates: [1, 0, 1] } })));
    expect(Array.from(run.births).filter((t) => t > 40.5 && t < 80).length).toBe(0);
  });

  test("the theory is for the average rate, and says so", () => {
    const m = readModel(queue({ schedule: SCHED }, { horizon: 480 }, { service: 3 }));
    const th = stationTheory(m, 1)!;
    expect(th.lambda).toBeCloseTo((0.1 + 0.3 + 0.2 + 0.1) / 4, 12);
    expect(th.scheduled).toBe(true);
    expect(th.exact).toBe(false);
    const L = layoutDes({ ...queue({ schedule: SCHED }, { horizon: 480, chart: ["queue", "wait_util"] }, { service: 3 }) });
    expect(L.values!.wq_theory).toBeUndefined();
    expect(L.order).toContain("schedule_door");
  });
});

describe("batches", () => {
  test("fixed groups: every birth time is shared by exactly that many; the rate still counts entities", () => {
    const run = simulate(readModel(queue({ rate: 0.6, batch: 3 }, { horizon: 20000, seed: 4 })), { maxEntities: 1e7 });
    const by = new Map<number, number>();
    for (const t of run.births) by.set(t, (by.get(t) ?? 0) + 1);
    expect(new Set(by.values())).toEqual(new Set([3]));
    expect(Math.abs(run.births.length / 20000 - 0.6) / 0.6).toBeLessThan(0.03);
    expect(trafficRates(readModel(queue({ rate: 0.6, batch: 3 })))[0]).toBeCloseTo(0.6, 12);
  });

  test("{mean}: geometric sizes with that mean", () => {
    const run = simulate(readModel(queue({ rate: 1, batch: { mean: 2.5 } }, { horizon: 40000, seed: 9 })), { maxEntities: 1e7 });
    const by = new Map<number, number>();
    for (const t of run.births) by.set(t, (by.get(t) ?? 0) + 1);
    const sizes = [...by.values()];
    const mean = sizes.reduce((a, x) => a + x, 0) / sizes.length;
    expect(Math.abs(mean - 2.5) / 2.5).toBeLessThan(0.03);
    // Geometric: P(1) = 1/b.
    expect(Math.abs(sizes.filter((k) => k === 1).length / sizes.length - 0.4)).toBeLessThan(0.02);
  });

  test("ca² grows with the group: b·c² fixed, b·c² + b − 1 geometric; the theory follows the run", () => {
    expect(arrivalCv2(readModel(queue({ rate: 0.5, batch: 3 })).nodes[0])).toBe(3);
    expect(arrivalCv2(readModel(queue({ rate: 0.5, batch: { mean: 2 } })).nodes[0])).toBe(3);
    expect(arrivalCv2(readModel(queue({ rate: 0.5, variability: 0, batch: 2 })).nodes[0])).toBe(0);
    const P = queue({ rate: 0.6, batch: 2 }, { horizon: 100000, warmup: 1000, seed: 5 });
    const m = readModel(P);
    const th = stationTheory(m, 1)!;
    const st = stationStats(simulate(m, { maxEntities: 1e7 }), 1, m.horizon)!;
    expect(th.ca2).toBe(2);
    expect(th.exact).toBe(false);
    // Allen–Cunneen, an approximation: within a fifth of the run here.
    expect(Math.abs(st.wait - th.wq) / st.wait).toBeLessThan(0.2);
  });
});

describe("the theory with burstier arrivals", () => {
  test("the wait climbs with variability at the same average: the run and the curve agree on the order", () => {
    const wait = (cv: number) => {
      const m = readModel(queue({ rate: 0.8, variability: cv }, { horizon: 100000, warmup: 1000, seed: 6 }));
      return { sim: stationStats(simulate(m, { maxEntities: 1e7 }), 1, m.horizon)!.wait, th: stationTheory(m, 1)! };
    };
    const [a, b, c] = [0.5, 1, 2].map(wait);
    expect(a.sim).toBeLessThan(b.sim);
    expect(b.sim).toBeLessThan(c.sim);
    expect(a.th.ca2).toBeCloseTo(0.25, 12);
    expect(c.th.ca2).toBeCloseTo(4, 12);
    expect(b.th.exact).toBe(true); // cv 1 is Poisson: M/M/1 exactly
    // G/M/1 with gamma gaps: Allen–Cunneen within a quarter of the long run.
    for (const w of [a, c]) expect(Math.abs(w.sim - w.th.wq) / w.sim).toBeLessThan(0.25);
  });
});

describe("the figure and the viewer", () => {
  test("no burstiness field: no CV readout, no strip — the figure as before", () => {
    const L = layoutDes(queue({ rate: 0.8 }));
    expect(L.order.some((id) => /^var_|^schedule_|^batch_/.test(id))).toBe(false);
  });

  test("variability set: a CV readout on the source and on a station; a batch says its groups", () => {
    const L = layoutDes(queue({ rate: 0.5, variability: 1.5, batch: { mean: 2 } }, {}, { variability: 0.5 }));
    expect(L.order).toContain("var_door");
    expect(L.order).toContain("var_desk");
    expect(L.order).toContain("batch_door");
    expect(lintDes(queue({ rate: 0.5, variability: 1.5, batch: { mean: 2 } }, {}, { variability: 0.5 }))).toEqual([]);
  });

  test("scrub the CV sideways; tap types it", () => {
    const P = queue({ rate: 0.5, variability: 1 }, { t: 120 });
    const sc = sceneOf(P);
    const at = centre(sc, "var_door");
    const r = dragPatch("var_door", at, [at[0] + 5 * STEP_UNITS, at[1]], sc)!;
    expect((r.patch.nodes as { variability: number }[])[0].variability).toBeCloseTo(1.5, 9);
    const down = dragPatch("var_door", at, [at[0] - 30 * STEP_UNITS, at[1]], sc)!;
    expect((down.patch.nodes as { variability: number }[])[0].variability).toBe(0);
    const body = module.widget!();
    expect(body.editable!("var_door", [0, 0], sc)).toMatchObject({ value: 1, min: 0 });
    const typed = body.on({ type: "input", id: "var_door", value: 2, point: [0, 0] }, body.init(sc), sc);
    expect(((typed.effects as { patch: { nodes: { variability: number }[] } }[])[0].patch.nodes)[0].variability).toBe(2);
    expect(tapPatch("var_door", P)).toBeNull();
  });

  test("a schedule's rate scrubs as a whole (its peak moves, its shape stays)", () => {
    const P = queue({ schedule: { times: [0, 60], rates: [0.2, 0.4] } }, { t: 60 });
    const sc = sceneOf(P);
    const at = centre(sc, "rate_door");
    const r = dragPatch("rate_door", at, [at[0] + 10 * STEP_UNITS, at[1]], sc)!;
    const s = (r.patch.nodes as { schedule: { rates: number[] } }[])[0].schedule;
    expect(s.rates[1]).toBeCloseTo(0.45, 9); // steps of 0.005 on the peak
    expect(s.rates[0]).toBeCloseTo(0.225, 9);
  });

  test("animate nodes.0.variability: the plan tweens it, and the wait climbs", () => {
    const P = queue({ rate: 0.8, variability: 0 }, { horizon: 400, t: 400, seed: 2 });
    const spec = { template: "des_process", params: P, commands: [{ animate: { "nodes.0.variability": 2 }, duration: 4 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(P) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts).toEqual({ "nodes.0.variability": 0 });
    const at = (v: number) => layoutDes(withOverrides(asRec(P), { "nodes.0.variability": v }) as DesParams).values!;
    expect(at(2).avg_queue).toBeGreaterThan(at(0).avg_queue);
    expect(at(1).avg_queue).toBeGreaterThan(at(0).avg_queue);
  });

  test("lint: a schedule that does not pair up, a variability or batch out of range", () => {
    expect(lintDes(queue({ schedule: { times: [0, 60], rates: [0.2] } })).some((i) => /schedule/.test(i.message))).toBe(true);
    expect(lintDes(queue({ rate: 0.5, variability: 9 })).some((i) => /variability/.test(i.message))).toBe(true);
    expect(lintDes(queue({ rate: 0.5, batch: 0 })).some((i) => /batch/.test(i.message))).toBe(true);
    expect(lintDes(queue({ schedule: { times: [0, 60, 120], rates: [0.2, 0.5, 0.3] } }))).toEqual([]);
  });
});
