import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { splitVarOverrides } from "../src/render/params";
import { cutTrail } from "../src/render/trails";

const animateStep = (plan: ReturnType<typeof planCommands>, i: number) => plan.steps[i] as Extract<PlanStep, { kind: "animate" }>;

describe("animate on vars", () => {
  test("a bare name that is a var animates it, keyed vars.<name>, starting at the var's value", () => {
    const plan = planCommands([{ animate: { f: 4 }, duration: 3 }], [], { varsBase: { f: 1 }, animateBase: null });
    expect(plan.warnings).toEqual([]);
    const s = animateStep(plan, 0);
    expect(s.targets).toEqual({ "vars.f": 4 });
    expect(s.starts).toEqual({ "vars.f": 1 });
    expect(plan.states[0].params).toEqual({ "vars.f": 4 });
  });
  test("a second animate starts where the first ended; vars.f is accepted as written", () => {
    const plan = planCommands([{ animate: { f: 4 } }, { animate: { "vars.f": 0 } }], [], { varsBase: { f: 1 }, animateBase: null });
    expect(animateStep(plan, 1).starts).toEqual({ "vars.f": 4 });
    expect(plan.states[1].params).toEqual({ "vars.f": 0 });
  });
  test("params first: a name that is both animates the param and warns", () => {
    const plan = planCommands([{ animate: { n: 3 } }], [], { varsBase: { n: 1, f: 0 }, animateBase: { n: 12 } });
    expect(animateStep(plan, 0).targets).toEqual({ n: 3 });
    expect(animateStep(plan, 0).starts).toEqual({ n: 12 });
    expect(plan.warnings).toContain('animate "n" is both a template param and a var — the param is animated');
  });
  test("on a freehand spec with vars, a name that is no var is skipped with a warning; the other keys still animate", () => {
    const plan = planCommands([{ animate: { zz: 1, f: 2 } }], [], { varsBase: { f: 0 }, animateBase: null });
    expect(plan.warnings.some((w) => w.includes('animate "zz": neither a template param nor a var'))).toBe(true);
    expect(animateStep(plan, 0).targets).toEqual({ "vars.f": 2 });
  });
  test("on a template spec an unknown dot path still animates (and jumps), as before", () => {
    const plan = planCommands([{ animate: { "tax.rate": 5 } }], [], { animateBase: { demand_shift: { amount: 0 } } });
    expect(animateStep(plan, 0).targets).toEqual({ "tax.rate": 5 });
    expect(animateStep(plan, 0).starts).toEqual({ "tax.rate": null });
  });
  test("no template and no vars: the warning, and a paired speak survives", () => {
    const plan = planCommands([{ animate: { f: 1 }, speak: "still said" }], [], { animateBase: null });
    expect(plan.warnings).toContain("animate needs a template param or a var (skipped)");
    expect(plan.steps.map((s) => s.kind)).toEqual(["speak"]);
  });
  test("splitVarOverrides moves vars.* keys into vars", () => {
    expect(splitVarOverrides({ "demand_shift.amount": 3, "vars.f": 2 })).toEqual({ params: { "demand_shift.amount": 3 }, vars: { f: 2 } });
  });
  test("cutTrail keeps the leading part by arc length", () => {
    expect(cutTrail([[0, 0], [10, 0], [10, 10]], 0.5)).toEqual([[0, 0], [10, 0]]);
    expect(cutTrail([[0, 0], [10, 0], [10, 10]], 0.75)).toEqual([[0, 0], [10, 0], [10, 5]]);
    expect(cutTrail([[0, 0], [10, 0]], 1)).toEqual([[0, 0], [10, 0]]);
    expect(cutTrail([[0, 0], [10, 0]], 0)).toEqual([[0, 0], [0, 0]]);
  });
  test("trail on animate: a point on a circle traces 61 samples on the circle and the step carries the progress table", () => {
    const anchorsAt = (params: Record<string, number>) => (id: string, name: string) =>
      id === "p" && name === "center" ? ([500 + 100 * Math.cos(params["vars.t"] ?? 0), 375 + 100 * Math.sin(params["vars.t"] ?? 0)] as [number, number]) : null;
    const plan = planCommands([{ draw: ["p"] }, { animate: { t: Math.PI }, trail: { of: "p" }, duration: 2 }], ["p"], {
      varsBase: { t: 0 },
      animateBase: null,
      anchorsAt,
      bboxOf: () => ({ x: 490, y: 365, w: 20, h: 20 }),
    });
    expect(plan.warnings).toEqual([]);
    const tr = plan.minted.find((m) => m.kind === "trail") as { id: string; pts: [number, number][] };
    expect(tr.id).toBe("p_trail");
    expect(tr.pts).toHaveLength(61);
    expect(tr.pts[0]).toEqual([600, 375]);
    expect(tr.pts[60][0]).toBeCloseTo(400, 6);
    for (const p of tr.pts) expect(Math.hypot(p[0] - 500, p[1] - 375)).toBeCloseTo(100, 6);
    expect(animateStep(plan, 1).trails?.[0].id).toBe("p_trail");
    expect(plan.states[1].visible).toContain("p_trail");
  });
  test("a trail's samples ride the traced element's own pose", () => {
    const anchorsAt = () => (id: string) => (id === "p" ? ([500, 375] as [number, number]) : null);
    const plan = planCommands([{ draw: ["p"] }, { move: { target: "p", by: [0, 100] } }, { animate: { t: 1 }, trail: { of: "p" } }], ["p"], {
      varsBase: { t: 0 },
      animateBase: null,
      anchorsAt,
      bboxOf: () => ({ x: 490, y: 365, w: 20, h: 20 }),
    });
    const tr = plan.minted.find((m) => m.kind === "trail") as { pts: [number, number][] };
    expect(tr.pts[0]).toEqual([500, 475]);
  });
  test("trail naming an unknown id warns and mints nothing", () => {
    const plan = planCommands([{ animate: { t: 1 }, trail: { of: "ghost" } }], [], { varsBase: { t: 0 }, animateBase: null, anchorsAt: () => () => null });
    expect(plan.minted).toEqual([]);
    expect(plan.warnings.some((w) => w.includes('animate.trail.of "ghost"'))).toBe(true);
  });
});
