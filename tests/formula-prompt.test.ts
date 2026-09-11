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
    elements?: { id: string; type: string; colors?: Record<string, string>; x_expr?: string; y_expr?: string; bind?: Record<string, string> }[];
    commands?: Record<string, unknown>[];
  };
};

describe("the prompt teaches morph.tex, copy, colors and the parametric curve (design 2026-09-10-formula-morph, Task 8)", () => {
  test("morph.tex, copy, colors and x_expr are each named, briefly", () => {
    // (b) the morph bullet gains the math-formula-morph sentence, verbatim.
    expect(prompt).toContain('A `math` element morphs into a NEW FORMULA:');
    expect(prompt).toContain('`{"morph": {"target": "eq", "tex": "2x = 8"}}` — like terms glide to');
    expect(prompt).toContain('their new place, the rest fades out and in; write the whole new formula.');
    // (c) a `copy` gesture-verb line, right after `keep`.
    expect(prompt).toContain('`copy`: `{"copy": {"target": "eq", "as": "eq2"}, "speak": "Keep the line and work on a copy."}`');
    expect(prompt).toContain('the derivation idiom is copy the line, move the copy down, morph its TeX');
    expect(prompt).toContain('(`keep` is the choice when the original should fade instead)');
    // `copy` was already in the verb list (Task 5) — never duplicated. Counted
    // against the `## Verbs` catalogue since the restructure: the old count was
    // of the enumeration line, which no longer exists.
    expect(prompt.match(/^- `copy`/gm)?.length ?? 0).toBe(1);
    // (d) freehand rule 5 (math) gains the `colors` sentence.
    expect(prompt).toContain('Colour terms by role with `"colors": {"x": "#2f6b8f", "\\\\Delta C": "#b5482e"}`');
    expect(prompt).toContain('a TeX snippet per colour, every occurrence, kept through a morph.');
    // (e) the tier-2 bullet's curve sentence gains the parametric-curve clause.
    expect(prompt).toContain('a curve may be parametric — `"x_expr": "cos(t)", "y_expr": "sin(t)", "t_from": 0, "t_to": 6.28`');
    expect(prompt).toContain('(vars readable; bind `t_to` to a var and animate it to draw the curve progressively)');
  });

  test("three bundled examples exist by request text and use the machinery", () => {
    const ex = examples as Ex[];
    const derivation = ex.find((e) => e.request === "How do you solve 2x + 3 = 11?");
    const icer = ex.find((e) => e.request === "What does the ICER compare?");
    const circle = ex.find((e) => e.request === "Why do cos and sin draw a circle?");
    expect(derivation, "the derivation example is missing").toBeDefined();
    expect(icer, "the ICER example is missing").toBeDefined();
    expect(circle, "the circle example is missing").toBeDefined();

    // The derivation: a math element with colors on x, and two copy commands.
    const eq = derivation!.spec!.elements!.find((e) => e.type === "math");
    expect(eq?.colors).toMatchObject({ x: expect.any(String) });
    expect(derivation!.spec!.commands!.filter((c) => c.copy)).toHaveLength(2);
    expect(derivation!.spec!.commands!.filter((c) => (c.morph as { tex?: string } | undefined)?.tex)).toHaveLength(2);

    // The ICER: colors on both sides of the math element, one morph.tex.
    const icerEq = icer!.spec!.elements!.find((e) => e.type === "math");
    expect(Object.keys(icerEq?.colors ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(icer!.spec!.commands!.filter((c) => (c.morph as { tex?: string } | undefined)?.tex)).toHaveLength(1);

    // The circle: a parametric curve bound to a var, swept by animate, with a math label.
    const curveEl = circle!.spec!.elements!.find((e) => e.type === "curve");
    expect(curveEl?.x_expr).toBeDefined();
    expect(curveEl?.y_expr).toBeDefined();
    expect(curveEl?.bind).toMatchObject({ t_to: expect.any(String) });
    expect(circle!.spec!.vars).toBeDefined();
    expect(circle!.spec!.commands!.some((c) => c.animate)).toBe(true);
    expect(circle!.spec!.elements!.some((e) => e.type === "math")).toBe(true);
    for (const e of [derivation!, icer!, circle!]) expect(e.request).toMatch(/\?/);
  });

  // The gate above only proves the three examples validate and are shaped
  // right; this proves they exercise the round's machinery through the
  // planner the way render() does (design 2026-09-10-formula-morph, mirrors
  // tests/vars-prompt.test.ts's "use the machinery" test).
  test("the three examples use the machinery: two morph.tex + two copy in the derivation, one morph.tex in the ICER, one animate on vars.s in the circle", () => {
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

    const derivation = plan("How do you solve 2x + 3 = 11?");
    expect(derivation.warnings).toEqual([]);
    const derivationMorphs = derivation.steps.filter((s): s is Extract<PlanStep, { kind: "morph" }> => s.kind === "morph" && (s.texItems?.length ?? 0) > 0);
    expect(derivationMorphs).toHaveLength(2);
    const derivationCopies = derivation.steps.filter((s): s is Extract<PlanStep, { kind: "copy" }> => s.kind === "copy");
    expect(derivationCopies).toHaveLength(2);

    const icer = plan("What does the ICER compare?");
    expect(icer.warnings).toEqual([]);
    const icerMorphs = icer.steps.filter((s): s is Extract<PlanStep, { kind: "morph" }> => s.kind === "morph" && (s.texItems?.length ?? 0) > 0);
    expect(icerMorphs).toHaveLength(1);

    const circle = plan("Why do cos and sin draw a circle?");
    expect(circle.warnings).toEqual([]);
    const circleAnimates = circle.steps.filter((s): s is Extract<PlanStep, { kind: "animate" }> => s.kind === "animate");
    expect(circleAnimates.some((s) => Object.keys(s.targets).includes("vars.s"))).toBe(true);
  });
});
