import { describe, expect, test } from "vitest";
import { parseControls, type ControlSpec } from "../src/code/controls";
import { DEMO_MAX_STEPS, RUN_MAX_STEPS, SMOOTH_MIN_STEPS, demoWalk, expandSeries, lcg, runValues, stableHash } from "../src/render/sweep";

const CODE = 'beta = (0.1, 1.0, 0.05)\nmodel = ["SIR", "SEIR", "SIS"]\nlog = False\nname = "x"\ndays = 30\ngo = Button("Go")';
const NAMES = ["beta", "model", "log", "name", "days", "go"];
const controls = (): ControlSpec[] => parseControls("python", CODE, NAMES).controls;
const byName = (n: string) => controls().find((c) => c.name === n)!;

describe("stableHash / lcg", () => {
  test("stable and distinct", () => {
    expect(stableHash("sim:beta,gamma")).toBe(stableHash("sim:beta,gamma"));
    expect(stableHash("sim:beta,gamma")).not.toBe(stableHash("sim:gamma,beta"));
  });
  test("lcg is a deterministic stream in [0,1)", () => {
    const a = lcg(7), b = lcg(7);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe("expandSeries", () => {
  test("a bare value is a series of one; a list is itself", () => {
    expect(expandSeries(byName("beta"), 0.3)).toEqual([0.3]);
    expect(expandSeries(byName("model"), ["SIR", "SEIR"])).toEqual(["SIR", "SEIR"]);
  });
  // A range GLIDES unless told not to (see the smooth block below), so the
  // linear contract is now pinned with smooth: false — the same values the
  // author wrote down, in the count they wrote them in.
  test("smooth: false is linear, snapped to the slider's step, clamped", () => {
    expect(expandSeries(byName("beta"), { from: 0.1, to: 0.9, steps: 5 }, { smooth: false })).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(expandSeries(byName("beta"), { from: 0, to: 2, steps: 2 }, { smooth: false })).toEqual([0.1, 1]);
    expect(expandSeries(byName("beta"), { from: 0.1, to: 0.9, steps: 1 }, { smooth: false })).toEqual([0.1]);
  });
});

describe("smooth sweeps", () => {
  const gaps = (vs: number[]) => vs.slice(1).map((v, i) => Number((v - vs[i]).toFixed(6)));
  test("a range glides by default: densified to at least 10, eased, ends exact", () => {
    const vs = runValues({ values: { beta: { from: 0.1, to: 1.0, steps: 5 } } }, controls()).steps.map((s) => s.beta as number);
    expect(vs.length).toBeGreaterThanOrEqual(SMOOTH_MIN_STEPS);
    expect(vs[0]).toBe(0.1);
    expect(vs[vs.length - 1]).toBe(1);
    // Monotone, and eased: the ends crawl, the middle strides.
    expect(gaps(vs).every((g) => g >= 0)).toBe(true);
    const g = gaps(vs);
    expect(g[0]).toBeLessThan(g[Math.floor(g.length / 2)]);
  });
  // The glide has to MOVE at every step: a duplicate is a frame that shows
  // the viewer nothing new, and a jump three grid stops wide is the stutter
  // the round set out to remove. Both are properties of smoothstep spaced
  // against this slider's own grid (0.1…1.0 by 0.05).
  test("the glide never stands still and never lurches: no consecutive duplicates, no jump over 0.15", () => {
    const vs = runValues({ values: { beta: { from: 0.1, to: 1.0, steps: 5 } } }, controls()).steps.map((s) => s.beta as number);
    expect(gaps(vs).filter((g) => g === 0)).toEqual([]);
    expect(Math.max(...gaps(vs))).toBeLessThanOrEqual(0.15);
  });
  // A range only four grid stops wide HAS no ten distinct positions, so the
  // glide takes every stop the slider owns and no more — which is why this
  // comes back as the 5 grid points rather than ten values with duplicates
  // among them.
  test("a narrow range is capped by the slider's grid: 0.1…0.3 by 0.05 glides through all 5 grid points", () => {
    const vs = runValues({ values: { beta: { from: 0.1, to: 0.3, steps: 3 } } }, controls()).steps.map((s) => s.beta);
    expect(vs).toEqual([0.1, 0.15, 0.2, 0.25, 0.3]);
  });
  test("smooth: false keeps exactly the authored linear steps", () => {
    const vs = runValues({ values: { beta: { from: 0.1, to: 1.0, steps: 5 } }, smooth: false }, controls()).steps.map((s) => s.beta);
    expect(vs).toEqual([0.1, 0.35, 0.55, 0.8, 1]);
  });
  test("the glide never spends more than the run's own ceiling: loop 3 gets floor(20 / 3) per pass", () => {
    const { steps, issues } = runValues({ values: { beta: { from: 0.1, to: 1.0, steps: 5 } }, loop: 3 }, controls());
    expect(issues).toEqual([]);
    expect(steps).toHaveLength(Math.floor(RUN_MAX_STEPS / 3) * 3);
    expect(steps.length / 3).toBe(6);
  });
  test("a list is never densified", () => {
    const vs = runValues({ values: { beta: [0.2, 0.4, 0.6] } }, controls()).steps.map((s) => s.beta);
    expect(vs).toEqual([0.2, 0.4, 0.6]);
    expect(runValues({ values: { model: ["SIR", "SEIR"] } }, controls()).steps).toHaveLength(2);
  });
  // The one that would have come apart: a densified range would walk ten
  // positions while the three-item list sat on "SIS" for seven of them.
  test("a range paired with an explicit list does not glide at all — the two stay in step", () => {
    const { steps, issues } = runValues({ values: { beta: { from: 0.1, to: 0.9, steps: 3 }, model: ["SIR", "SEIR", "SIS"] } }, controls());
    expect(issues).toEqual([]);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.model)).toEqual(["SIR", "SEIR", "SIS"]);
    expect(steps.map((s) => s.beta)).toEqual([0.1, 0.5, 0.9]);
  });
  test("authored reports the count the author wrote, not the glide's", () => {
    expect(runValues({ values: { beta: { from: 0.1, to: 1.0, steps: 5 } } }, controls()).authored).toBe(5);
    expect(runValues({ values: { beta: [0.2, 0.4, 0.6], model: ["SEIR"] } }, controls()).authored).toBe(3);
    expect(runValues({ values: { beta: 0.3 } }, controls()).authored).toBe(1);
  });
});

describe("runValues", () => {
  test("the longest series sets the count; shorter ones hold their last; unnamed controls keep their default", () => {
    const { steps, issues } = runValues({ values: { beta: [0.2, 0.4, 0.6], model: ["SEIR"], log: true } }, controls());
    expect(issues).toEqual([]);
    expect(steps.map((s) => s.beta)).toEqual([0.2, 0.4, 0.6]);
    expect(steps.map((s) => s.model)).toEqual(["SEIR", "SEIR", "SEIR"]);
    expect(steps.map((s) => s.log)).toEqual([true, true, true]);
    expect(steps.map((s) => s.days)).toEqual([30, 30, 30]);
    expect(steps.map((s) => s.name)).toEqual(["x", "x", "x"]);
  });
  test("loop repeats the series", () => {
    const { steps } = runValues({ values: { beta: [0.2, 0.4] }, loop: 2 }, controls());
    expect(steps.map((s) => s.beta)).toEqual([0.2, 0.4, 0.2, 0.4]);
  });
  test("issues: unknown name, bad choice, non-boolean toggle, steps < 1, too many steps, empty values", () => {
    expect(runValues({ values: { gamma: 1 } }, controls()).issues[0]).toMatch(/gamma/);
    expect(runValues({ values: { model: ["SIRS"] } }, controls()).issues[0]).toMatch(/SIRS/);
    expect(runValues({ values: { log: "yes" } }, controls()).issues[0]).toMatch(/log/);
    expect(runValues({ values: { beta: { from: 0.1, to: 0.9, steps: 0 } } }, controls()).issues[0]).toMatch(/steps/);
    expect(runValues({ values: { beta: { from: 0.1, to: 0.9, steps: 11 } }, loop: 2 }, controls()).issues[0]).toMatch(new RegExp(String(RUN_MAX_STEPS)));
    expect(runValues({ values: {} }, controls()).issues[0]).toMatch(/values/);
  });
  test("an empty list series names no step", () => {
    const { steps, issues } = runValues({ values: { model: [] } }, controls());
    expect(issues[0]).toMatch(/model/);
    expect(steps).toEqual([]);
  });
});

describe("demoWalk", () => {
  test("deterministic for an id, at most DEMO_MAX_STEPS + the return to defaults, one control per step", () => {
    const a = demoWalk("sim", controls()), b = demoWalk("sim", controls());
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(DEMO_MAX_STEPS + 1);
    const defaults = Object.fromEntries(controls().map((c) => [c.name, c.default]));
    expect(a[a.length - 1]).toEqual(defaults);
    // each step changes exactly one control relative to the previous map
    let prev = defaults;
    for (const step of a.slice(0, -1)) {
      const changed = Object.keys(step).filter((k) => step[k] !== prev[k]);
      expect(changed.length).toBe(1);
      prev = step;
    }
  });
  test("a different id walks differently; text/number/button never move", () => {
    const a = demoWalk("sim", controls()), b = demoWalk("other", controls());
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    for (const step of [...a, ...b]) {
      expect(step.name).toBe("x");
      expect(step.days).toBe(30);
      expect(step.go).toBe(byName("go").default);
    }
  });
  test("slider points sit near a quarter and three quarters, snapped; a choice moves to the next option; a toggle flips", () => {
    const walk = demoWalk("sim", controls());
    const betas = new Set(walk.map((s) => s.beta).filter((v) => v !== byName("beta").default));
    for (const v of betas) expect([0.3, 0.35, 0.75, 0.8]).toContain(v); // ¼ of 0.1..1.0 = 0.325 → 0.3/0.35; ¾ = 0.775 → 0.75/0.8
    expect(walk.some((s) => s.model === "SEIR")).toBe(true);
    expect(walk.some((s) => s.log === true)).toBe(true);
  });
  test("no controls → an empty walk", () => {
    expect(demoWalk("sim", [])).toEqual([]);
  });
});
