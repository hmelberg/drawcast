import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import examples from "../src/examples.json";
import { domainMapping, elementBBoxes, layoutSpec } from "../src/layout/layout";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

const prompt = readFileSync("src/llm/prompts/compiler-v1.md", "utf8");

type Ex = {
  request: string;
  spec?: {
    vars?: Record<string, number>;
    elements?: { type: string; at?: { on?: string }; bind?: unknown; x_to?: unknown }[];
    commands?: Record<string, unknown>[];
  };
};

describe("the prompt teaches vars and holding definitions (design 2026-09-10)", () => {
  test("vars, bind, a point on a curve and trail on animate are each named, briefly", () => {
    expect(prompt).toMatch(/`"vars": \{"f": 1\}`/);
    expect(prompt).toMatch(/`bind` on any element/);
    expect(prompt).toMatch(/"on": "wave"/);
    expect(prompt).toMatch(/`"trail": \{"of": "com"/);
  });
  test("the definitions rule replaces the old redraw advice", () => {
    expect(prompt).toContain("DEFINITIONS hold");
    expect(prompt).toContain("Placement does not follow");
    expect(prompt).not.toContain("intersection points, guide lines and regions do NOT");
    expect(prompt).not.toContain("do not move the original");
    expect(prompt).not.toContain("and only on template specs");
  });
  test("four bundled examples: a var sweep, a tangent, a shifted demand curve, a turning arm", () => {
    const ex = examples as Ex[];
    const withVars = ex.filter((e) => e.spec?.vars);
    expect(withVars.length).toBeGreaterThanOrEqual(2);
    expect(withVars.some((e) => e.spec!.elements!.some((x) => x.type === "point" && x.at?.on && x.bind))).toBe(true);
    expect(withVars.some((e) => e.spec!.commands!.some((c) => c.animate))).toBe(true);
    // The demand shift is a var on the curve's expression, and the surplus
    // wedge stops at the equilibrium by reference (Hans 2026-09-10: a MOVED
    // stroke left no curve to shade under, and a numeric edge stayed put).
    expect(ex.some((e) => e.request.toLowerCase().includes("demand") && e.spec?.commands?.some((c) => c.animate) && e.spec.elements?.some((x) => x.type === "region" && typeof x.x_to === "object"))).toBe(true);
    expect(ex.some((e) => e.spec?.elements?.some((x) => x.type === "angle") && e.spec?.commands?.some((c) => c.move))).toBe(true);
    for (const e of withVars) expect(e.request).toMatch(/\?/);
  });
  // The gate above only proves the examples plan without a warning; this
  // proves they exercise the round's machinery — a var actually animates, and
  // the moves actually relayout — so a future regression that quietly turns
  // them into plain moves or skipped animates is caught here.
  test("the four examples use the machinery: var animates, relayout moves", () => {
    const ex = examples as (Ex & { spec?: Spec })[];
    const plan = (request: string) => {
      const spec = ex.find((e) => e.request === request)!.spec!;
      const layout = layoutSpec(spec);
      const bboxes = elementBBoxes(layout);
      return planCommands(spec.commands, layout.order, {
        bboxOf: (id) => bboxes.get(id) ?? null,
        ...domainMapping(spec.domain),
        animateBase: null,
        varsBase: spec.vars ?? null,
        bboxesFor: (params, overrides) => {
          const b = elementBBoxes(layoutSpec({ ...spec, vars: { ...(spec.vars ?? {}), ...Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith("vars.")).map(([k, v]) => [k.slice(5), v])) } }, undefined, overrides));
          return (id) => b.get(id) ?? null;
        },
        ...planOptionsFor(spec, layout),
      });
    };
    const wave = plan("Why does a higher frequency squeeze the wave?");
    const animates = wave.steps.filter((s): s is Extract<PlanStep, { kind: "animate" }> => s.kind === "animate");
    expect(animates.map((s) => Object.keys(s.targets))).toEqual([["vars.f"], ["vars.t"]]);
    expect(animates[0].starts).toEqual({ "vars.f": 1 });
    const market = plan("Does the equilibrium follow when demand shifts?");
    const shift = market.steps.filter((s): s is Extract<PlanStep, { kind: "animate" }> => s.kind === "animate");
    expect(shift.map((s) => Object.keys(s.targets))).toEqual([["vars.s"]]);
    expect(shift[0].starts).toEqual({ "vars.s": 0 });
    expect(market.warnings).toEqual([]);
    const arms = plan("What happens to the angle when one arm turns?");
    const turns = arms.steps.filter((s): s is Extract<PlanStep, { kind: "transform" }> => s.kind === "transform");
    expect(turns).toHaveLength(2);
    expect(turns.every((s) => s.relayout)).toBe(true);
    const tangent = plan("What is the tangent at a point, and how does it turn as the point slides?");
    expect(tangent.warnings).toEqual([]);
    expect(tangent.steps.some((s) => s.kind === "animate")).toBe(true);
  });
});
