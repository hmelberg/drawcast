// des_process (2026-09-28): a discrete event simulation of a queue or process
// network. The engine against queueing theory (M/M/1, M/M/c by Erlang C,
// M/D/1 by Pollaczek–Khinchine, Little's law), determinism per seed, the
// disciplines; the figure's ids and values; the paused viewer's gestures;
// the movie; the lint; speed.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { catalogParts } from "../src/scenes/catalog";
import { readModel, type DesParams } from "../src/scenes/des_process/model";
import { Calendar, erlangC, mulberry32, simulate, stationStats, stationTheory, systemStats, tokensAt, trafficRates, waitApprox } from "../src/scenes/des_process/engine";
import { layoutDes, runOf } from "../src/scenes/des_process/layout";
import { lintDes } from "../src/scenes/des_process/lint";
import { dragPatch, setShare, tapPatch, timeAtPoint } from "../src/scenes/des_process/widget";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { SURFACE_PART, type WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Drawable, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import type { RenderHandle } from "../src/render";

const module = scenes["des_process"];
const asRec = (p: DesParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: DesParams) => layoutSpec({ template: "des_process", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: DesParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const patchOf = (r: { effects: unknown }): Record<string, unknown> => (r.effects as { patch: Record<string, unknown> }[])[0]?.patch;

/** One station, Poisson arrivals at rate λ, c servers, exponential service of mean s. */
const mmc = (lambda: number, s: number, c = 1, extra: Partial<DesParams> = {}): DesParams => ({
  nodes: [
    { id: "arrive", type: "source", rate: lambda },
    { id: "desk", type: "station", servers: c, service: s },
    { id: "leave", type: "sink" },
  ],
  horizon: 120,
  ...extra,
});

const ED: DesParams = {
  entity: "patient",
  nodes: [
    { id: "door", type: "source", rate: 0.5 },
    { id: "triage", type: "station", servers: 1, service: { dist: "triangular", min: 1, mode: 1.5, max: 3 }, to: { xray: 0.3, doctor: 0.7 } },
    { id: "xray", type: "station", label: "X-ray", servers: 1, service: 5, to: "doctor" },
    { id: "doctor", type: "station", servers: 2, service: 3.5 },
    { id: "home", type: "sink" },
  ],
  horizon: 240,
  warmup: 30,
  t: 240,
  chart: { of: "queue", station: "doctor" },
};

describe("the engine", () => {
  test("the calendar pops in time order, ties in the order they were scheduled", () => {
    const c = new Calendar();
    const times = [5, 1, 3, 3, 0.5, 9, 3, 2];
    times.forEach((t, i) => c.push(t, 0, i, 0));
    const out: [number, number][] = [];
    while (c.size > 0) {
      const [t, , node] = c.pop();
      out.push([t, node]);
    }
    expect(out).toEqual([[0.5, 4], [1, 1], [2, 7], [3, 2], [3, 3], [3, 6], [5, 0], [9, 5]]);
  });

  test("the PRNG is seeded: the same seed, the same stream; uniform on [0, 1)", () => {
    const a = mulberry32(42),
      b = mulberry32(42),
      c = mulberry32(43);
    const xs = Array.from({ length: 5000 }, () => a());
    expect(Array.from({ length: 5000 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  test("M/M/1: utilisation → ρ and the mean wait → Wq = ρ/(μ − λ) over a long run", () => {
    for (const [lambda, rhoTol, wqTol] of [
      [0.5, 0.01, 0.05],
      [0.8, 0.015, 0.1],
    ]) {
      const m = readModel(mmc(lambda, 1, 1, { horizon: 100000, warmup: 1000, seed: 3 }));
      const run = simulate(m, { maxEntities: 1e7 });
      const st = stationStats(run, 1, m.horizon)!;
      const th = stationTheory(m, 1)!;
      const wq = lambda / (1 - lambda); // ρ/(μ−λ) with μ = 1
      expect(th.rho).toBeCloseTo(lambda, 12);
      expect(th.wq).toBeCloseTo(wq, 12);
      expect(th.exact).toBe(true);
      expect(Math.abs(st.util - lambda)).toBeLessThan(rhoTol);
      expect(Math.abs(st.wait - wq) / wq).toBeLessThan(wqTol);
    }
  });

  test("M/M/c: the mean wait matches Erlang C (c = 2 and c = 3)", () => {
    // Erlang C by hand for c = 2, a = 1.6: C = (a²/2)/(1−ρ) / (1 + a + (a²/2)/(1−ρ)).
    const a = 1.6,
      rho = 0.8;
    const top = (a * a) / 2 / (1 - rho);
    expect(erlangC(2, a)).toBeCloseTo(top / (1 + a + top), 12);
    for (const [lambda, c] of [
      [1.6, 2],
      [2.5, 3],
    ]) {
      const m = readModel(mmc(lambda, 1, c, { horizon: 60000, warmup: 1000, seed: 5 }));
      const run = simulate(m, { maxEntities: 1e7 });
      const st = stationStats(run, 1, m.horizon)!;
      const th = stationTheory(m, 1)!;
      expect(th.wq).toBeCloseTo(erlangC(c, lambda) / (c - lambda), 12);
      expect(Math.abs(st.util - lambda / c)).toBeLessThan(0.02);
      expect(Math.abs(st.wait - th.wq) / th.wq).toBeLessThan(0.1);
    }
  });

  test("M/D/1: a fixed service time halves the M/M/1 wait (Pollaczek–Khinchine), and the theory says it is exact", () => {
    const P: DesParams = { ...mmc(0.8, 1, 1, { horizon: 60000, warmup: 1000, seed: 9 }), nodes: [{ id: "a", type: "source", rate: 0.8 }, { id: "d", type: "station", service: { dist: "fixed", value: 1 } }, { id: "z", type: "sink" }] };
    const m = readModel(P);
    const th = stationTheory(m, 1)!;
    expect(th.exact).toBe(true);
    expect(th.wq).toBeCloseTo(0.8 / (2 * 0.2), 12);
    const st = stationStats(simulate(m, { maxEntities: 1e7 }), 1, m.horizon)!;
    expect(Math.abs(st.wait - th.wq) / th.wq).toBeLessThan(0.08);
    expect(waitApprox(1, 0.8, 1, 1, 0)).toBeCloseTo(2, 12);
  });

  test("Little's law: the time-average number in the system = λ × the mean time in it", () => {
    for (const P of [mmc(0.8, 1, 1, { horizon: 20000, warmup: 500 }), { ...ED, horizon: 20000, warmup: 500 }]) {
      const m = readModel(P);
      const run = simulate(m, { maxEntities: 1e7 });
      const s = systemStats(run, m.horizon);
      expect(Math.abs(s.L - s.lambda * s.W) / s.L).toBeLessThan(0.02);
    }
  });

  test("the traffic equations: λ at each node of the emergency department (and a rework loop)", () => {
    const r = trafficRates(readModel(ED));
    expect(r[1]).toBeCloseTo(0.5, 12); // triage
    expect(r[2]).toBeCloseTo(0.15, 12); // x-ray
    expect(r[3]).toBeCloseTo(0.5, 12); // doctor: everyone
    const loop = readModel({ nodes: [{ id: "a", type: "source", rate: 1 }, { id: "s", type: "station", service: 0.5, to: { s2: 1 } }, { id: "s2", type: "station", service: 0.2, to: { s: 0.2, z: 0.8 } }, { id: "z", type: "sink" }] });
    expect(trafficRates(loop)[1]).toBeCloseTo(1.25, 9); // λ = 1/(1 − 0.2)
  });

  test("deterministic per seed: the same params give the same run; another seed another", () => {
    const a = simulate(readModel({ ...ED, seed: 7 }));
    const b = simulate(readModel({ ...ED, seed: 7 }));
    const c = simulate(readModel({ ...ED, seed: 8 }));
    const log = (r: ReturnType<typeof simulate>) => JSON.stringify(r.entities.map((e) => e.visits.map((v) => [v.node, v.arrive, v.start, v.end])));
    expect(log(a)).toBe(log(b));
    expect(log(a)).not.toBe(log(c));
  });

  test("priority: the urgent class waits less at a priority station; capacity turns arrivals away and never lets more wait", () => {
    const P: DesParams = {
      nodes: [
        { id: "urgent", type: "source", rate: 0.3, priority: 1, to: "doc" },
        { id: "routine", type: "source", rate: 0.6, priority: 2, to: "doc" },
        { id: "doc", type: "station", service: 1, discipline: "priority" },
        { id: "out", type: "sink" },
      ],
      horizon: 20000,
      warmup: 200,
    };
    const run = simulate(readModel(P), { maxEntities: 1e7 });
    const mean = (p: number) => {
      const ws = run.entities.filter((e) => e.priority === p && e.visits[0]?.start < Infinity).map((e) => e.visits[0].start - e.visits[0].arrive);
      return ws.reduce((a, b) => a + b, 0) / ws.length;
    };
    expect(mean(1)).toBeLessThan(mean(2) / 3);
    const capped = simulate(readModel(mmc(1.5, 1, 1, { horizon: 500, nodes: [{ id: "a", type: "source", rate: 1.5 }, { id: "s", type: "station", service: 1, capacity: 3 }, { id: "z", type: "sink" }] })));
    const st = stationStats(capped, 1, 500)!;
    expect(st.balked).toBeGreaterThan(50);
    const log = capped.stations.get(1)!;
    expect(Math.max(...log.queue.values)).toBeLessThanOrEqual(3);
  });

  test("tokens at t: a lane's tokens are the waiting in queue order, a server holds one, a journey is on an arrow", () => {
    const run = runOf({ ...ED, t: 120 });
    const tk = tokensAt(run, 120);
    const st = stationStats(run, 1, 120)!;
    const waiting = tk.filter((x) => x.where === "wait" && x.node === 1);
    const onWay = tk.filter((x) => x.where === "transit" && x.to === 1).length;
    expect(waiting.length + onWay).toBeGreaterThanOrEqual(st.queue);
    expect(waiting.map((w) => (w as { rank: number }).rank)).toEqual(waiting.map((_, i) => i));
    expect(tk.filter((x) => x.where === "service" && x.node === 3).length).toBeLessThanOrEqual(2);
    for (const x of tk) if (x.where === "transit") expect(x.frac).toBeGreaterThanOrEqual(0);
  });

  test("fast: a typical model re-simulates in well under 10 ms, and reading it at t is a cache hit", () => {
    const P: DesParams = { ...ED, horizon: 480 }; // ~240 patients through four stations
    simulate(readModel(P)); // warm
    const n = 20;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) simulate(readModel({ ...P, seed: i + 1 }));
    const sim = (performance.now() - t0) / n;
    layoutDes({ ...P, t: 1 });
    const t1 = performance.now();
    for (let i = 0; i < n; i++) layoutDes({ ...P, t: 10 + i * 20 });
    const frame = (performance.now() - t1) / n;
    console.log(`des_process: re-sim ${sim.toFixed(2)} ms (${runOf(P).entities.length} entities), layout at t ${frame.toFixed(2)} ms per frame`);
    expect(sim).toBeLessThan(10);
    expect(frame).toBeLessThan(15);
  });
});

describe("the figure", () => {
  test("a built-in with a lint, a live body, no ask flag — and the catalog offers it", () => {
    expect(module.layout && module.widget && module.lint).toBeTruthy();
    expect(module.manifest.widget).toBeUndefined();
    const { stable } = catalogParts({ request: "simulate a queue at a checkout" });
    expect(stable).toContain("des_process");
  });

  test("every manifest example lays out clean, with no lint at all", () => {
    for (const ex of module.manifest.examples) {
      const res = layoutSpec({ template: "des_process", params: ex.params, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues, ex.request).toEqual([]);
      expect(lintDes(ex.params as DesParams), ex.request).toEqual([]);
    }
  });

  test("ids: nodes, lanes, servers, routes with their shares, readouts, the clock, the chart and its cursor; the sets", () => {
    const l = layoutDes(ED);
    expect(l.order).toEqual(
      expect.arrayContaining([
        "node_door",
        "label_door",
        "rate_door",
        "queue_triage",
        "server_triage",
        "service_triage",
        "readout_triage",
        "add_doctor",
        "remove_doctor",
        "route_door_triage",
        "route_triage_xray",
        "share_triage_xray",
        "share_triage_doctor",
        "node_home",
        "clock",
        "reroll",
        "axes",
        "chart_line",
        "cursor",
        "warmup",
      ]),
    );
    expect(l.groups!.node_triage).toEqual(expect.arrayContaining(["queue_triage", "server_triage", "label_triage", "service_triage", "readout_triage"]));
    expect(l.groups!.chart).toEqual(expect.arrayContaining(["axes", "chart_line", "cursor"]));
    expect(l.groups!.routes).toContain("share_triage_xray");
    // The doctor's two servers are two boxes.
    const server = flattenDrawables(l.drawables).filter((d) => /^server_doctor__box\d$/.test(d.id));
    expect(server).toHaveLength(2);
    // A second chart's ids end _2.
    const two = layoutDes({ ...mmc(0.8, 1), chart: ["queue", "wait_util"] });
    expect(two.order).toEqual(expect.arrayContaining(["axes_2", "theory_curve_2", "sim_dot_2", "theory_dot_2", "legend_2", "cursor"]));
    expect(two.groups!.chart_2).toContain("theory_curve_2");
  });

  test("values: the clock, the counts, each station's numbers and M/M/c theory", () => {
    const v = layoutDes({ ...mmc(0.8, 1, 1), horizon: 200, t: 150 }).values!;
    expect(v.t).toBe(150);
    expect(v.arrivals).toBeGreaterThan(80);
    expect(v.in_system).toBe(v.arrivals - v.departures);
    for (const k of ["desk_queue", "desk_busy", "desk_util", "desk_wait", "desk_throughput", "desk_served", "desk_rho", "desk_wq_theory", "queue", "util", "wait", "rho", "wq_theory", "leave_done", "L", "W"]) expect(v, k).toHaveProperty(k);
    expect(v.rho).toBe(0.8);
    expect(v.wq_theory).toBe(4);
    expect(v.util).toBeGreaterThan(40);
    expect(v.util).toBeLessThanOrEqual(100);
    // The ED's triage is M/G/1 (Poisson in, triangular service): exact. Its
    // doctors are fed by triage's triangular departures: no exact theory, so
    // no wq_theory — though ρ still is what it is.
    const e = layoutDes(ED).values!;
    expect(e.triage_rho).toBeCloseTo(0.5 * (11 / 6), 3);
    expect(e).toHaveProperty("triage_wq_theory");
    expect(e).not.toHaveProperty("doctor_wq_theory");
    expect(e.doctor_rho).toBeCloseTo((0.5 * 3.5) / 2, 3);
    // A token of text reads them.
    const res = layoutSpec({ template: "des_process", params: mmc(0.8, 1, 1, { t: 60 }), elements: [{ id: "note", type: "text", text: "ρ = {des.rho}", at: [500, 40] }] } as never);
    const note = flattenDrawables(res.drawables).find((d) => d.id === "note") as { text: string } | undefined;
    expect(note?.text).toContain("0.8");
  });

  test("the picture follows t: tokens wait in the lane, servers are shaded busy, the sink counts", () => {
    const P = { ...mmc(0.95, 1, 1), horizon: 200 };
    const early = flattenDrawables(layoutDes({ ...P, t: 0 }).drawables);
    // A moment late in the run when someone is waiting.
    const tLate = [180, 170, 160, 150, 140, 130, 120, 110, 100].find((t) => layoutDes({ ...P, t }).values!.queue > 1)!;
    const late = flattenDrawables(layoutDes({ ...P, t: tLate }).drawables);
    const count = (ds: Drawable[], re: RegExp) => ds.filter((d) => re.test(d.id)).length;
    expect(count(early, /^queue_desk__tok/)).toBe(0);
    expect(count(late, /^queue_desk__tok/) + count(late, /^queue_desk__more/)).toBeGreaterThan(0);
    const sinkText = (ds: Drawable[]) => (ds.find((d) => d.id === "node_leave__count") as { text: string }).text;
    expect(sinkText(early)).toBe("0");
    expect(Number(sinkText(late))).toBeGreaterThan(100);
    const clock = late.find((d) => d.id === "clock") as { text: string };
    expect(clock.text).toBe(`t = ${tLate} min`);
  });

  test("lint-clean across times and shapes (the words stand clear)", () => {
    for (const t of [0, 30, 90, 150, 240])
      for (const P of [
        { ...ED, t },
        { ...mmc(0.9, 1, 1), t: Math.min(t, 120), chart: ["queue", "wait_util"] as DesParams["chart"] },
        { ...mmc(1.6, 1, 2), t: Math.min(t, 120), chart: "wait" as const },
      ]) {
        const res = layoutSpec({ template: "des_process", params: P, elements: [] } as never);
        expect(res.issues.map((i) => i.message), JSON.stringify({ t, n: P.nodes!.length })).toEqual([]);
      }
  });

  test("the lint: unknown refs, shares ≠ 1, no sink, utilisation ≥ 1, too many entities", () => {
    expect(lintDes({ nodes: [] })[0].severity).toBe("error");
    const bad = lintDes({ nodes: [{ id: "a", type: "source", rate: 1, to: "nowhere" }, { id: "z", type: "sink" }] });
    expect(bad.some((i) => i.severity === "error" && /"nowhere", which is not a node/.test(i.message))).toBe(true);
    const shares = lintDes({ nodes: [{ id: "a", type: "source", rate: 1 }, { id: "s", type: "station", service: 0.5, to: { z: 0.5, y: 0.3 } }, { id: "y", type: "sink" }, { id: "z", type: "sink" }] });
    expect(shares.some((i) => i.severity === "error" && /add up to 0.8/.test(i.message))).toBe(true);
    expect(lintDes({ nodes: [{ id: "a", type: "source", rate: 1 }, { id: "s", type: "station", service: 0.5 }] }).some((i) => /no sink/.test(i.message))).toBe(true);
    const hot = lintDes(mmc(1.1, 1));
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({ severity: "warn" });
    expect(hot[0].message).toMatch(/110% utilised.*grows without bound/);
    expect(lintDes(mmc(2, 0.1, 1, { horizon: 5000 })).some((i) => /stops making them at 3000/.test(i.message))).toBe(true);
    expect(lintDes(mmc(0.8, 1))).toEqual([]);
    expect(lintDes(ED)).toEqual([]);
  });
});

describe("the paused viewer", () => {
  test("the clock scrubs time; the cursor and the chart's paper set it where the pointer is", () => {
    const P: DesParams = { ...mmc(0.8, 1), t: 60 };
    const sc = sceneOf(P);
    const c = centre(sc, "clock");
    const r = dragPatch("clock", c, [c[0] + 10 * STEP_UNITS, c[1]], sc)!;
    expect(r.patch.t).toBe(60 + 10 * 2); // steps of ~1 % of 120, rounded 1-2-5: 2
    const at = sc.toLogical([90, 1]);
    expect(dragPatch("cursor", centre(sc, "cursor"), at, sc)!.patch.t).toBeCloseTo(90, 0);
    expect(dragPatch(SURFACE_PART, at, sc.toLogical([30, 2]), sc)!.patch.t).toBeCloseTo(30, 0);
    expect(timeAtPoint(sc, P, sc.toLogical([500, 0]))).toBe(120); // clamped to the run
    const body = module.widget!();
    expect(body.surface!(sc)).not.toBeNull();
  });

  test("scrub a rate, a service time, a share (the other share makes room); tap ⊕ ⊖ and new run", () => {
    const sc = sceneOf(ED);
    const rate = centre(sc, "rate_door");
    const r = dragPatch("rate_door", rate, [rate[0] + 5 * STEP_UNITS, rate[1]], sc)!;
    expect((r.patch.nodes as { rate: number }[])[0].rate).toBeCloseTo(0.525, 9); // steps of 0.005
    const sv = centre(sc, "service_doctor");
    const s = dragPatch("service_doctor", sv, [sv[0] - 10 * STEP_UNITS, sv[1]], sc)!;
    expect((s.patch.nodes as { service: number }[])[3].service).toBeCloseTo(3.5 - 10 * 0.05, 9);
    // A triangular service scales as a whole: its mean moves, its shape stays.
    const tr = centre(sc, "service_triage");
    const t2 = dragPatch("service_triage", tr, [tr[0] + 3 * STEP_UNITS, tr[1]], sc)!;
    const tri = (t2.patch.nodes as { service: { min: number; mode: number; max: number } }[])[1].service;
    expect((tri.min + tri.mode + tri.max) / 3).toBeCloseTo(1.9, 2); // 1.83 + 3 steps of 0.02, on the step grid
    const sh = centre(sc, "share_triage_xray");
    const p = dragPatch("share_triage_xray", sh, [sh[0] + 20 * STEP_UNITS, sh[1]], sc)!;
    expect((p.patch.nodes as { to: Record<string, number> }[])[1].to).toEqual({ xray: 0.5, doctor: 0.5 });
    expect(setShare(ED, "triage", "doctor", 0.9)![1].to).toEqual({ xray: 0.1, doctor: 0.9 });
    expect((tapPatch("add_doctor", ED)!.patch.nodes as { servers: number }[])[3].servers).toBe(3);
    expect((tapPatch("remove_doctor", ED)!.patch.nodes as { servers: number }[])[3].servers).toBe(1);
    expect(tapPatch("remove_triage", ED)).toBeNull(); // never below one
    expect(tapPatch("reroll", ED)!.patch.seed).toBe(2);
  });

  test("the body: taps, typed numbers, captions, and the Reset pill", () => {
    const sc = sceneOf(ED);
    const body = module.widget!();
    const state = body.init(sc);
    expect(body.taps!("add_triage", sc)).toBe(true);
    expect(body.taps!("clock", sc)).toBe(false);
    const add = body.on({ type: "click", id: "add_triage", point: centre(sc, "add_triage"), domain: null }, state, sc);
    expect((patchOf(add).nodes as { servers: number }[])[1].servers).toBe(2);
    expect((add.effects as { caption?: string }[]).some((e) => e.caption === "One more server")).toBe(true);
    expect(body.editable!("rate_door", [0, 0], sc)).toMatchObject({ value: 0.5 });
    expect(body.editable!("share_triage_xray", [0, 0], sc)).toMatchObject({ value: 30, min: 0, max: 100 });
    expect(body.editable!("clock", [0, 0], sc)).toMatchObject({ value: 240, min: 0, max: 240 });
    expect(body.editable!("node_door", [0, 0], sc)).toBeNull();
    const typed = body.on({ type: "input", id: "service_xray", value: 8, point: [0, 0] }, state, sc);
    expect((patchOf(typed).nodes as { service: number }[])[2].service).toBe(8);
    const share = body.on({ type: "input", id: "share_triage_doctor", value: 40, point: [0, 0] }, state, sc);
    expect((patchOf(share).nodes as { to: Record<string, number> }[])[1].to).toEqual({ xray: 0.6, doctor: 0.4 });
    // Reset: nothing to reset until the process changes; time alone is not the process.
    expect(body.rest!(sc, state)).toBeNull();
    expect(body.rest!(sceneOf({ ...ED, t: 10 }), state)).toBeNull();
    const changed = sceneOf({ ...ED, seed: 4 });
    expect(body.rest!(changed, state)).toMatchObject({ seed: undefined, nodes: ED.nodes });
  });

  test("the host: a tap on ⊕ adds a server, a drag on the cursor moves time live, a tap on the rate types", () => {
    const P: DesParams = { ...ED, t: 120 };
    const spec = { template: "des_process", params: P, commands: [] } as unknown as RenderHandle["spec"];
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
    const plus = centre(sc, "add_doctor");
    expect(host.press(plus)).toBe(true);
    expect(host.release(plus)).toBe("click");
    expect((current.nodes as { servers: number }[])[3].servers).toBe(3);
    const knob = centre(sc, "cursor");
    expect(host.press(knob)).toBe(true);
    const to = sc.toLogical([60, 3]);
    host.move(to);
    expect(host.release(to)).toBe("drag");
    expect(current.t as number).toBeCloseTo(60, 0);
    const rate = centre(sceneOf({ ...P, ...current } as DesParams), "rate_door");
    expect(host.press(rate)).toBe(true);
    expect(host.release(rate)).toBe("edit");
    expect(host.commitEdit("0.7")).toEqual({ ok: true });
    expect((current.nodes as { rate: number }[])[0].rate).toBe(0.7);
  });
});

describe("the movie", () => {
  test("animate t: the tokens flow — the plan tweens t, and each frame reads the same run", () => {
    const P: DesParams = { ...mmc(0.8, 1), t: 0 };
    const spec = { template: "des_process", params: P, commands: [{ animate: { t: 120 }, duration: 8 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(P) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null>; targets: Record<string, number> };
    expect(step.starts).toEqual({ t: 0 });
    expect(step.targets).toEqual({ t: 120 });
    const at = (t: number) => layoutDes(withOverrides(asRec(P), { t }) as DesParams);
    const a = at(40),
      b = at(40.5);
    expect(runOf({ ...P, t: 40 })).toBe(runOf({ ...P, t: 40.5 })); // one run, read twice
    expect(a.values!.t).toBe(40);
    expect(b.values!.arrivals).toBeGreaterThanOrEqual(a.values!.arrivals);
    // Stable part ids across frames: nothing is minted as time runs.
    for (const t of [0, 20, 60, 100, 120]) expect(at(t).order.filter((id) => !/^(chart_line|cursor)$/.test(id))).toEqual(at(0).order.filter((id) => !/^(chart_line|cursor)$/.test(id)));
    const cursorX = (l: ReturnType<typeof at>) => l.anchors.cursor[0];
    expect(cursorX(at(100))).toBeGreaterThan(cursorX(at(20)));
  });

  test("animate the arrival rate at the horizon: the queue grows as utilisation nears 1", () => {
    const P: DesParams = { ...mmc(0.5, 1, 1), horizon: 400, t: 400 };
    const spec = { template: "des_process", params: P, commands: [{ animate: { "nodes.0.rate": 0.95 }, duration: 6 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(P) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts).toEqual({ "nodes.0.rate": 0.5 });
    const at = (r: number) => layoutDes(withOverrides(asRec(P), { "nodes.0.rate": r }) as DesParams).values!;
    const w = [0.5, 0.7, 0.85, 0.95].map((r) => at(r));
    for (let i = 1; i < w.length; i++) {
      expect(w[i].rho).toBeGreaterThan(w[i - 1].rho);
      expect(w[i].wq_theory).toBeGreaterThan(w[i - 1].wq_theory);
    }
    expect(w[3].wait).toBeGreaterThan(3 * w[0].wait);
    expect(w[3].avg_queue).toBeGreaterThan(3 * w[0].avg_queue);
  });
});
